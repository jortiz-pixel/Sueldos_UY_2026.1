/**
 * SERVICIO DE PARÁMETROS
 *
 * Lee parámetros de la base de datos según fecha de vigencia.
 * NUNCA hardcodear tasas o BPC en lógica de negocio — siempre usar este servicio.
 */

import { prisma } from '../utils/prisma';
import { toCtms } from '../utils/money';

export interface IrpfBracket {
  fromBpc: number;    // Límite inferior en BPC (ej: 84)
  toBpc: number | null; // Límite superior en BPC (null = sin límite)
  ratePercent: number;  // Tasa en porcentaje (ej: 10.0)
  rateBp: number;       // Tasa en basis points (ej: 1000)
}

export interface PayrollParameters {
  bpc: bigint;                    // BPC en centésimos
  bpsJubilatorioRate: number;     // 1500 bp = 15%
  // FONASA escalonado (Ley 18.131 y modificativas)
  fonasaBasicRate: number;        // 300 bp = 3%  (ingreso <= umbral)
  fonasaBasicHighRate: number;    // 450 bp = 4.5% (ingreso > umbral)
  fonasaThresholdBpc: number;     // 2.5 BPC umbral mensual
  fonasaHijosRate: number;        // 150 bp = +1.5% si tiene hijos a cargo
  fonasaConyugeRate: number;      // 200 bp = +2% si tiene cónyuge a cargo
  fonasaFamiliaRate: number;      // (compat) 200 bp = 2%
  frlObreroRate: number;          // 12.5 bp = 0.125%
  frlPatronalRate: number;        // 2.5 bp = 0.025%
  bpsIvsPatronalRate: number;     // 750 bp = 7.5%
  bseFondoGravamen: number;       // Tasa BSE (configurable por empresa)
  irpfBrackets: IrpfBracket[];
  // Descuentos por cargas de familia (en BPC anuales)
  irpfHijosBpc: number;           // 13 BPC/año por hijo
  irpfHijosDiscapacitadosBpc: number; // 26 BPC/año por hijo discapacitado
  irpfConyugeBpc: number;         // 6 BPC/año por cónyuge
}

const PARAMETER_CACHE = new Map<string, { value: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

async function getParam<T>(key: string, asOfDate: Date = new Date()): Promise<T | null> {
  const cacheKey = `${key}_${asOfDate.toISOString().substring(0, 10)}`;
  const cached = PARAMETER_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value as T;
  }

  const param = await prisma.payrollParameter.findFirst({
    where: {
      key,
      effectiveDate: { lte: asOfDate },
      OR: [{ expiresDate: null }, { expiresDate: { gt: asOfDate } }],
      companyId: null, // global params
    },
    orderBy: { effectiveDate: 'desc' },
  });

  const value = param ? (JSON.parse(param.value) as T) : null;
  if (value !== null) {
    PARAMETER_CACHE.set(cacheKey, { value, ts: Date.now() });
  }
  return value;
}

function clearCache(): void {
  PARAMETER_CACHE.clear();
}

async function getIrpfBrackets(asOfDate: Date = new Date()): Promise<IrpfBracket[]> {
  const brackets = await prisma.irpfBracket.findMany({
    where: {
      effectiveDate: { lte: asOfDate },
      OR: [{ expiresDate: null }, { expiresDate: { gt: asOfDate } }],
    },
    orderBy: { fromBpc: 'asc' },
  });

  return brackets.map((b) => ({
    fromBpc: b.fromBpc,
    toBpc: b.toBpc,
    ratePercent: b.rate / 100,
    rateBp: b.rate,
  }));
}

/**
 * Obtiene todos los parámetros vigentes para una fecha dada.
 * Este es el único punto de entrada para lógica de cálculo.
 */
