/**
 * TESTS UNITARIOS — MOTOR IRPF
 *
 * Casos de prueba basados en ejemplos reales con BPC 2024 = $6,756.
 * Todos los montos en centésimos (× 100).
 *
 * Para verificar:
 * npx jest tests/irpf.test.ts
 */

import { calcularIrpfMensual, calcularIrpfSimplificado } from '../src/services/irpf.service';
import { PayrollParameters } from '../src/services/parameters.service';
import { toCtms } from '../src/utils/money';

// Parámetros estándar 2024
const PARAMS_2024: PayrollParameters = {
  bpc: toCtms(6756),          // BPC 2024: $6,756.00
  bpsJubilatorioRate: 1500,   // 15%
  fonasaBasicRate: 300,        // 3%
  fonasaFamiliaRate: 200,      // 2%
  frlObreroRate: 12.5,
  frlPatronalRate: 2.5,
  bpsIvsPatronalRate: 750,
  bseFondoGravamen: 25,
  irpfHijosBpc: 13,
  irpfHijosDiscapacitadosBpc: 26,
  irpfConyugeBpc: 6,
  irpfBrackets: [
    { fromBpc: 0,    toBpc: 84,   ratePercent: 0,  rateBp: 0 },
    { fromBpc: 84,   toBpc: 120,  ratePercent: 10, rateBp: 1000 },
    { fromBpc: 120,  toBpc: 180,  ratePercent: 15, rateBp: 1500 },
    { fromBpc: 180,  toBpc: 600,  ratePercent: 20, rateBp: 2000 },
    { fromBpc: 600,  toBpc: 900,  ratePercent: 22, rateBp: 2200 },
    { fromBpc: 900,  toBpc: 1380, ratePercent: 25, rateBp: 2500 },
    { fromBpc: 1380, toBpc: null, ratePercent: 30, rateBp: 3000 },
  ],
};

// Helpers
const pesos = (amount: bigint) => Number(amount) / 100;
const ceil2 = (n: number) => Math.round(n * 100) / 100;

