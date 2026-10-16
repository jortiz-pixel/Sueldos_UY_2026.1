/**
 * TESTS — MOTOR DE COSTEO DE IMPORTACIONES (cinco problemas corregidos)
 *   1. Conversión de moneda: validación estricta del tipo de cambio.
 *   2. Selección de tributos: desde el DUA, concilia con el pago SPE.
 *   3. Motor de costos: no distribuye si la adquisición está incompleta/inválida.
 *   4. Asientos: separados, balanceados, con reconocimiento bloqueado si pendiente.
 *   5. Extracción: sanitización de identificadores + cantidades de la factura.
 *
 *   npx jest tests/importaciones.costeo.test.ts
 */
import {
  validarTipoCambio, sanitizarIdentificador, construirCosteoDocumental,
  armarAsientosImportacion, CosteoDocInput,
} from '../src/services/importaciones.costeo.service';
import { parseDUA, parseFacturaComercial, parseRecibo } from '../src/services/importaciones.parsers.service';

const C = (n: number) => BigInt(Math.round(n * 100));

// ── 1. Validación del tipo de cambio ─────────────────────────────────────────
describe('validarTipoCambio', () => {
  it('rechaza un año (2026) como tipo de cambio', () => {
    const r = validarTipoCambio(2026);
    expect(r.valido).toBe(false);
    expect(r.valor).toBeNull();
    expect(r.motivo).toMatch(/año/);
  });
  it('rechaza texto, vacío, cero y negativos', () => {
    for (const v of ['', null, undefined, 'USD', 0, -40]) {
      expect(validarTipoCambio(v as unknown).valido).toBe(false);
    }
  });
  it('rechaza valores fuera de rango plausible (fecha mal interpretada)', () => {
    expect(validarTipoCambio(20260828).valido).toBe(false);
    expect(validarTipoCambio(0.001).valido).toBe(false);
  });
  it('acepta un TC plausible (40,266) y lo normaliza desde string', () => {
    expect(validarTipoCambio(40.266)).toEqual({ valido: true, valor: 40.266 });
    expect(validarTipoCambio('40,266')).toEqual({ valido: true, valor: 40.266 });
  });
});

// ── 5. Sanitización de identificadores ───────────────────────────────────────
describe('sanitizarIdentificador', () => {
  it('rechaza fragmentos de rótulo como "/Destinatario" y "s Afectadas:"', () => {
    expect(sanitizarIdentificador('/Destinatario')).toBeNull();
    expect(sanitizarIdentificador('s Afectadas:')).toBeNull();
    expect(sanitizarIdentificador('Proveedor/Destinatario')).toBeNull();
    expect(sanitizarIdentificador('  :  ')).toBeNull();
    expect(sanitizarIdentificador('Carpetas Afectadas:')).toBeNull();
  });
  it('acepta identificadores reales', () => {
    expect(sanitizarIdentificador('FRATELLI CURRAO SRL')).toBe('FRATELLI CURRAO SRL');
    expect(sanitizarIdentificador('105523/2026')).toBe('105523/2026');
  });
});

// Datos MARPOLOS para los tests del motor.
function inputMarpolos(tcContable: number | null): CosteoDocInput {
  return {
    dua: {
      nroDua: '002-2026-170135', tipoCambio: 40.266, valorAduanaPesos: 226650.87,
      importadorRut: '220616930019', importeFacturas: 5628.84, moneda: 'USD',
      tributos: [
        { codigo: '16', monto: 22665 }, { codigo: '15', monto: 49863 }, { codigo: '26', monto: 6800 },
        { codigo: '06', monto: 453 }, { codigo: '27', monto: 380 }, { codigo: '32', monto: 270 },
        { codigo: '05', monto: 1933 }, { codigo: '33', monto: 239 }, { codigo: '36', monto: 563 },
      ],
    },
    factura: {
      fob: C(4838.44), flete: C(760.40), seguro: C(30), total: C(5628.84), moneda: 'USD',
      articulos: [
        { descripcion: 'Art 1', codigo: 'A1', cantidad: 10, total: C(1294.70) },
        { descripcion: 'Art 2', codigo: 'A2', cantidad: 10, total: C(1303.00) },
        { descripcion: 'Art 3', codigo: 'A3', cantidad: 2, total: C(3031.14) },
      ],
    },
    servicios: [
      { rutComprador: '220616930019', moneda: 'UYU', serie: 'A', numero: '0040415', emisor: 'Despachante', honorarios: 5700, gastosOperativos: 2500, iva: 1804, total: 93170 },
      { rutComprador: '217369500013', moneda: 'UYU', serie: 'A', numero: '1921434', emisor: 'TCU', honorarios: null, gastosOperativos: null, iva: null, total: 2286 }, // facturado al despachante → excluido
      { rutComprador: '220616930019', moneda: 'UYU', serie: 'A', numero: '0040414', emisor: 'Despachante', honorarios: null, gastosOperativos: null, iva: null, total: 2286 },
    ],
    pagoSpeCtms: C(83166),
    tcContable,
  };
}

