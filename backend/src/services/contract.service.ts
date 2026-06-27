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