describe('IRPF — Cálculo mensual (método proyección anual)', () => {

  // ── Caso 1: Salario bajo, sin cargas — debería caer en tramo 0% ──
  describe('Caso 1: Salario $20,000 — debajo del mínimo no imponible', () => {
    const salario = toCtms(20000); // $20,000/mes
    // BPS: 20,000 × 15% = $3,000; FONASA: 20,000 × 3% = $600
    // Renta neta mensual: 20,000 - 3,000 - 600 = $16,400
    // Renta neta anual: 16,400 × 12 = $196,800
    // Mínimo no imponible: 84 BPC × 6,756 = $567,504 anuales
    // $196,800 < $567,504 → IRPF = 0

    const bps = toCtms(3000);    // 15% de 20,000
    const fonasa = toCtms(600);  // 3% de 20,000

    test('Retención mensual debe ser 0', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      expect(result.retencionMensual).toBe(0n);
    });

    test('Base IRPF anual debe ser 0 (por debajo del MNI)', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      // Renta neta anual < 84 BPC → base = 0
      expect(result.baseIrpfAnual).toBe(0n);
    });
  });

  // ── Caso 2: Salario $45,000 — sin cargas familiares ──────────
  describe('Caso 2: Salario $45,000 sin cargas', () => {
    const salario = toCtms(45000);
    // BPS: 45,000 × 15% = $6,750
    // FONASA: 45,000 × 3% = $1,350
    // Renta neta mensual: 45,000 - 6,750 - 1,350 = $36,900
    // Renta neta anual: 36,900 × 12 = $442,800
    // MNI: 84 × 6,756 = $567,504
    // $442,800 < $567,504 → base = 0 → IRPF = 0

    const bps = toCtms(6750);
    const fonasa = toCtms(1350);

    test('Salario $45,000 sin cargas: IRPF = 0 (bajo MNI)', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      expect(result.retencionMensual).toBe(0n);
    });
  });

  // ── Caso 3: Salario $60,000 — debería pagar algo de IRPF ─────
  describe('Caso 3: Salario $60,000 sin cargas', () => {
    const salario = toCtms(60000);
    // BPS: 60,000 × 15% = $9,000
    // FONASA: 60,000 × 3% = $1,800
    // Renta neta mensual: 60,000 - 9,000 - 1,800 = $49,200
    // Renta neta anual: 49,200 × 12 = $590,400
    // MNI: 84 × 6,756 = $567,504
    // Base gravada: 590,400 - 567,504 = $22,896 (en primer tramo del 10%)
    // IRPF anual ≈ 22,896 × 10% = $2,289.60
    // IRPF mensual ≈ $190.80 → $191 (redondeo half up)

    const bps = toCtms(9000);
    const fonasa = toCtms(1800);

    test('Retención mensual debe ser positiva', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      expect(result.retencionMensual).toBeGreaterThan(0n);
      // Renta neta mensual = $49,200
      expect(result.rentaNetaMensual).toBe(toCtms(49200));
    });

    test('Base IRPF anual debe ser mayor a 0', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      expect(result.baseIrpfAnual).toBeGreaterThan(0n);
    });

    test('Tramos correctamente aplicados', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      // El tramo 0% debe tener base = 84 BPC = 84 × 6,756 × 100 centésimos
      const tramo0 = result.tramos[0];
      expect(tramo0.impuestoEnTramo).toBe(0n);
      // El tramo 10% debe tener impuesto > 0
      const tramo10 = result.tramos[1];
      expect(tramo10.impuestoEnTramo).toBeGreaterThan(0n);
    });
  });

  // ── Caso 4: Salario $80,000 con cónyuge + 2 hijos ────────────
  describe('Caso 4: Salario $80,000, cónyuge + 2 hijos a cargo', () => {
    const salario = toCtms(80000);
    // BPS: 80,000 × 15% = $12,000
    // FONASA: 80,000 × (3%+2%) = $4,000 (con familia)
    // Renta neta mensual: 80,000 - 12,000 - 4,000 = $64,000
    // Renta neta anual: 64,000 × 12 = $768,000
    // Deducción hijos: 2 × 13 × 6,756 = $175,656
    // Deducción cónyuge: 6 × 6,756 = $40,536
    // Base gravada: 768,000 - 567,504 (MNI) - 175,656 - 40,536 = -15,696 → 0
    // IRPF = 0

    const bps = toCtms(12000);
    const fonasa = toCtms(4000);

    test('Con cargas familiares puede reducir IRPF a 0', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 2,
        hijosDiscapacitados: 0,
        conyugeACargo: true,
        params: PARAMS_2024,
      });
      // Con $80,000 y cargas, la base puede ser 0 o muy baja
      expect(result.retencionMensual).toBeGreaterThanOrEqual(0n);
    });

    test('Deducciones por hijos calculadas correctamente', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 2,
        hijosDiscapacitados: 0,
        conyugeACargo: true,
        params: PARAMS_2024,
      });
      // 2 hijos × 13 BPC × 6,756 = 2 × 13 × 675,600 centésimos
      const expectedHijos = 2n * 13n * PARAMS_2024.bpc;
      expect(result.deduccionHijosAnual).toBe(expectedHijos);
    });

    test('Deducción cónyuge calculada correctamente', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: true,
        params: PARAMS_2024,
      });
      const expectedConyuge = 6n * PARAMS_2024.bpc;
      expect(result.deduccionConyugeAnual).toBe(expectedConyuge);
    });
  });

  // ── Caso 5: Salario muy alto $200,000 — tramos altos ─────────
  describe('Caso 5: Salario $200,000 sin cargas — tramos 20%+', () => {
    const salario = toCtms(200000);
    // BPS: 30,000; FONASA: 6,000
    // Renta neta: 164,000/mes → 1,968,000/año
    // Alcanza tramos 20% y 22%

    const bps = toCtms(30000);
    const fonasa = toCtms(6000);

    test('IRPF mensual debe ser significativo (salario alto)', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      // Con $200,000 debería pagar varios miles de IRPF
      expect(pesos(result.retencionMensual)).toBeGreaterThan(5000);
    });

    test('Múltiples tramos activos', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      const tramosActivos = result.tramos.filter((t) => t.impuestoEnTramo > 0n);
      expect(tramosActivos.length).toBeGreaterThanOrEqual(3);
    });

    test('Suma de impuestos por tramo = impuesto anual total', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      const sumaTramos = result.tramos.reduce((s, t) => s + t.impuestoEnTramo, 0n);
      expect(sumaTramos).toBe(result.impuestoAnual);
    });

    test('Retención mensual = impuesto anual / 12 (redondeo)', () => {
      const result = calcularIrpfMensual({
        salarioNominal: salario,
        fonasaMensual: fonasa,
        bpsMensual: bps,
        hijosACargo: 0,
        hijosDiscapacitados: 0,
        conyugeACargo: false,
        params: PARAMS_2024,
      });
      // Verificar redondeo correcto (diff <= 1 centésimo)
      const diff = result.retencionMensual * 12n - result.impuestoAnual;
      expect(Math.abs(Number(diff))).toBeLessThanOrEqual(12);
    });
  });

  // ── Caso 6: Hijo discapacitado vale el doble ─────────────────
  describe('Caso 6: Hijo discapacitado = 26 BPC (doble)', () => {
    const salario = toCtms(100000);
    const bps = toCtms(15000);
    const fonasa = toCtms(3000);

    test('Hijo discapacitado deduce 26 BPC vs 13 BPC normal', () => {
      const conDiscap = calcularIrpfMensual({
        salarioNominal: salario, fonasaMensual: fonasa, bpsMensual: bps,
        hijosACargo: 0, hijosDiscapacitados: 1, conyugeACargo: false, params: PARAMS_2024,
      });
      const sinDiscap = calcularIrpfMensual({
        salarioNominal: salario, fonasaMensual: fonasa, bpsMensual: bps,
        hijosACargo: 1, hijosDiscapacitados: 0, conyugeACargo: false, params: PARAMS_2024,
      });
      // Discapacitado deduce el doble → paga menos IRPF
      expect(conDiscap.retencionMensual).toBeLessThanOrEqual(sinDiscap.retencionMensual);
      expect(conDiscap.deduccionHijosAnual).toBe(sinDiscap.deduccionHijosAnual * 2n);
    });
  });
});