// ── 2 + 3. Motor de costos ───────────────────────────────────────────────────
describe('construirCosteoDocumental', () => {
  it('queda PENDIENTE sin cotización contable y NO distribuye costos', () => {
    const r = construirCosteoDocumental(inputMarpolos(null));
    expect(r.estado).toBe('PENDIENTE');
    expect(r.costoInventario).toBeNull();
    expect(r.items).toBeNull();
    expect(r.motivos.join(' ')).toMatch(/cotización fiscal/i);
    // Aun pendiente, los tributos se toman del DUA (no de una solicitud preliminar).
    expect(r.ivaImportacion).toBe(C(49863));
    expect(r.anticipos).toBe(C(22665));
  });

  it('toma los tributos EXACTOS del DUA y separa el anticipo del crédito fiscal', () => {
    const r = construirCosteoDocumental(inputMarpolos(40.266));
    expect(r.estado).toBe('OK');
    expect(r.ivaImportacion).toBe(C(49863));         // no $49.843
    expect(r.anticipos).toBe(C(22665));              // no $22.656
    expect(r.totalTributos).toBe(C(83166));
    expect(r.creditoFiscalIva).toBe(r.ivaImportacion + r.ivaGastos); // anticipo NO suma
    expect(r.creditoFiscalIva).toBe(C(49863) + C(1804));
    // El anticipo de IVA NO está incluido en el crédito fiscal.
    expect(r.creditoFiscalIva).toBeLessThan(r.creditoFiscalIva + r.anticipos);
    expect(r.creditoFiscalIva - r.ivaGastos).toBe(r.ivaImportacion);
  });

  it('calcula la adquisición con el TC CONTABLE (no el valor en aduana)', () => {
    const r = construirCosteoDocumental(inputMarpolos(40.266));
    expect(r.adquisicionPesos).toBe(BigInt(Math.round(Number(C(4838.44)) * 40.266)));
    expect(r.cifContable).toBe(r.adquisicionPesos + r.fletePesos + r.seguroPesos);
    // El valor en aduana (fiscal) es ~226.650,87 pero NO es el costo base.
    expect(r.valorAduaneroPesos).toBe(C(226650.87));
  });

  it('el costo de inventario = CIF + no recuperables + gastos, y los ítems cuadran', () => {
    const r = construirCosteoDocumental(inputMarpolos(40.266));
    expect(r.costoInventario).toBe(r.cifContable + r.tributosNoRecuperables + r.totalGastos);
    const suma = r.items!.reduce((s, i) => s + i.costo, 0n);
    expect(suma).toBe(r.costoInventario);
    expect(r.items!.length).toBe(3);
  });

  it('excluye los servicios facturados a un tercero (no al importador)', () => {
    const r = construirCosteoDocumental(inputMarpolos(40.266));
    // Solo 2 gastos (A0040415 honorarios + A0040414), no la factura de TCU (al despachante).
    expect(r.gastos.length).toBe(2);
  });

  it('concilia los tributos del DUA contra el pago por SPE', () => {
    const r = construirCosteoDocumental(inputMarpolos(40.266));
    expect(r.conciliacion.duaVsSpe?.ok).toBe(true);
    expect(r.conciliacion.duaVsSpe?.dua).toBe(C(83166));
    expect(r.conciliacion.duaVsSpe?.spe).toBe(C(83166));
  });
});

