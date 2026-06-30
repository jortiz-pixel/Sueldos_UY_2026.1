/**
 * SERVICIO DE CONTRATOS
 *
 * El contrato es el vínculo persona–empresa, versionado por vigencia.
 * El cálculo de cada liquidación usa el contrato VIGENTE para el período/empresa.
 */

import { prisma } from '../utils/prisma';

/**
 * Resuelve el contrato vigente de una persona para una fecha (y opcionalmente una empresa).
 * Un contrato es vigente si: activo, vigenciaDesde <= fecha, y no terminó (vigenciaHasta/fechaFin).
 */
export async function resolverContratoVigente(employeeId: string, asOfDate: Date, companyId?: string) {
  return prisma.contrato.findFirst({
    where: {
      employeeId,
      activo: true,
      ...(companyId ? { companyId } : {}),
      vigenciaDesde: { lte: asOfDate },
      AND: [
        { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: asOfDate } }] },
        { OR: [{ fechaFin: null }, { fechaFin: { gte: asOfDate } }] },
      ],
    },
    orderBy: { vigenciaDesde: 'desc' },
    include: { company: true },
  });
}

/**
 * Resuelve el contrato que SOLAPA el mes (≥1 día vigente), aunque el alta o la
 * baja caigan a mitad de mes. Se usa para liquidar períodos parciales.
 */
export async function resolverContratoEnMes(employeeId: string, year: number, month: number, companyId?: string) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  return prisma.contrato.findFirst({
    where: {
      employeeId,
      activo: true,
      ...(companyId ? { companyId } : {}),
      vigenciaDesde: { lte: monthEnd },
      AND: [
        { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: monthStart } }] },
        { OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }] },
      ],
    },
    orderBy: { vigenciaDesde: 'desc' },
    include: { company: true },
  });
}

/**
 * Días trabajados del contrato dentro del mes (base ficto 30).
 * - Mes completo → 30. - Alta a mitad de mes → 31 − díaAlta. - Baja a mitad → díaBaja.
 * - Alta y baja en el mismo mes → díaBaja − díaAlta + 1.
 */
export function diasTrabajadosEnMes(
  contrato: { fechaIngreso?: Date | null; vigenciaDesde: Date; fechaFin?: Date | null; vigenciaHasta?: Date | null },
  year: number,
  month: number,
): number {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const altaRaw = contrato.fechaIngreso ?? contrato.vigenciaDesde;
  const alta = altaRaw && new Date(altaRaw) > monthStart ? new Date(altaRaw) : monthStart;
  const finRaw = contrato.fechaFin ?? contrato.vigenciaHasta ?? null;
  const fin = finRaw && new Date(finRaw) < monthEnd ? new Date(finRaw) : monthEnd;
  if (fin < alta) return 0;
  const cubreInicio = alta <= monthStart;
  const cubreFin = fin >= monthEnd;
  if (cubreInicio && cubreFin) return 30;
  let dias: number;
  if (!cubreInicio && cubreFin) dias = 30 - (alta.getDate() - 1); // alta a mitad de mes
  else if (cubreInicio && !cubreFin) dias = fin.getDate();        // baja a mitad de mes
  else dias = fin.getDate() - alta.getDate() + 1;                 // alta y baja en el mes
  return Math.max(0, Math.min(30, dias));
}

/**
 * Datos laborales efectivos: prioriza el contrato vigente, con fallback al empleado.
 */
export function datosLaboralesEfectivos(
  employee: { salaryType: 'MENSUAL' | 'JORNALERO'; salarioNominal: bigint; jornal: bigint | null },
  contrato: { salaryType: 'MENSUAL' | 'JORNALERO'; salarioNominal: bigint; jornal: bigint | null } | null,
): { salaryType: 'MENSUAL' | 'JORNALERO'; salarioNominal: bigint; jornal: bigint | null } {
  return {
    salaryType: contrato?.salaryType ?? employee.salaryType,
    salarioNominal: contrato?.salarioNominal ?? employee.salarioNominal,
    jornal: contrato?.jornal ?? employee.jornal,
  };
}