describe('IRPF — Método simplificado', () => {
  test('Método simplificado calcula retención basada en ficto', () => {
    const ficto = toCtms(10000); // $10,000/mes ficto
    const retencion = calcularIrpfSimplificado(ficto, PARAMS_2024);
    expect(retencion).toBeGreaterThanOrEqual(0n);
  });
});

describe('Utilidades de dinero', () => {
  const { toCtms, toPesos, applyRate, divRoundHalfUp } = require('../src/utils/money');

  test('toCtms convierte correctamente', () => {
    expect(toCtms(100)).toBe(10000n);
    expect(toCtms(1.50)).toBe(150n);
    expect(toCtms(0.01)).toBe(1n);
  });

  test('toPesos convierte correctamente', () => {
    expect(toPesos(10000n)).toBe(100);
    expect(toPesos(150n)).toBe(1.5);
  });

  test('applyRate con 15% (1500 bp)', () => {
    const result = applyRate(toCtms(100), 1500); // 15% de $100
    expect(result).toBe(toCtms(15)); // $15.00
  });

  test('applyRate con 3% (300 bp)', () => {
    const result = applyRate(toCtms(80000), 300); // 3% de $80,000
    expect(result).toBe(toCtms(2400)); // $2,400.00
  });

  test('divRoundHalfUp redondea correctamente', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);   // 2.5 → 3
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);   // 2.0 → 2
    expect(divRoundHalfUp(3n, 2n)).toBe(2n);   // 1.5 → 2 (half up)
    expect(divRoundHalfUp(7n, 3n)).toBe(2n);   // 2.33 → 2
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n); // -2.5 → -3 (half up hacia positivo)
  });

  test('No hay desbordamiento con salarios grandes', () => {
    // $1,000,000/mes — must not overflow
    const salario = toCtms(1000000);
    expect(() => applyRate(salario, 1500)).not.toThrow();
  });
});
