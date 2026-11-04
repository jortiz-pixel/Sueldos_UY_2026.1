/**
 * TESTS UNITARIOS — CÁLCULOS BPS/FONASA/FRL
 *
 * Incluye los casos obligatorios de la especificación del adicional FONASA
 * (tabla oficial de tasas FONASA del BPS): el adicional por HIJOS a cargo (1,5%)
 * rige SOLO en la franja superior (> 2,5 BPC); el de CÓNYUGE (2%) en ambas.
 */

import {
  calcularAportesObreros,
  calcularAportesPatronales,
  calcularHorasExtra,
  calcularTasaFonasa,
  fonasaCargasDeSeguroSalud,
} from '../src/services/bps.service';
import { PayrollParameters } from '../src/services/parameters.service';
import { toCtms } from '../src/utils/money';

// Parámetros 2026 (BPC $6.864; umbral FONASA = 2,5 BPC = $17.160).
const PARAMS_2026: PayrollParameters = {
  bpc: toCtms(6864),
  bpsJubilatorioRate: 1500,
  bpsTopeJubilatorio: toCtms(272564),
  fonasaBasicRate: 300,       // 3%
  fonasaBasicHighRate: 450,   // 4,5% (> 2,5 BPC)
  fonasaThresholdBpc: 2.5,
  fonasaHijosRate: 150,       // +1,5% (solo franja superior)
  fonasaConyugeRate: 200,     // +2% (ambas franjas)
  fonasaFamiliaRate: 200,
  frlObreroRate: 10,          // 0,10%
  frlPatronalRate: 10,        // 0,10%
  bpsIvsPatronalRate: 750,    // 7,5%
  bseFondoGravamen: 25,
  irpfBrackets: [],
  irpfHijosBpc: 20,
  irpfHijosDiscapacitadosBpc: 40,
  irpfConyugeBpc: 0,
  irpfTasaDeduccionBajaBp: 1400,
  irpfTasaDeduccionAltaBp: 800,
  irpfUmbralDeduccionBpc: 180,
};

// Helper: liquida FONASA por CÓDIGO DE SEGURO DE SALUD (deriva hijos/cónyuge de
// la Tabla 8, igual que el sistema). `franjaPesos` permite pasar el acumulado
// mensual cuando hay varias liquidaciones del mes (determinación de la franja).
function fonasaPorCodigo(codigo: number, nominalPesos: number, franjaPesos?: number) {
  const cargas = fonasaCargasDeSeguroSalud(codigo);
  if (!cargas) throw new Error(`Código de seguro ${codigo} sin regla de cargas FONASA`);
  return calcularAportesObreros({
    salarioNominal: toCtms(nominalPesos),
    hijosACargo: cargas.hijos ? 1 : 0,
    conyugeACargo: cargas.conyuge,
    fonasaRemuneracionFranja: franjaPesos != null ? toCtms(franjaPesos) : undefined,
    params: PARAMS_2026,
    bseRateEmpresa: 0,
  });
}

