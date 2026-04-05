/**
 * MOTOR DE CÁLCULO IRPF — CATEGORÍA II (Rentas del Trabajo)
 *
 * Implementa el método de proyección anual (DGI Resolución 662/007 y modificativas).
 *
 * METODOLOGÍA (Proyección Anual):
 * ─────────────────────────────────────────────────────────────
 * 1. Base gravada mensual = salario nominal
 * 2. BPS mensual = base × 15% (jubilatorio)
 * 3. FONASA mensual = base × (3% + 2% si familia a cargo)
 * 4. Renta neta mensual = base - BPS - FONASA
 * 5. Renta neta ANUAL proyectada = renta neta mensual × 12
 * 6. Deducciones anuales por cargas de familia:
 *    - Hijos a cargo: hijosACargo × 13 BPC/año
 *    - Hijos discapacitados: × 26 BPC/año
 *    - Cónyuge a cargo: 6 BPC/año
 * 7. Base IRPF anual = renta neta anual - deducciones familiares
 * 8. Impuesto anual = suma de tramos (escala progresiva)
 * 9. Retención mensual = impuesto anual / 12
 *
 * ESCALAS IRPF 2024 (en BPC anuales):
 *   0 - 84 BPC    →  0%
 *   84 - 120 BPC  → 10%
 *   120 - 180 BPC → 15%
 *   180 - 600 BPC → 20%
 *   600 - 900 BPC → 22%
 *   900 - 1380 BPC → 25%
 *   > 1380 BPC    → 30%
 */

import { applyRate, divRoundHalfUp, maxBigInt, minBigInt } from '../utils/money';
import { IrpfBracket, PayrollParameters } from './parameters.service';

export interface IrpfInput {
  salarioNominal: bigint;     // Salario bruto mensual en centésimos
  fonasaMensual: bigint;      // FONASA pagado este mes (obrero)
  bpsMensual: bigint;         // BPS jubilatorio pagado este mes
  hijosACargo: number;        // Hijos sin discapacidad
  hijosDiscapacitados: number;
  conyugeACargo: boolean;
  params: PayrollParameters;
}

export interface IrpfBracketDetail {
  fromCtms: bigint;
  toCtms: bigint | null;
  ratePercent: number;
  baseEnTramo: bigint;
  impuestoEnTramo: bigint;
}

export interface IrpfResult {
  // Monthly amounts (centésimos)
  retencionMensual: bigint;

  // Annual projections (centésimos) — for audit/debug
  rentaNetaMensual: bigint;
  rentaNetaAnual: bigint;
  deduccionHijosAnual: bigint;
  deduccionConyugeAnual: bigint;
  baseIrpfAnual: bigint;
  impuestoAnual: bigint;

  // Detailed bracket breakdown (audit)
  tramos: IrpfBracketDetail[];
}

/**
 * Calcula la retención mensual de IRPF mediante el método de proyección anual.
 * Todos los montos son en centésimos (BigInt).
 */
export function calcularIrpfMensual(input: IrpfInput): IrpfResult {
  const { params } = input;

  // ── 1. Renta neta mensual (base imponible mensual) ──────────
  // Base gravada = salario nominal
  // Deducibles: BPS jubilatorio + FONASA (obrero)
  const rentaNetaMensual = input.salarioNominal - input.bpsMensual - input.fonasaMensual;
  const rentaNetaMensualPositiva = rentaNetaMensual < 0n ? 0n : rentaNetaMensual;

  // ── 2. Proyección anual ──────────────────────────────────────
  const rentaNetaAnual = rentaNetaMensualPositiva * 12n;

  // ── 3. Deducciones por cargas de familia (en centésimos) ─────
  const deduccionHijosAnual =
    BigInt(input.hijosACargo) * params.bpc * BigInt(params.irpfHijosBpc)
    + BigInt(input.hijosDiscapacitados) * params.bpc * BigInt(params.irpfHijosDiscapacitadosBpc);

  const deduccionConyugeAnual = input.conyugeACargo
    ? params.bpc * BigInt(params.irpfConyugeBpc)
    : 0n;

  const totalDeducciones = deduccionHijosAnual + deduccionConyugeAnual;

  // ── 4. Base IRPF anual ───────────────────────────────────────
  const baseIrpfAnual = maxBigInt(0n, rentaNetaAnual - totalDeducciones);

  // ── 5. Calcular impuesto por tramos ──────────────────────────
  const { impuestoAnual, tramos } = aplicarTramos(baseIrpfAnual, params.irpfBrackets, params.bpc);

  // ── 6. Retención mensual ─────────────────────────────────────
  const retencionMensual = divRoundHalfUp(impuestoAnual, 12n);
  const retencionMensualPositiva = maxBigInt(0n, retencionMensual);

  return {
    retencionMensual: retencionMensualPositiva,
    rentaNetaMensual: rentaNetaMensualPositiva,
    rentaNetaAnual,
    deduccionHijosAnual,
    deduccionConyugeAnual,
    baseIrpfAnual,
    impuestoAnual,
    tramos,
  };
}

