// ═══════════════════════════════════════════════════════════════════
// AGENDA DEL ESTUDIO — tareas y vencimientos (uso interno del estudio)
// ═══════════════════════════════════════════════════════════════════
import { prisma } from '../utils/prisma';

export const RECURRENCIAS: Record<string, number> = {
  MENSUAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12,
};
export const ESTADOS = ['PENDIENTE', 'COMPLETADA', 'NO_COMPLETADA', 'CON_FALTAS'] as const;
export type EstadoVencimiento = typeof ESTADOS[number];

function utcDate(year: number, month1: number, day: number): Date {
  const dim = new Date(Date.UTC(year, month1, 0)).getUTCDate(); // días del mes month1 (1-12)
  return new Date(Date.UTC(year, month1 - 1, Math.min(day, dim)));
}

// ¿La tarea recurrente tiene un vencimiento en el mes (year, month1)?
function ocurreEnMes(recurrencia: string | null, mesAncla: number | null, month1: number): boolean {
  const p = RECURRENCIAS[recurrencia ?? ''] ?? 0;
  if (p === 0) return false;
  if (p === 1) return true;
  const a = mesAncla && mesAncla >= 1 && mesAncla <= 12 ? mesAncla : 1;
  return (((month1 - a) % p) + p) % p === 0;
}

// Crea los TareaVencimiento que falten en el rango [from, to] para las tareas
// activas (recurrentes: según su periodicidad; puntuales: su única fecha).
// Tareas "vivas": activas y de una empresa activa (o internas del estudio). Las
// de empresas desactivadas quedan pausadas (no generan ni alertan).
const TAREA_VIVA = { activa: true, OR: [{ companyId: null }, { company: { is: { active: true } } }] };

export async function materializarVencimientos(from: Date, to: Date): Promise<void> {
  const tareas = await prisma.tarea.findMany({ where: TAREA_VIVA });
  const faltantes: Array<{ tareaId: string; fecha: Date }> = [];

  for (const t of tareas) {
    if (t.tipo === 'PUNTUAL') {
      if (t.fechaVencimiento && t.fechaVencimiento >= from && t.fechaVencimiento <= to) {
        faltantes.push({ tareaId: t.id, fecha: new Date(Date.UTC(
          t.fechaVencimiento.getUTCFullYear(), t.fechaVencimiento.getUTCMonth(), t.fechaVencimiento.getUTCDate())) });
      }
      continue;
    }
    // Recurrente: recorrer los meses del rango.
    const dia = t.diaVencimiento && t.diaVencimiento >= 1 ? t.diaVencimiento : 1;
    let y = from.getUTCFullYear(), m = from.getUTCMonth() + 1;
    const endY = to.getUTCFullYear(), endM = to.getUTCMonth() + 1;
    while (y < endY || (y === endY && m <= endM)) {
      if (ocurreEnMes(t.recurrencia, t.mesAncla, m)) {
        const fecha = utcDate(y, m, dia);
        if (fecha >= from && fecha <= to) faltantes.push({ tareaId: t.id, fecha });
      }
      if (m === 12) { m = 1; y++; } else { m++; }
    }
  }

  if (faltantes.length === 0) return;
  // createMany + skipDuplicates respeta el unique [tareaId, fecha].
  await prisma.tareaVencimiento.createMany({ data: faltantes, skipDuplicates: true });
}

export interface FiltrosAgenda {
  companyId?: string;
  responsableId?: string;
  categoria?: string;
  estado?: string;
}

export async function listarVencimientos(from: Date, to: Date, filtros: FiltrosAgenda = {}) {
  await materializarVencimientos(from, to);
  // Excluye tareas de empresas desactivadas (salvo que se filtre por una empresa).
  const tareaWhere: Record<string, unknown> = filtros.companyId ? {} : { ...TAREA_VIVA };
  if (filtros.companyId) tareaWhere.companyId = filtros.companyId;
  if (filtros.responsableId) tareaWhere.responsableId = filtros.responsableId;
  if (filtros.categoria) tareaWhere.categoria = filtros.categoria;

  return prisma.tareaVencimiento.findMany({
    where: {
      fecha: { gte: from, lte: to },
      ...(filtros.estado ? { estado: filtros.estado } : {}),
      ...(Object.keys(tareaWhere).length ? { tarea: tareaWhere } : {}),
    },
    include: {
      tarea: {
        include: {
          company: { select: { id: true, razonSocial: true, nombreFantasia: true } },
          responsable: { select: { id: true, nombre: true, apellido: true } },
        },
      },
    },
    orderBy: [{ fecha: 'asc' }],
  });
}

// Vencimientos pendientes vencidos o próximos (para el Panel y las alertas).
export async function resumenAgenda(diasProximos = 15) {
  const hoy = new Date();
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
  const hasta = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 2, 0));
  await materializarVencimientos(desde, hasta);
  const hoyUtc = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
  const limite = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + diasProximos));

  // Alerta = todo lo que NO esté PROCESADO (COMPLETADA) para su fecha límite.
  const pendientes = await prisma.tareaVencimiento.findMany({
    where: { estado: { not: 'COMPLETADA' }, fecha: { lte: limite }, tarea: { is: TAREA_VIVA } },
    include: { tarea: { include: { company: { select: { razonSocial: true, nombreFantasia: true } } } } },
    orderBy: { fecha: 'asc' },
  });
  const vencidos = pendientes.filter((v) => v.fecha < hoyUtc);
  const proximos = pendientes.filter((v) => v.fecha >= hoyUtc);
  return { vencidos, proximos, totalVencidos: vencidos.length, totalProximos: proximos.length };
}
