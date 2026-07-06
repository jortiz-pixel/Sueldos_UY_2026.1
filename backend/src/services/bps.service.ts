/**
 * SERVICIO BPS/FONASA/FRL
 *
 * APORTES OBREROS (descuentos al empleado):
 * - BPS Jubilatorio:       15% del salario nominal
 * - FONASA/DISSE:          escalonado según ingreso y cargas familiares:
 *     base 3% (ingreso <= 2.5 BPC) o 4.5% (ingreso > 2.5 BPC)
 *     +1.5% si tiene hijos a cargo
 *     +2%   si tiene cónyuge a cargo
 * - FRL (obrero):          0.10% del salario nominal (2026)
 *
 * APORTES PATRONALES (a cargo del empleador):
 * - BPS IVS (patronal):    7.5% del salario nominal
 * - FONASA/DISSE patronal: 5% (parametrizable)
 * - FRL (patronal):        0.10% del salario nominal (2026)
 * - BSE (seguro accidentes): tasa configurable por empresa
 *
 * Nota: Todos los montos en centésimos (BigInt).
 */

import { applyRate } from '../utils/money';
import { PayrollParameters } from './parameters.service';

export interface AportesInput {
  salarioNominal: bigint;
  params: PayrollParameters;
  bseRateEmpresa: number;       // BSE rate en basis points (específico de empresa)
  hijosACargo?: number;         // FONASA: +1.5% si > 0
  conyugeACargo?: boolean;      // FONASA: +2% si true
  fonasaFamilia?: boolean;      // (compat) si true y no se pasan hijos/cónyuge -> +1.5%
  fonasaPatronalRate?: number;  // FONASA patronal (si es distinto a default)
  // Base adicional para el ADICIONAL de FONASA (complemento por encima del 3%).
  // Se usa en junio/diciembre: el adicional del aguinaldo NO se cobra en el
  // aguinaldo sino en la mensualidad, sobre (nominal del mes + aguinaldo).
  fonasaAdicionalExtraBase?: bigint;
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
    fonasaRateEfectivo: number; // tasa FONASA total aplicada (bp)
    fonasaBaseRate: number;
    fonasaHijosRate: number;
    fonasaConyugeRate: number;
    fonasaSeguroRate: number;      // 3% seguro de enfermedad (siempre)
    fonasaAdicionalRate: number;   // complemento por encima del 3%
    fonasaAdicionalBase: bigint;   // base sobre la que se aplicó el adicional
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
 * Determina la tasa FONASA total (en basis points) según ingreso y cargas.
 */
export function calcularTasaFonasa(input: AportesInput): {
  rateTotal: number; baseRate: number; hijosRate: number; conyugeRate: number;
} {
  const { salarioNominal, params } = input;
  // Umbral en centésimos = umbral_BPC * BPC
  const umbralCtms = (params.bpc * BigInt(Math.round(params.fonasaThresholdBpc * 100))) / 100n;
  const baseRate = salarioNominal > umbralCtms ? params.fonasaBasicHighRate : params.fonasaBasicRate;

  const tieneHijos = (input.hijosACargo ?? 0) > 0 || (input.fonasaFamilia ?? false);
  const tieneConyuge = input.conyugeACargo ?? false;

  const hijosRate = tieneHijos ? params.fonasaHijosRate : 0;
  const conyugeRate = tieneConyuge ? params.fonasaConyugeRate : 0;

  return { rateTotal: baseRate + hijosRate + conyugeRate, baseRate, hijosRate, conyugeRate };
}

/**
 * Calcula los aportes obreros (descuentos al empleado).
 */
export function calcularAportesObreros(input: AportesInput): AportesObreros {
  const { salarioNominal, params } = input;

  const jubilatorio = applyRate(salarioNominal, params.bpsJubilatorioRate);

  const fonasa = calcularTasaFonasa(input);
  // FONASA se compone del "seguro de enfermedad" (3% fijo, siempre sobre el
  // nominal) + un ADICIONAL/complemento (el resto de la tasa: escalón >2,5 BPC,
  // hijos, cónyuge). El adicional puede llevar una base extra (aguinaldo en
  // junio/diciembre). Cada componente se redondea por separado (criterio GNS).
  const seguroRate = params.fonasaBasicRate; // 3%
  const adicionalRate = Math.max(0, fonasa.rateTotal - seguroRate);
  const adicionalBase = salarioNominal + (input.fonasaAdicionalExtraBase ?? 0n);

  const fonasaBasico = applyRate(salarioNominal, seguroRate);
  const fonasaFamiliaAporte = applyRate(adicionalBase, adicionalRate);
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
      fonasaRateEfectivo: fonasa.rateTotal,
      fonasaBaseRate: fonasa.baseRate,
      fonasaHijosRate: fonasa.hijosRate,
      fonasaConyugeRate: fonasa.conyugeRate,
      fonasaSeguroRate: seguroRate,
      fonasaAdicionalRate: adicionalRate,
      fonasaAdicionalBase: adicionalBase,
      frlRate: params.frlObreroRate,
    },
  };
}

/**
 * Calcula los aportes patronales (a cargo del empleador).
 *
 * FONASA patronal: 5% para industria/comercio por defecto (500 bp).
 */
export function calcularAportesPatronales(input: AportesInput): AportesPatronales {
  const { salarioNominal, params } = input;

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