/**
 * Aplica los tramos progresivos sobre la base imponible anual.
 * La base y los límites están en centésimos; los límites de tramos en BPC.
 */
function aplicarTramos(
  baseAnualCtms: bigint,
  brackets: IrpfBracket[],
  bpcCtms: bigint,
): { impuestoAnual: bigint; tramos: IrpfBracketDetail[] } {
  let impuestoAnual = 0n;
  const tramos: IrpfBracketDetail[] = [];

  for (const bracket of brackets) {
    const fromCtms = BigInt(bracket.fromBpc) * bpcCtms;
    const toCtms = bracket.toBpc !== null ? BigInt(bracket.toBpc) * bpcCtms : null;

    // Porción de la base que cae en este tramo
    const baseEnTramo = calcularBaseEnTramo(baseAnualCtms, fromCtms, toCtms);

    let impuestoEnTramo = 0n;
    if (baseEnTramo > 0n && bracket.rateBp > 0) {
      impuestoEnTramo = applyRate(baseEnTramo, bracket.rateBp);
    }

    impuestoAnual += impuestoEnTramo;

    tramos.push({
      fromCtms,
      toCtms,
      ratePercent: bracket.ratePercent,
      baseEnTramo,
      impuestoEnTramo,
    });
  }

  return { impuestoAnual, tramos };
}

function calcularBaseEnTramo(
  base: bigint,
  from: bigint,
  to: bigint | null,
): bigint {
  if (base <= from) return 0n;
  const upper = to !== null ? minBigInt(base, to) : base;
  return maxBigInt(0n, upper - from);
}

/**
 * MÉTODO SIMPLIFICADO (sueldo fijo):
 * Para empleados que optaron por el método simplificado, se usa
 * un ficto mensual fijo en lugar de la proyección.
 * Retención = ficto × tasa marginal más alta aplicable.
 */
export function calcularIrpfSimplificado(
  fictoMensual: bigint,
  params: PayrollParameters,
): bigint {
  // Ficto anual
  const fictoAnual = fictoMensual * 12n;

  // Tasa marginal
  let tasaBp = 0;
  for (const bracket of params.irpfBrackets) {
    const fromCtms = BigInt(bracket.fromBpc) * params.bpc;
    const toCtms = bracket.toBpc !== null ? BigInt(bracket.toBpc) * params.bpc : null;
    if (fictoAnual > fromCtms && (toCtms === null || fictoAnual <= toCtms)) {
      tasaBp = bracket.rateBp;
      break;
    }
  }

  const retencionAnual = applyRate(fictoAnual, tasaBp);
  return divRoundHalfUp(retencionAnual, 12n);
}

/**
 * Calcula la retención de IRPF sobre el AGUINALDO.
 * El aguinaldo se grava separadamente según DGI.
 * Se acumula al ingreso del semestre y se calcula el incremento de retención.
 *
 * Método simplificado: aplica la tasa marginal del empleado al aguinaldo.
 */
export function calcularIrpfAguinaldo(
  aguinaldoBruto: bigint,
  bpsAguinaldo: bigint,
  fonasaAguinaldo: bigint,
  params: PayrollParameters,
): bigint {
  // Base neta del aguinaldo
  const baseNeta = maxBigInt(0n, aguinaldoBruto - bpsAguinaldo - fonasaAguinaldo);
  if (baseNeta === 0n) return 0n;

  // Encontrar tramo marginal (usando escala anual / 2 para semestral)
  // El aguinaldo semestral se proyecta como base / 6 * 12 para la tasa
  const baseAnualEquivalente = baseNeta * 12n;
  const { impuestoAnual } = aplicarTramos(baseAnualEquivalente, params.irpfBrackets, params.bpc);

  // La retención sobre el aguinaldo = impuesto correspondiente a la base del aguinaldo
  // = impuesto_anual / 12 * meses_aguinaldo(6) / 12 → simplificado: impuesto semestral
  // Método: impuesto sobre la base neta del aguinaldo directamente
  const { impuestoAnual: impuestoSobreBase } = aplicarTramos(
    baseNeta * 2n, // × 2 para anualizar semestralmente
    params.irpfBrackets,
    params.bpc,
  );

  return divRoundHalfUp(impuestoSobreBase, 2n);
}
