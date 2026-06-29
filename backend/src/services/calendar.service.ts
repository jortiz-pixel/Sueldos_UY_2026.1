import { AttachmentType } from '@prisma/client';
import { prisma } from '../utils/prisma';

export type CalendarEventType =
  | 'CUMPLEANOS'
  | 'VENC_CARNE_SALUD'
  | 'VENC_LIBRETA'
  | 'ALTA'
  | 'BAJA';

export interface CalendarEvent {
  tipo: CalendarEventType;
  fecha: string; // YYYY-MM-DD (componentes locales)
  titulo: string;
  personaId?: string;
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

  return events.sort((x, y) => x.fecha.localeCompare(y.fecha));
}