// ── 4. Asientos separados ────────────────────────────────────────────────────
describe('armarAsientosImportacion', () => {
  const fechas = { factura: '2026-08-21', dua: '2026-08-28', pagoProveedor: '2026-08-26', pagoDespachante: '2026-08-31' };
  const et = (k: string) => k;

  it('OK: emite asientos separados y TODOS balancean', () => {
    const r = construirCosteoDocumental(inputMarpolos(40.266));
    const as = armarAsientosImportacion(r, fechas, et, { proveedor: r.adquisicionPesos, despachante: C(93170) });
    expect(as.every((a) => a.balanceado)).toBe(true);
    const glosas = as.map((a) => a.glosa).join(' | ');
    expect(glosas).toMatch(/Anticipos/);
    expect(glosas).toMatch(/Reconocimiento de la compra/);
    expect(glosas).toMatch(/Tributos del DUA/);
    expect(glosas).toMatch(/Gastos de la operación/);
    expect(glosas).toMatch(/Pago al proveedor/);
    // El anticipo va en su propio asiento, no mezclado con el reconocimiento.
    const compra = as.find((a) => /Reconocimiento/.test(a.glosa))!;
    expect(compra.lineas.some((l) => /anticipo/i.test(l.cuenta))).toBe(false);
  });

  it('PENDIENTE: bloquea el reconocimiento de la compra pero mantiene los anticipos', () => {
    const r = construirCosteoDocumental(inputMarpolos(null));
    const as = armarAsientosImportacion(r, fechas, et);
    expect(as.some((a) => /Reconocimiento de la compra/.test(a.glosa))).toBe(false);
    const anticipo = as.find((a) => /Anticipos/.test(a.glosa));
    expect(anticipo?.definitivo).toBe(true);
    expect(anticipo?.balanceado).toBe(true);
  });
});

// ── 5. Extracción: identificación y cantidades ───────────────────────────────
describe('parsers — identificación saneada', () => {
  const DUA = [
    'Proveedor/Destinatario',
    '[08]Código y Nº Documento [09]Nombre o Razón Social [10]Domicilio Exportador Indirecto',
    'FRATELLI CURRAO SRL AUSTRALIA 866, LOMAS DEL MIRADOR N',
    'Declarante',
    '4-217369500013 PACINI MARTIN ANSELMO 0767',
    '[01]Código y Nº Documento [02]Nombre o Razón Social [03]Domicilio',
    '4-220616930019 MARPOLOS URUGUAY SAS EN FORMACION BLANCO JUAN BENITO 00780',
    '002-2026-170135 ROJO',
  ].join('\n');

  it('el proveedor del DUA es la razón social, NUNCA "/Destinatario"', () => {
    const d = parseDUA(DUA);
    expect(d.proveedor).toBe('FRATELLI CURRAO SRL');
    expect(d.proveedor).not.toMatch(/destinatario/i);
    expect(sanitizarIdentificador(d.proveedor)).toBe('FRATELLI CURRAO SRL');
  });

  it('la factura comercial extrae las cantidades de cada artículo', () => {
    const f = parseFacturaComercial([
      'Razón Social: FRATELLI CURRAO SRL',
      'Compr. Nro: 00006-00000212',
      'ABC123 - Manija Doble 10,00 129,47 1.294,70',
    ].join('\n'));
    expect(f.articulos.length).toBeGreaterThanOrEqual(1);
    expect(f.articulos[0].cantidad).toBe(10);
    expect(f.articulos[0].total).toBeCloseTo(1294.70, 2);
  });

  it('el recibo no acepta "Carpetas Afectadas:" como carpeta', () => {
    const rec = parseRecibo([
      'RUT 217369500013 e-Factura - Cobranza',
      'A 0040379 CONTADO 220616930019',
      'TOTAL: 96.137,00',
      'Carpetas Afectadas:',
      '105523/2026 : 96.137,00',
    ].join('\n'));
    expect(sanitizarIdentificador(rec.carpeta)).toBe('105523/2026');
  });
});
