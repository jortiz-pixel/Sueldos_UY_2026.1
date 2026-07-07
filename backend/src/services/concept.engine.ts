/**
 * MOTOR DE CONCEPTOS
 *
 * Evalúa un concepto parametrizable contra el contexto de la liquidación y
 * devuelve el importe (en centésimos). Las tasas legales núcleo (BPS/FONASA/
 * IRPF/FRL) NO son conceptos: se calculan en el motor probado. Los conceptos
 * cubren haberes/descuentos/aportes configurables (presentismo, viáticos,
 * primas, adelantos, etc.).
 */

import { applyRate, divRoundHalfUp } from '../utils/money';
import { Concepto } from '@prisma/client';

export interface ConceptoContext {
  salarioNominal: bigint;   // base NOMINAL
  sueldoBasico: bigint;     // base SUELDO_BASICO (proporcional a días)
  haberesGravados: bigint;  // base HABERES_GRAVADOS (acumulado)
  cantidades?: Record<string, number>; // para CANTIDAD_VALOR (por código)
  horasTrabajadas?: number; // construcción: horas efectivas del mes (base HORAS_LAUDO)
}

// Base del concepto según baseCalculo. 'HORAS_LAUDO' (construcción): horas
// trabajadas × valor hora del laudo (guardado en valorFijo del concepto) — es
// la base del presentismo, distinta de la hora pagada.
function baseDelConcepto(c: Concepto, ctx: ConceptoContext): bigint {
  if (c.baseCalculo === 'NOMINAL') return ctx.salarioNominal;
  if (c.baseCalculo === 'SUELDO_BASICO') return ctx.sueldoBasico;
  if (c.baseCalculo === 'HORAS_LAUDO') {
    const horas = ctx.horasTrabajadas ?? 0;
    return divRoundHalfUp((c.valorFijo ?? 0n) * BigInt(Math.round(horas * 100)), 100n);
  }
  return ctx.haberesGravados;
}

/**
 * Devuelve el importe del concepto según su tipo de cálculo.
 */
export function evaluarConcepto(c: Concepto, ctx: ConceptoContext): bigint {
  switch (c.tipoCalculo) {
    case 'VALOR_FIJO':
      return c.valorFijo ?? 0n;

    case 'PORCENTAJE':
      return applyRate(baseDelConcepto(c, ctx), c.valorRate ?? 0);

    case 'CANTIDAD_VALOR': {
      // Admite cantidades fraccionadas (ej. 8,5 horas): se redondea al centésimo.
      const cantidad = ctx.cantidades?.[c.codigo] ?? 0;
      return divRoundHalfUp((c.valorFijo ?? 0n) * BigInt(Math.round(cantidad * 100)), 100n);
    }

    // Porcentaje con 4 decimales (valorRate en cienmilésimas: 0,5809% → 5809).
    // Necesario para tasas finas como Fondo Social construcción (0,5809%) o
    // Fondo de Vivienda (0,025% → 250).
    case 'PORCENTAJE_CIENMIL':
      return divRoundHalfUp(baseDelConcepto(c, ctx) * BigInt(c.valorRate ?? 0), 1000000n);

    default:
      return 0n;
  }
}