async function getPayrollParameters(asOfDate: Date = new Date()): Promise<PayrollParameters> {
  const [
    bpcRaw,
    bpsJubilatorioRaw,
    fonasaBasicRaw,
    fonasaBasicHighRaw,
    fonasaThresholdRaw,
    fonasaHijosRaw,
    fonasaConyugeRaw,
    frlObreroRaw,
    frlPatronalRaw,
    bpsIvsRaw,
    irpfHijosRaw,
    irpfHijosDiscapRaw,
    irpfConyugeRaw,
    brackets,
  ] = await Promise.all([
    getParam<number>('BPC', asOfDate),
    getParam<number>('BPS_JUBILATORIO_RATE_BP', asOfDate),
    getParam<number>('FONASA_BASIC_RATE_BP', asOfDate),
    getParam<number>('FONASA_BASIC_HIGH_RATE_BP', asOfDate),
    getParam<number>('FONASA_THRESHOLD_BPC', asOfDate),
    getParam<number>('FONASA_HIJOS_RATE_BP', asOfDate),
    getParam<number>('FONASA_CONYUGE_RATE_BP', asOfDate),
    getParam<number>('FRL_OBRERO_RATE_BP', asOfDate),
    getParam<number>('FRL_PATRONAL_RATE_BP', asOfDate),
    getParam<number>('BPS_IVS_PATRONAL_RATE_BP', asOfDate),
    getParam<number>('IRPF_HIJOS_BPC', asOfDate),
    getParam<number>('IRPF_HIJOS_DISCAPACITADOS_BPC', asOfDate),
    getParam<number>('IRPF_CONYUGE_BPC', asOfDate),
    getIrpfBrackets(asOfDate),
  ]);

  // Fallback values (should always be in DB, but safeguard for dev)
  const fonasaConyuge = fonasaConyugeRaw ?? 200;
  return {
    bpc: toCtms(bpcRaw ?? 6756),              // BPC 2024: $6,756
    bpsJubilatorioRate: bpsJubilatorioRaw ?? 1500,  // 15%
    fonasaBasicRate: fonasaBasicRaw ?? 300,         // 3% (ingreso <= 2.5 BPC)
    fonasaBasicHighRate: fonasaBasicHighRaw ?? 450, // 4.5% (ingreso > 2.5 BPC)
    fonasaThresholdBpc: fonasaThresholdRaw ?? 2.5,  // umbral 2.5 BPC
    fonasaHijosRate: fonasaHijosRaw ?? 150,         // +1.5%
    fonasaConyugeRate: fonasaConyuge,               // +2%
    fonasaFamiliaRate: fonasaConyuge,               // (compat)
    frlObreroRate: frlObreroRaw ?? 12.5,            // 0.125%
    frlPatronalRate: frlPatronalRaw ?? 2.5,         // 0.025%
    bpsIvsPatronalRate: bpsIvsRaw ?? 750,           // 7.5%
    bseFondoGravamen: 25,                           // Default 0.25%; overridden per company
    irpfHijosBpc: irpfHijosRaw ?? 13,              // 13 BPC/año
    irpfHijosDiscapacitadosBpc: irpfHijosDiscapRaw ?? 26, // 26 BPC/año
    irpfConyugeBpc: irpfConyugeRaw ?? 6,            // 6 BPC/año
    irpfBrackets: brackets.length > 0 ? brackets : DEFAULT_IRPF_BRACKETS,
  };
}

/** Escala IRPF Categoría II vigente (Uruguay 2024/2025) — fallback si no hay BD */
const DEFAULT_IRPF_BRACKETS: IrpfBracket[] = [
  { fromBpc: 0,    toBpc: 84,   ratePercent: 0,  rateBp: 0 },
  { fromBpc: 84,   toBpc: 120,  ratePercent: 10, rateBp: 1000 },
  { fromBpc: 120,  toBpc: 180,  ratePercent: 15, rateBp: 1500 },
  { fromBpc: 180,  toBpc: 600,  ratePercent: 24, rateBp: 2400 },
  { fromBpc: 600,  toBpc: 900,  ratePercent: 25, rateBp: 2500 },
  { fromBpc: 900,  toBpc: 1380, ratePercent: 27, rateBp: 2700 },
  { fromBpc: 1380, toBpc: 2100, ratePercent: 31, rateBp: 3100 },
  { fromBpc: 2100, toBpc: null, ratePercent: 36, rateBp: 3600 },
];

export const parametersService = {
  getPayrollParameters,
  getIrpfBrackets,
  getParam,
  clearCache,
  DEFAULT_IRPF_BRACKETS,
};
