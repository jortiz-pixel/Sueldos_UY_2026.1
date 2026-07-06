/**
 * MOTOR DE CÁLCULO IRPF — CATEGORÍA II (Rentas del Trabajo)
 *
 * Método oficial vigente (Título 7, arts. 37-38; DGI Res. 662/007 y modif.):
 * ─────────────────────────────────────────────────────────────
 * 1. Renta computable mensual = ingreso NOMINAL gravado (sin restar aportes).
 * 2. Renta computable anual = mensual × 12 (proyección).
 * 3. Impuesto PRIMARIO = escala progresiva sobre la renta computable anual.
 * 4. DEDUCCIONES anuales = aportes personales (jubilatorio + FONASA) × 12
 *    + hijos a cargo × 20 BPC + hijos con discapacidad × 40 BPC.
 * 5. Crédito por deducciones = deducciones × tasa:
 *      14% si el nominal mensual ≤ 15 BPC (180 BPC anuales) · 8% si lo supera.
 * 6. IRPF anual = max(0, primario − crédito) · retención mensual = /12.
 *
 * ESCALA (BPC anuales = escala mensual oficial × 12):
 *   0-84: 0% · 84-120: 10% · 120-180: 15% · 180-360: 24% · 360-600: 25%
 *   · 600-900: 27% · 900-1380: 31% · >1380: 36%
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
  rentaNetaMensual: bigint;      // renta computable mensual (nominal gravado)
  rentaNetaAnual: bigint;        // renta computable anual
  deduccionAportesAnual: bigint; // aportes personales proyectados (deducción)
  deduccionHijosAnual: bigint;
  deduccionConyugeAnual: bigint;
  tasaDeduccionBp: number;       // 1400 (14%) u 800 (8%)
  creditoDeducciones: bigint;    // deducciones × tasa
  impuestoPrimarioAnual: bigint; // escala sobre la renta computable
  baseIrpfAnual: bigint;         // (= renta computable anual, para el recibo)
  impuestoAnual: bigint;         // primario − crédito

  // Detailed bracket breakdown (audit)
  tramos: IrpfBracketDetail[];
}

/**
 * Calcula la retención mensual de IRPF mediante el método de proyección anual.
 * Todos los montos son en centésimos (BigInt).
 */
export function calcularIrpfMensual(input: IrpfInput): IrpfResult {
  const { params } = input;

  // ── 1. Renta computable: el ingreso NOMINAL gravado ──────────
  const rentaComputableMensual = maxBigInt(0n, input.salarioNominal);
  const rentaComputableAnual = rentaComputableMensual * 12n;

  // ── 2. Impuesto primario: escala progresiva sobre el nominal ──
  const { impuestoAnual: impuestoPrimarioAnual, tramos } =
    aplicarTramos(rentaComputableAnual, params.irpfBrackets, params.bpc);

  // ── 3. Deducciones anuales ────────────────────────────────────
  // Aportes personales deducibles (DGI): jubilatorio + FONASA + FRL.
  const frlMensual = applyRate(input.salarioNominal, params.frlObreroRate);
  const deduccionAportesAnual = maxBigInt(0n, (input.bpsMensual + input.fonasaMensual + frlMensual) * 12n);
  const deduccionHijosAnual =
    BigInt(input.hijosACargo) * params.bpc * BigInt(params.irpfHijosBpc)
    + BigInt(input.hijosDiscapacitados) * params.bpc * BigInt(params.irpfHijosDiscapacitadosBpc);
  const deduccionConyugeAnual = input.conyugeACargo
    ? params.bpc * BigInt(params.irpfConyugeBpc)
    : 0n;
  const totalDeducciones = deduccionAportesAnual + deduccionHijosAnual + deduccionConyugeAnual;

  // ── 4. Crédito por deducciones (art. 38): 14% u 8% según nominal ──
  const umbralAnual = BigInt(params.irpfUmbralDeduccionBpc) * params.bpc;
  const tasaDeduccionBp = rentaComputableAnual <= umbralAnual
    ? params.irpfTasaDeduccionBajaBp
    : params.irpfTasaDeduccionAltaBp;
  const creditoDeducciones = applyRate(totalDeducciones, tasaDeduccionBp);

  // ── 5. IRPF anual y retención mensual ─────────────────────────
  const impuestoAnual = maxBigInt(0n, impuestoPrimarioAnual - creditoDeducciones);
  const retencionMensual = maxBigInt(0n, divRoundHalfUp(impuestoAnual, 12n));

  return {
    retencionMensual,
    rentaNetaMensual: rentaComputableMensual,
    rentaNetaAnual: rentaComputableAnual,
    deduccionAportesAnual,
    deduccionHijosAnual,
    deduccionConyugeAnual,
    tasaDeduccionBp,
    creditoDeducciones,
    impuestoPrimarioAnual,
    baseIrpfAnual: rentaComputableAnual,
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
