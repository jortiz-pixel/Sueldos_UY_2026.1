/**
 * TESTS — Base "ApliAFondos" de los Fondos de la Construcción (Fondo Social /
 * Fondo de Vivienda). Regresión del error: la base NO descontaba el IRPF.
 *
 * La base = Total de Haberes (sin reintegros/viáticos/ajustes no gravados)
 * − aportes personales reales (jubilatorio + FONASA seguro + adicional + FRL)
 * − IRPF. Validado contra GNS (Hugo Pimienta, DEMARIA 10/2026).
 */
import { ItemType } from '@prisma/client';
import { baseApliAFondos } from '../src/services/construccion.service';
import { toCtms, divRoundHalfUp } from '../src/utils/money';

type It = { itemType: ItemType; concepto: string; amount: bigint };
const haber = (concepto: string, pesos: number): It => ({ itemType: ItemType.HABER, concepto, amount: toCtms(pesos) });
const desc = (concepto: string, pesos: number): It => ({ itemType: ItemType.DESCUENTO_OBRERO, concepto, amount: toCtms(pesos) });

describe('Base ApliAFondos (Fondos de la Construcción)', () => {
  test('Hugo Pimienta (DEMARIA 10/2026): descuenta FONASA, FRL e IRPF', () => {
    // Total haberes 71.660,73 (materia gravada 64.156,92 + exentos del laudo 7.503,81).
    const items: It[] = [
      haber('SUELDO', 64156.92),
      haber('MEDIAS_HORAS', 7503.81),
      desc('FONASA_ADICIONAL', 1924.71),
      desc('FRL', 64.16),
      desc('IRPF', 2233.87),
    ];
    // 71.660,73 − 1.924,71 − 64,16 − 2.233,87 = 67.437,99 (GNS muestra 67.438,00).
    expect(baseApliAFondos(items)).toBe(toCtms(67437.99));
  });

  test('IRPF 0 no cambia la base (solo resta FONASA + FRL)', () => {
    const items: It[] = [
      haber('SUELDO', 20000),
      desc('FONASA_ADICIONAL', 300),
      desc('FRL', 20),
      desc('IRPF', 0),
    ];
    expect(baseApliAFondos(items)).toBe(toCtms(19680));
  });

  test('Reintegros y viáticos NO integran la base', () => {
    const items: It[] = [
      haber('SUELDO', 30000),
      haber('REINTEGRO_GASTOS', 5000),
      haber('VIATICOS', 4000),
      desc('FRL', 30),
    ];
    expect(baseApliAFondos(items)).toBe(toCtms(29970));
  });

  test('IC: también descuenta jubilatorio y FONASA seguro', () => {
    const items: It[] = [
      haber('SUELDO', 50000),
      desc('BPS_JUBILATORIO', 7500),
      desc('FONASA', 1500),
      desc('FONASA_ADICIONAL', 750),
      desc('FRL', 50),
      desc('IRPF', 1000),
    ];
    // 50.000 − 7.500 − 1.500 − 750 − 50 − 1.000 = 39.200
    expect(baseApliAFondos(items)).toBe(toCtms(39200));
  });

  test('Fondo Social 0,5809% sobre la base da el importe del recibo (Pimienta)', () => {
    const base = toCtms(67437.99);
    // PORCENTAJE_CIENMIL: base × 5809 / 1.000.000.
    const fondoSocial = divRoundHalfUp(base * 5809n, 1000000n);
    const fondoVivienda = divRoundHalfUp(base * 250n, 1000000n);
    expect(fondoSocial).toBe(toCtms(391.75)); // 67.437,99 × 0,5809%
    expect(fondoVivienda).toBe(toCtms(16.86)); // 67.437,99 × 0,025%
  });
});