describe('Adicional FONASA — casos obligatorios de la especificación (BPS)', () => {
  test('Caso A — código 1, $9.927,19 (≤ 2,5 BPC): básico 297,82 · adicional 0', () => {
    const r = fonasaPorCodigo(1, 9927.19);
    expect(r.fonasaBasico).toBe(toCtms(297.82)); // 3%, redondeo medio hacia arriba
    expect(r.fonasaFamilia).toBe(0n);            // hijos NO cuentan en franja inferior
    expect(r.detail.fonasaAdicionalRate).toBe(0);
  });

  test('Caso B — código 1, $20.000 (> 2,5 BPC): básico 600 · adicional 600 (3%) · total 1.200', () => {
    const r = fonasaPorCodigo(1, 20000);
    expect(r.fonasaBasico).toBe(toCtms(600));
    expect(r.fonasaFamilia).toBe(toCtms(600));   // escalón 1,5% + hijos 1,5%
    expect(r.fonasaTotal).toBe(toCtms(1200));
    expect(r.detail.fonasaAdicionalRate).toBe(300);
  });

  test('Caso C — código 15, $20.000: básico 600 · adicional 300 (1,5%) · total 900', () => {
    const r = fonasaPorCodigo(15, 20000);
    expect(r.fonasaBasico).toBe(toCtms(600));
    expect(r.fonasaFamilia).toBe(toCtms(300));   // solo escalón (sin cargas)
    expect(r.fonasaTotal).toBe(toCtms(900));
    expect(r.detail.fonasaAdicionalRate).toBe(150);
  });

  test('Caso D — código 16, $15.000 (≤ 2,5 BPC): básico 450 · adicional 300 (2%) · total 750', () => {
    const r = fonasaPorCodigo(16, 15000);
    expect(r.fonasaBasico).toBe(toCtms(450));
    expect(r.fonasaFamilia).toBe(toCtms(300));   // solo cónyuge (2%); hijos no cuentan ≤ 2,5
    expect(r.fonasaTotal).toBe(toCtms(750));
    expect(r.detail.fonasaAdicionalRate).toBe(200);
  });

  test('Caso E — código 17, $20.000 (> 2,5 BPC): básico 600 · adicional 700 (3,5%) · total 1.300', () => {
    const r = fonasaPorCodigo(17, 20000);
    expect(r.fonasaBasico).toBe(toCtms(600));
    expect(r.fonasaFamilia).toBe(toCtms(700));   // escalón 1,5% + cónyuge 2%
    expect(r.fonasaTotal).toBe(toCtms(1300));
    expect(r.detail.fonasaAdicionalRate).toBe(350);
  });

  test('Caso F — código 1, exactamente $17.160 (= 2,5 BPC): adicional 0%', () => {
    const r = fonasaPorCodigo(1, 17160);
    expect(r.fonasaFamilia).toBe(0n);            // el umbral NO supera 2,5 BPC
    expect(r.detail.fonasaAdicionalRate).toBe(0);
  });

  test('Caso G — código 1, $17.160,01 (> 2,5 BPC): adicional 3%', () => {
    const r = fonasaPorCodigo(1, 17160.01);
    expect(r.detail.fonasaAdicionalRate).toBe(300); // un centésimo arriba ya salta de franja
    expect(r.fonasaFamilia).toBeGreaterThan(0n);
  });

  test('Caso H — dos liquidaciones $10.000 del mismo mes: franja por acumulado $20.000', () => {
    // Con el ACUMULADO MENSUAL, cada liquidación aplica la franja superior.
    const conAcumulado = fonasaPorCodigo(1, 10000, 20000);
    expect(conAcumulado.detail.fonasaAdicionalRate).toBe(300); // franja superior
    expect(conAcumulado.fonasaFamilia).toBe(toCtms(300));      // 3% de $10.000
    expect(conAcumulado.fonasaBasico).toBe(toCtms(300));
    // Sin el acumulado, una sola de $10.000 cae en franja inferior (adicional 0):
    // por eso el llamador DEBE pasar la remuneración mensual acumulada.
    const sinAcumulado = fonasaPorCodigo(1, 10000);
    expect(sinAcumulado.fonasaFamilia).toBe(0n);
  });

  test('Regresión Alexis Lajuni (DEMARIA): $12.571,84 (< 2,5 BPC), código 1 → adicional 0', () => {
    // Antes aplicaba 1,5% por hijos aun debajo de 2,5 BPC (188,58). Debe ser 0.
    const r = fonasaPorCodigo(1, 12571.84);
    expect(r.fonasaFamilia).toBe(0n);
    expect(r.detail.fonasaAdicionalRate).toBe(0);
  });

  test('El umbral es MENSUAL y no se prorratea por días/jornales', () => {
    // Dos jornales con nominal mensual > 2,5 BPC igual aplican franja superior.
    const r = fonasaPorCodigo(15, 18000);
    expect(r.detail.fonasaAdicionalRate).toBe(150);
  });

  test('Código de seguro sin regla parametrizada NO se calcula en silencio', () => {
    // fonasaCargasDeSeguroSalud devuelve null → el llamador debe decidir (no se
    // asignan tasas generales automáticamente).
    expect(fonasaCargasDeSeguroSalud(9)).toBeNull();
    expect(fonasaCargasDeSeguroSalud(999)).toBeNull();
    expect(() => fonasaPorCodigo(9, 20000)).toThrow();
  });
});

