import { AttachmentType } from '@prisma/client';
import { prisma } from '../utils/prisma';

export type CalendarEventType =
  | 'CUMPLEANOS'
  | 'VENC_CARNE_SALUD'
  | 'VENC_LIBRETA'
  | 'ALTA'
  | 'BAJA'
  | 'LICENCIA'
  | 'REINTEGRO'
  | 'VENC_NOMINA_BPS';

export interface CalendarEvent {
  tipo: CalendarEventType;
  fecha: string; // YYYY-MM-DD (componentes locales)
  titulo: string;
  personaId?: string;
  /** Para LICENCIA: fecha de fin (YYYY-MM-DD) para pintar el rango. */
  hasta?: string;
  leaveId?: string;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Eventos calculados (no almacenados) de una empresa en un rango:
 * cumpleaños, vencimientos de carné de salud / libreta (adjuntos), altas y bajas.
 * Diseñado para sumarle, más adelante, eventos "duros" persistidos sin reescribir el consumidor.
 */
export async function getCalendarEvents(companyId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];

  const contratos = await prisma.contrato.findMany({
    where: { companyId },
    select: {
      vigenciaDesde: true,
      vigenciaHasta: true,
      fechaFin: true,
      employee: { select: { id: true, nombre: true, apellido: true, fechaNacimiento: true } },
    },
  });

  // Cumpleaños (una vez por persona, en el/los año(s) del rango)
  const personas = new Map<string, { id: string; nombre: string; apellido: string; fechaNacimiento: Date | null }>();
  for (const c of contratos) personas.set(c.employee.id, c.employee);

  const years: number[] = [];
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) years.push(y);

  for (const p of personas.values()) {
    if (!p.fechaNacimiento) continue;
    const bd = new Date(p.fechaNacimiento);
    for (const y of years) {
      const cand = new Date(y, bd.getMonth(), bd.getDate());
      if (cand >= from && cand <= to) {
        events.push({ tipo: 'CUMPLEANOS', fecha: isoDate(cand), titulo: `Cumpleaños de ${p.nombre} ${p.apellido}`, personaId: p.id });
      }
    }
  }

  // Altas y bajas (inicio / fin de contrato)
  for (const c of contratos) {
    if (c.vigenciaDesde >= from && c.vigenciaDesde <= to) {
      events.push({ tipo: 'ALTA', fecha: isoDate(c.vigenciaDesde), titulo: `Alta: ${c.employee.nombre} ${c.employee.apellido}`, personaId: c.employee.id });
    }
    const baja = c.fechaFin ?? c.vigenciaHasta;
    if (baja && baja >= from && baja <= to) {
      events.push({ tipo: 'BAJA', fecha: isoDate(baja), titulo: `Fin de contrato: ${c.employee.nombre} ${c.employee.apellido}`, personaId: c.employee.id });
    }
  }

  // Vencimientos de adjuntos (carné de salud, libreta)
  const adjuntos = await prisma.attachment.findMany({
    where: {
      companyId,
      tipo: { in: [AttachmentType.CARNE_SALUD, AttachmentType.LIBRETA] },
      vencimiento: { gte: from, lte: to },
    },
    select: { tipo: true, vencimiento: true, ownerType: true, ownerId: true },
  });

  const personaIds = adjuntos.filter((a) => a.ownerType === 'PERSONA').map((a) => a.ownerId);
  const empleados = personaIds.length
    ? await prisma.employee.findMany({ where: { id: { in: personaIds } }, select: { id: true, nombre: true, apellido: true } })
    : [];
  const nombreById = new Map(empleados.map((e) => [e.id, `${e.nombre} ${e.apellido}`]));

  for (const a of adjuntos) {
    if (!a.vencimiento) continue;
    const persona = a.ownerType === 'PERSONA' ? nombreById.get(a.ownerId) : undefined;
    const label = a.tipo === AttachmentType.CARNE_SALUD ? 'carné de salud' : 'libreta';
    events.push({
      tipo: a.tipo === AttachmentType.CARNE_SALUD ? 'VENC_CARNE_SALUD' : 'VENC_LIBRETA',
      fecha: isoDate(a.vencimiento),
      titulo: `Vence ${label}${persona ? ' de ' + persona : ''}`,
      personaId: a.ownerType === 'PERSONA' ? a.ownerId : undefined,
    });
  }

  // Licencias (LeaveRequest) que solapan el rango + día de reintegro.
  const licencias = await prisma.leaveRequest.findMany({
    where: {
      employee: { contratos: { some: { companyId } } },
      status: { in: ['PENDIENTE', 'APROBADA'] },
      fechaInicio: { lte: to },
      fechaFin: { gte: new Date(from.getTime() - 40 * 86400000) }, // margen para reintegros
    },
    include: { employee: { select: { id: true, nombre: true, apellido: true } } },
  });
  for (const l of licencias) {
    const quien = `${l.employee.nombre} ${l.employee.apellido}`;
    const inicio = new Date(l.fechaInicio);
    const fin = new Date(l.fechaFin);
    if (inicio <= to && fin >= from) {
      events.push({
        tipo: 'LICENCIA',
        fecha: isoDate(inicio < from ? from : inicio),
        hasta: isoDate(fin > to ? to : fin),
        titulo: `Licencia de ${quien}${l.status === 'PENDIENTE' ? ' (pendiente)' : ''}`,
        personaId: l.employee.id,
        leaveId: l.id,
      });
    }
    const reintegro = new Date(fin);
    reintegro.setDate(reintegro.getDate() + 1);
    if (reintegro >= from && reintegro <= to) {
      events.push({ tipo: 'REINTEGRO', fecha: isoDate(reintegro), titulo: `Reintegro de ${quien}`, personaId: l.employee.id, leaveId: l.id });
    }
  }

  // Vencimiento de presentación/pago de nómina BPS: día configurable de cada
  // mes (companies.diaVencimientoBps), corresponde a la nómina del mes anterior.
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { diaVencimientoBps: true, nombreFantasia: true, razonSocial: true },
  });
  if (company) {
    const dia = company.diaVencimientoBps || 20;
    for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
      for (let m = 0; m < 12; m++) {
        const cand = new Date(y, m, Math.min(dia, new Date(y, m + 1, 0).getDate()));
        if (cand >= from && cand <= to) {
          const mesCargo = new Date(y, m - 1, 1);
          const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
          events.push({
            tipo: 'VENC_NOMINA_BPS',
            fecha: isoDate(cand),
            titulo: `Vence nómina BPS de ${MES[mesCargo.getMonth()]}`,
          });
        }
      }
    }
  }

  return events.sort((x, y) => x.fecha.localeCompare(y.fecha));
}
