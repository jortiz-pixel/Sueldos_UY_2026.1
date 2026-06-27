/**
 * SERVICIO DE CONTRATOS
 *
 * Un empleado tiene N contratos versionados por vigencia.
 * El cálculo de cada liquidación usa el contrato VIGENTE para el período.
 */

import { prisma } from '../utils/prisma';

/**
 * Resuelve el contrato vigente de un empleado para una fecha dada.
 * Devuelve null si no hay contrato (el motor cae al dato legado del empleado).
 */
export async function resolverContratoVigente(employeeId: string, asOfDate: Date) {
  return prisma.contrato.findFirst({
    where: {
      employeeId,
      activo: true,
      vigenciaDesde: { lte: asOfDate },
      OR: [
        { vigenciaHasta: null },
        { vigenciaHasta: { gte: asOfDate } },
      ],
    },
    orderBy: { vigenciaDesde: 'desc' },
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
