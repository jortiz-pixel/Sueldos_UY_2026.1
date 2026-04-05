/**
 * TESTS UNITARIOS — CÁLCULOS BPS/FONASA/FRL
 */

import { calcularAportesObreros, calcularAportesPatronales, calcularHorasExtra } from '../src/services/bps.service';
import { PayrollParameters } from '../src/services/parameters.service';
import { toCtms, toPesos } from '../src/utils/money';

const PARAMS_2024: PayrollParameters = {
  bpc: toCtms(6756),
  bpsJubilatorioRate: 1500,
  fonasaBasicRate: 300,
  fonasaFamiliaRate: 200,
  frlObreroRate: 12.5,
  frlPatronalRate: 2.5,
  bpsIvsPatronalRate: 750,
  bseFondoGravamen: 25,
  irpfHijosBpc: 13,
  irpfHijosDiscapacitadosBpc: 26,
  irpfConyugeBpc: 6,
  irpfBrackets: [],
};

describe('Aportes Obreros', () => {

  describe('Salario $45,000 sin familia', () => {
    const salario = toCtms(45000);

    test('BPS jubilatorio = 15% = $6,750', () => {
      const result = calcularAportesObreros({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
      });
      expect(result.jubilatorio).toBe(toCtms(6750));
    });

    test('FONASA básico = 3% = $1,350', () => {
      const result = calcularAportesObreros({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
      });
      expect(result.fonasaBasico).toBe(toCtms(1350));
      expect(result.fonasaFamilia).toBe(0n);
    });

    test('FRL = 0.125% = $56.25 → $56 (redondeo)', () => {
      const result = calcularAportesObreros({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
      });
      // 45,000 × 0.00125 = 56.25 → 56 centésimos (redondeado)
      expect(Number(result.frl)).toBeCloseTo(5625, 0); // en centésimos
    });

    test('Total obreros = BPS + FONASA + FRL', () => {
      const result = calcularAportesObreros({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
      });
      expect(result.total).toBe(result.jubilatorio + result.fonasaTotal + result.frl);
    });
  });

  describe('Salario $45,000 CON familia a cargo', () => {
    const salario = toCtms(45000);

    test('FONASA con familia = 5% = $2,250', () => {
      const result = calcularAportesObreros({
        salarioNominal: salario,
        fonasaFamilia: true,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
      });
      expect(result.fonasaTotal).toBe(toCtms(2250));
      expect(result.fonasaBasico).toBe(toCtms(1350));  // 3%
      expect(result.fonasaFamilia).toBe(toCtms(900));  // 2%
    });
  });

  describe('Precisión de centésimos', () => {
    test('No hay pérdida de precisión con salarios irregulares', () => {
      // Salario impar: $37,500.00
      const salario = toCtms(37500);
      const result = calcularAportesObreros({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
      });
      // BPS: 37,500 × 15% = $5,625.00
      expect(result.jubilatorio).toBe(toCtms(5625));
      // FONASA: 37,500 × 3% = $1,125.00
      expect(result.fonasaBasico).toBe(toCtms(1125));
    });

    test('Resultado siempre en centésimos enteros (sin fracciones)', () => {
      const salario = 1234567n; // centésimos: $12,345.67
      const result = calcularAportesObreros({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
      });
      // Verificar que todos los resultados son BigInt (enteros)
      expect(typeof result.jubilatorio).toBe('bigint');
      expect(typeof result.fonasaBasico).toBe('bigint');
      expect(typeof result.frl).toBe('bigint');
    });
  });
});

