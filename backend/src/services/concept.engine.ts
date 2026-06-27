/**
 * MOTOR DE CONCEPTOS
 *
 * Evalúa un concepto parametrizable contra el contexto de la liquidación y
 * devuelve el importe (en centésimos). Las tasas legales núcleo (BPS/FONASA/
 * IRPF/FRL) NO son conceptos: se calculan en el motor probado. Los conceptos
 * cubren haberes/descuentos/aportes configurables (presentismo, viáticos,
 * primas, adelantos, etc.).
 */

import { applyRate } from '../utils/money';
import { Concepto } from '@prisma/client';

export interface ConceptoContext {
  salarioNominal: bigint;   // base NOMINAL
  sueldoBasico: bigint;     // base SUELDO_BASICO (proporcional a días)
  haberesGravados: bigint;  // base HABERES_GRAVADOS (acumulado)
  cantidades?: Record<string, number>; // para CANTIDAD_VALOR (por código)
}

/**
 * Devuelve el importe del concepto según su tipo de cálculo.
 */
export function evaluarConcepto(c: Concepto, ctx: ConceptoContext): bigint {
  switch (c.tipoCalculo) {
    case 'VALOR_FIJO':
      return c.valorFijo ?? 0n;

    case 'PORCENTAJE': {
      const base =
        c.baseCalculo === 'NOMINAL' ? ctx.salarioNominal
        : c.baseCalculo === 'SUELDO_BASICO' ? ctx.sueldoBasico
        : ctx.haberesGravados;
      return applyRate(base, c.valorRate ?? 0);
    }

    case 'CANTIDAD_VALOR': {
      const cantidad = ctx.cantidades?.[c.codigo] ?? 0;
      return (c.valorFijo ?? 0n) * BigInt(Math.round(cantidad));
    }

    default:
      return 0n;
  }
}