describe('Tasa FONASA — matriz de franjas y cargas', () => {
  const casos: Array<[string, boolean, boolean, boolean, number]> = [
    // [nombre, superaUmbral, hijos, conyuge, adicional esperado en bp]
    ['sin cargas ≤ 2,5 BPC', false, false, false, 0],
    ['sin cargas > 2,5 BPC', true, false, false, 150],
    ['hijos ≤ 2,5 BPC (no cuentan)', false, true, false, 0],
    ['hijos > 2,5 BPC', true, true, false, 300],
    ['cónyuge ≤ 2,5 BPC', false, false, true, 200],
    ['cónyuge > 2,5 BPC', true, false, true, 350],
    ['ambos ≤ 2,5 BPC', false, true, true, 200],
    ['ambos > 2,5 BPC', true, true, true, 500],
  ];
  test.each(casos)('adicional según franja/cargas: %s', (_n, supera, hijos, conyuge, adicEsperado) => {
    const nominal = toCtms(supera ? 20000 : 15000);
    const t = calcularTasaFonasa({
      salarioNominal: nominal,
      hijosACargo: hijos ? 1 : 0,
      conyugeACargo: conyuge,
      params: PARAMS_2026,
      bseRateEmpresa: 0,
    });
    expect(t.rateTotal - PARAMS_2026.fonasaBasicRate).toBe(adicEsperado);
  });
});

describe('Aportes Obreros (estructura)', () => {
  const salario = toCtms(45000); // > 2,5 BPC

  test('BPS jubilatorio = 15% = $6.750', () => {
    const r = calcularAportesObreros({ salarioNominal: salario, params: PARAMS_2026, bseRateEmpresa: 0 });
    expect(r.jubilatorio).toBe(toCtms(6750));
  });

  test('FONASA básico = 3% = $1.350 (sin cargas, adicional solo escalón)', () => {
    const r = calcularAportesObreros({ salarioNominal: salario, params: PARAMS_2026, bseRateEmpresa: 0 });
    expect(r.fonasaBasico).toBe(toCtms(1350));
    expect(r.fonasaFamilia).toBe(toCtms(675)); // 1,5% escalón (> 2,5 BPC)
  });

  test('FRL obrero = 0,10% = $45', () => {
    const r = calcularAportesObreros({ salarioNominal: salario, params: PARAMS_2026, bseRateEmpresa: 0 });
    expect(r.frl).toBe(toCtms(45));
  });

  test('Total obreros = jubilatorio + FONASA + FRL', () => {
    const r = calcularAportesObreros({ salarioNominal: salario, params: PARAMS_2026, bseRateEmpresa: 0 });
    expect(r.total).toBe(r.jubilatorio + r.fonasaTotal + r.frl);
  });

  test('Resultados siempre en centésimos enteros (BigInt)', () => {
    const r = calcularAportesObreros({ salarioNominal: 1234567n, params: PARAMS_2026, bseRateEmpresa: 0 });
    expect(typeof r.jubilatorio).toBe('bigint');
    expect(typeof r.fonasaBasico).toBe('bigint');
    expect(typeof r.frl).toBe('bigint');
  });
});

describe('Aportes Patronales', () => {
  const salario = toCtms(45000);

  test('BPS IVS patronal = 7,5% = $3.375', () => {
    const r = calcularAportesPatronales({ salarioNominal: salario, params: PARAMS_2026, bseRateEmpresa: 25, fonasaPatronalRate: 500 });
    expect(r.bpsIvs).toBe(toCtms(3375));
  });

  test('FONASA patronal = 5% = $2.250', () => {
    const r = calcularAportesPatronales({ salarioNominal: salario, params: PARAMS_2026, bseRateEmpresa: 25, fonasaPatronalRate: 500 });
    expect(r.fonasa).toBe(toCtms(2250));
  });

  test('Total patronal = suma de componentes', () => {
    const r = calcularAportesPatronales({ salarioNominal: salario, params: PARAMS_2026, bseRateEmpresa: 25, fonasaPatronalRate: 500 });
    expect(r.total).toBe(r.bpsIvs + r.fonasa + r.frl + r.bse);
  });
});

describe('Horas Extra', () => {
  const salario = toCtms(30000);

  test('Valor hora normal = salario / 200', () => {
    expect(calcularHorasExtra(salario, 0, 0, 200).valorHoraNormal).toBe(toCtms(150));
  });
  test('Diurna 2× + nocturna 2,5×', () => {
    const r = calcularHorasExtra(salario, 3, 2, 200);
    expect(r.total).toBe(toCtms(1650)); // 3×150×2 + 2×150×2,5
  });
});

describe('Proporcional de salario', () => {
  const { salarioProporcional } = require('../src/utils/money');
  test('Mes completo (30 días) = salario completo', () => {
    expect(salarioProporcional(toCtms(50000), 30, 30)).toBe(toCtms(50000));
  });
  test('15 días = 50%', () => {
    expect(salarioProporcional(toCtms(50000), 15, 30)).toBe(toCtms(25000));
  });
});