describe('Aportes Patronales', () => {

  describe('Salario $45,000', () => {
    const salario = toCtms(45000);

    test('BPS IVS patronal = 7.5% = $3,375', () => {
      const result = calcularAportesPatronales({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
        fonasaPatronalRate: 500,
      });
      expect(result.bpsIvs).toBe(toCtms(3375));
    });

    test('FONASA patronal = 5% = $2,250', () => {
      const result = calcularAportesPatronales({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
        fonasaPatronalRate: 500,
      });
      expect(result.fonasa).toBe(toCtms(2250));
    });

    test('FRL patronal = 0.025%', () => {
      const result = calcularAportesPatronales({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
        fonasaPatronalRate: 500,
      });
      // 45,000 × 0.00025 = $11.25 → $11 o $12 centésimos (redondeo)
      expect(Number(result.frl)).toBeCloseTo(1125, 0); // centésimos
    });

    test('BSE = tasa configurada × salario', () => {
      const result = calcularAportesPatronales({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,  // 0.25%
        fonasaPatronalRate: 500,
      });
      // 45,000 × 0.0025 = $112.50 → $112 o $113
      expect(Number(result.bse)).toBeCloseTo(11250, 0); // centésimos: $112.50
    });

    test('Total patronal = suma de componentes', () => {
      const result = calcularAportesPatronales({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
        fonasaPatronalRate: 500,
      });
      expect(result.total).toBe(result.bpsIvs + result.fonasa + result.frl + result.bse);
    });
  });

  describe('Carga total empleador vs empleado', () => {
    test('Carga patronal total > 12% del salario', () => {
      const salario = toCtms(50000);
      const result = calcularAportesPatronales({
        salarioNominal: salario,
        fonasaFamilia: false,
        params: PARAMS_2024,
        bseRateEmpresa: 25,
        fonasaPatronalRate: 500,
      });
      // IVS(7.5%) + FONASA(5%) + FRL(0.025%) + BSE(0.25%) ≈ 12.775%
      const pctPatronal = (Number(result.total) / Number(salario)) * 100;
      expect(pctPatronal).toBeGreaterThan(12);
      expect(pctPatronal).toBeLessThan(15);
    });
  });
});

describe('Horas Extra', () => {

  describe('Cálculo de valor hora', () => {
    const salario = toCtms(30000); // $30,000/mes

    test('Valor hora normal = salario / 200', () => {
      const result = calcularHorasExtra(salario, 0, 0, 200);
      // $30,000 / 200 = $150/hora
      expect(result.valorHoraNormal).toBe(toCtms(150));
    });

    test('Hora extra diurna = 2× valor hora', () => {
      const result = calcularHorasExtra(salario, 5, 0, 200);
      // 5 horas × $150 × 2 = $1,500
      expect(result.importeHorasDiurnas).toBe(toCtms(1500));
    });

    test('Hora extra nocturna = 2.5× valor hora', () => {
      const result = calcularHorasExtra(salario, 0, 4, 200);
      // 4 horas × $150 × 2.5 = $1,500
      expect(result.importeHorasNocturnas).toBe(toCtms(1500));
    });

    test('Combinado: diurnas + nocturnas', () => {
      const result = calcularHorasExtra(salario, 3, 2, 200);
      // Diurnas: 3 × 150 × 2 = $900
      // Nocturnas: 2 × 150 × 2.5 = $750
      // Total: $1,650
      expect(result.total).toBe(toCtms(1650));
    });

    test('Sin horas extra: importe = 0', () => {
      const result = calcularHorasExtra(salario, 0, 0, 200);
      expect(result.total).toBe(0n);
      expect(result.importeHorasDiurnas).toBe(0n);
      expect(result.importeHorasNocturnas).toBe(0n);
    });
  });
});

describe('Proporcional de salario', () => {
  const { salarioProporcional } = require('../src/utils/money');

  test('Mes completo (30 días) = salario completo', () => {
    const salario = toCtms(50000);
    expect(salarioProporcional(salario, 30, 30)).toBe(salario);
  });

  test('15 días = 50% del salario', () => {
    const salario = toCtms(50000);
    expect(salarioProporcional(salario, 15, 30)).toBe(toCtms(25000));
  });

  test('1 día = 1/30 del salario', () => {
    const salario = toCtms(30000);
    expect(salarioProporcional(salario, 1, 30)).toBe(toCtms(1000));
  });
});
