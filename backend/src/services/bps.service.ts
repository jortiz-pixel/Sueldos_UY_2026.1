/**
 * SERVICIO BPS/FONASA/FRL
 *
 * Cálculo de aportes al BPS (Banco de Previsión Social):
 *
 * APORTES OBREROS (descuentos al empleado):
 * ─────────────────────────────────────────
 * - BPS Jubilatorio:       15% del salario nominal
 * - FONASA/DISSE básico:    3% del salario nominal
 * - FONASA/DISSE familia:  +2% adicional (si tiene familia a cargo)
 * - FRL (obrero):          0.125% del salario nominal
 *
 * APORTES PATRONALES (a cargo del empleador):
 * ────────────────────────────────────────────
 * - BPS IVS (patronal):    7.5% del salario nominal
 * - FONASA/DISSE patronal: varía por categoría (parameterizable)
 * - FRL (patronal):        0.025% del salario nominal
 * - BSE (seguro accidentes): tasa configurable por empresa
 *
 * Nota: Todos los montos en centésimos (BigInt).
 */

import { applyRate } from '../utils/money';
import { PayrollParameters } from './parameters.service';

export interface AportesInput {
  salarioNominal: bigint;
  fonasaFamilia: boolean;       // Si el empleado tiene familia a cargo
  params: PayrollParameters;
  bseRateEmpresa: number;       // BSE rate en basis points (específico de empresa)
  fonasaPatronalRate?: number;  // FONASA patronal (si es distinto a default)
}

export interface AportesObreros {
  jubilatorio: bigint;
  fonasaBasico: bigint;
  fonasaFamilia: bigint;
  fonasaTotal: bigint;
  frl: bigint;
  total: bigint;
  detail: {
    jubilatorioRate: number;
    fonasaBasicoRate: number;
    fonasaFamiliaRate: number;
    frlRate: number;
  };
}

export interface AportesPatronales {
  bpsIvs: bigint;
  fonasa: bigint;
  frl: bigint;
  bse: bigint;
  total: bigint;
  detail: {
    bpsIvsRate: number;
    fonasaRate: number;
    frlRate: number;
    bseRate: number;
  };
}

/**
 * Calcula los aportes obreros (descuentos al empleado).
 */
export function calcularAportesObreros(input: AportesInput): AportesObreros {
  const { salarioNominal, fonasaFamilia, params } = input;

  const jubilatorio = applyRate(salarioNominal, params.bpsJubilatorioRate);
  const fonasaBasico = applyRate(salarioNominal, params.fonasaBasicRate);
  const fonasaFamiliaAporte = fonasaFamilia
    ? applyRate(salarioNominal, params.fonasaFamiliaRate)
    : 0n;
  const fonasaTotal = fonasaBasico + fonasaFamiliaAporte;
  const frl = applyRate(salarioNominal, params.frlObreroRate);

  return {
    jubilatorio,
    fonasaBasico,
    fonasaFamilia: fonasaFamiliaAporte,
    fonasaTotal,
    frl,
    total: jubilatorio + fonasaTotal + frl,
    detail: {
      jubilatorioRate: params.bpsJubilatorioRate,
      fonasaBasicoRate: params.fonasaBasicRate,
      fonasaFamiliaRate: fonasaFamilia ? params.fonasaFamiliaRate : 0,
      frlRate: params.frlObreroRate,
    },
  };
}

/**
 * Calcula los aportes patronales (a cargo del empleador).
 *
 * FONASA patronal: La tasa varía según la categoría de la empresa.
 * Para industria y comercio (la más común): 5% DISSE patronal.
 * Si se proporciona `fonasaPatronalRate`, se usa ese valor.
 */
export function calcularAportesPatronales(input: AportesInput): AportesPatronales {
  const { salarioNominal, params } = input;

  // FONASA patronal por defecto: 5% para industria/comercio (500 bp)
  const fonasaPatronalRate = input.fonasaPatronalRate ?? 500;

  const bpsIvs = applyRate(salarioNominal, params.bpsIvsPatronalRate);
  const fonasa = applyRate(salarioNominal, fonasaPatronalRate);
  const frl = applyRate(salarioNominal, params.frlPatronalRate);
  const bse = applyRate(salarioNominal, input.bseRateEmpresa);

  return {
    bpsIvs,
    fonasa,
    frl,
    bse,
    total: bpsIvs + fonasa + frl + bse,
    detail: {
      bpsIvsRate: params.bpsIvsPatronalRate,
      fonasaRate: fonasaPatronalRate,
      frlRate: params.frlPatronalRate,
      bseRate: input.bseRateEmpresa,
    },
  };
}

/**
 * Calcula BPS sobre aguinaldo (mismas tasas, base = monto bruto aguinaldo).
 */
export function calcularBpsAguinaldo(
  aguinaldoBruto: bigint,
  fonasaFamilia: boolean,
  params: PayrollParameters,
  fonasaPatronalRate?: number,
): { obrero: AportesObreros; patronal: AportesPatronales } {
  const input: AportesInput = {
    salarioNominal: aguinaldoBruto,
    fonasaFamilia,
    params,
    bseRateEmpresa: params.bseFondoGravamen,
    fonasaPatronalRate,
  };
  return {
    obrero: calcularAportesObreros(input),
    patronal: calcularAportesPatronales(input),
  };
}

/**
 * Cálculo de horas extra.
 * - Diurnas: 2× el valor hora normal
 * - Nocturnas (después de las 22:00): 2.5× el valor hora normal
 *
 * Valor hora normal = salario mensual / (horas mensuales standard)
 * Standard: 200 horas/mes para jornada completa (40h/sem × 5 sem aprox)
 */
export function calcularHorasExtra(
  salarioMensual: bigint,
  horasExtraDiurnas: number,
  horasExtraNocturnas: number,
  horasMensuales: number = 200,
): {
  valorHoraNormal: bigint;
  importeHorasDiurnas: bigint;
  importeHorasNocturnas: bigint;
  total: bigint;
} {
  const valorHoraNormal = salarioMensual / BigInt(horasMensuales);

  const importeHorasDiurnas = valorHoraNormal * 2n * BigInt(horasExtraDiurnas);
  const importeHorasNocturnas =
    (valorHoraNormal * 5n * BigInt(horasExtraNocturnas)) / 2n; // 2.5x

  return {
    valorHoraNormal,
    importeHorasDiurnas,
    importeHorasNocturnas,
    total: importeHorasDiurnas + importeHorasNocturnas,
  };
}
