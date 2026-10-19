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

// ═════════════════════════════════════════════════════════════════════════════
// COSTEO HISTÓRICO (v2) — adquisición por anticipos, asientos cronológicos,
// gastos desglosados, conciliaciones. Se prueba con MARPOLOS y con OTRO expediente
// distinto (EUR, un solo anticipo que NO cubre el CIF) para verificar generalidad.
// ═════════════════════════════════════════════════════════════════════════════
import { construirCosteoHistorico, CosteoHistoricoInput } from '../src/services/importaciones.costeo.service';

const et = (k: string) => k;

function marpolos(cot09: number | null, cot10: number | null): CosteoHistoricoInput {
  return {
    dua: {
      nroDua: '002-2026-170135', tipoCambio: 40.266, valorAduanaPesos: 226650.87, importadorRut: '220616930019',
      importeFacturas: 5628.84, moneda: 'USD',
      declaranteRut: '217369500013',
      tributos: [
        { codigo: '16', nombre: 'Adelanto IVA', monto: 22665 }, { codigo: '15', nombre: 'IVA importación', monto: 49863 },
        { codigo: '26', nombre: 'Tasa consular', monto: 6800 }, { codigo: '06', nombre: 'TSA', monto: 453 },
        { codigo: '27', nombre: 'Guía', monto: 380 }, { codigo: '32', nombre: 'Timbre', monto: 270 },
        { codigo: '05', nombre: 'Extraordinario', monto: 1933 }, { codigo: '33', nombre: 'VUCE', monto: 239 },
        { codigo: '36', nombre: 'Escáner', monto: 563 },
      ],
    } as any,
    factura: {
      fob: C(4838.44), flete: C(760.40), seguro: C(30), total: C(5628.84), moneda: 'USD',
      articulos: [
        { descripcion: 'A1', codigo: 'A1', cantidad: 200, total: C(2814.42) },
        { descripcion: 'A2', codigo: 'A2', cantidad: 81, total: C(2814.42) },
      ],
    },
    servicios: [
      { rutComprador: '220616930019', rutEmisor: '217369500013', moneda: 'UYU', serie: 'A', numero: '0040415', emisor: 'Despachante', honorarios: 5700, gastosOperativos: 2500, iva: 1804, total: 93170, noFacturable: 83166 },
      { rutComprador: '217369500013', rutEmisor: '214902340010', moneda: 'UYU', serie: 'A', numero: '1921434', emisor: 'TCU', honorarios: null, gastosOperativos: null, iva: null, total: 2286, noFacturable: null }, // facturado a Pacini → excluido
      { rutComprador: '220616930019', rutEmisor: '217369500013', moneda: 'UYU', serie: 'A', numero: '0040414', emisor: 'Despachante', honorarios: null, gastosOperativos: null, iva: null, total: 2286, noFacturable: null, concepto: 'PAGO CTA. DE TERCEROS - Terminal' },
    ],
    anticipos: [
      { fecha: '2026-06-09', referencia: '058197', moneda: 'USD', monto: 3000, comision: 40, cotizacion: cot09 },
      { fecha: '2026-06-10', referencia: '075328', moneda: 'USD', monto: 2628.98, comision: 40, cotizacion: cot10 },
    ],
    pagoSpeCtms: C(83166), pagoDespachanteCtms: C(96137),
    fechaReconocimiento: '2026-08-28', cotizacionReconocimiento: 40.266, tcProvisional: 40.266,
    unidadesPacking: 222, etiqueta: et,
  };
}

describe('construirCosteoHistorico — MARPOLOS', () => {
  it('valúa la adquisición con el TC de CADA anticipo (no el del DUA)', () => {
    const r = construirCosteoHistorico(marpolos(40.10, 40.20));
    expect(r.estado).toBe('OK');
    // Lo PAGADO al proveedor = cada anticipo a su TC de día de pago.
    const pagado = BigInt(Math.round(3000 * 40.10 * 100)) + BigInt(Math.round(2628.98 * 40.20 * 100));
    expect(r.anticiposPagadosUYU).toBe(pagado);
    // La adquisición (mercadería) = pagado menos el exceso sobre el CIF.
    expect(r.adquisicionUYU).toBe(pagado - r.excesoPagado!.uyu);
    // Comisiones bancarias = gasto (no inventario), a su TC de pago.
    expect(r.comisionesBancariasUYU).toBe(BigInt(Math.round(40 * 40.10 * 100)) + BigInt(Math.round(40 * 40.20 * 100)));
  });

  it('queda PROVISIONAL si falta una cotización y usa el TC provisional', () => {
    const r = construirCosteoHistorico(marpolos(40.10, null));
    expect(r.estado).toBe('PROVISIONAL');
    expect(r.motivos.join(' ')).toMatch(/provisional/i);
    // El asiento del 2do anticipo y el reconocimiento NO son definitivos.
    const a2 = r.asientos.find((a) => a.fecha === '2026-06-10');
    expect(a2?.definitivo).toBe(false);
    expect(r.asientos.find((a) => /Reconocimiento/.test(a.glosa))?.definitivo).toBe(false);
  });

  it('tributos del DUA exactos; anticipo IVA separado del crédito fiscal', () => {
    const r = construirCosteoHistorico(marpolos(40.10, 40.20));
    expect(r.ivaImportacion).toBe(C(49863));
    expect(r.anticiposFiscales).toBe(C(22665));
    expect(r.creditoFiscalIva).toBe(C(49863) + r.ivaGastosUYU);
    expect(r.tributosNoRecuperables).toBe(C(83166) - C(49863) - C(22665));
  });

  it('gastos desglosados: excluye lo facturado al despachante (dedup terceros)', () => {
    const r = construirCosteoHistorico(marpolos(40.10, 40.20));
    const tcu = r.gastos.find((g) => g.documento.includes('1921434'));
    expect(tcu?.incluidoEnCosto).toBe(false);
    expect(tcu?.porCuentaDeTerceros).toBe(true);
    // El reembolso del terminal (A-0040414) SÍ entra una vez.
    const reemb = r.gastos.find((g) => g.documento.includes('0040414'));
    expect(reemb?.incluidoEnCosto).toBe(true);
    // Honorarios y gastos operativos entran; el "no facturable" NO.
    expect(r.gastos.some((g) => /Honorarios/.test(g.concepto) && g.incluidoEnCosto)).toBe(true);
    expect(r.gastos.some((g) => /Pagos por cuenta/.test(g.concepto) && !g.incluidoEnCosto)).toBe(true);
  });

  it('costo de inventario = adquisición + no recuperables + gastos; ítems cuadran', () => {
    const r = construirCosteoHistorico(marpolos(40.10, 40.20));
    expect(r.costoInventario).toBe(r.adquisicionUYU + r.tributosNoRecuperables + r.totalGastosUYU);
    const suma = r.items!.reduce((s, i) => s + i.costo, 0n);
    expect(suma).toBe(r.costoInventario);
  });

  it('asientos cronológicos, sin dividir el proveedor del exterior, con referencias', () => {
    const r = construirCosteoHistorico(marpolos(40.10, 40.20));
    const fechas = r.asientos.map((a) => a.fecha);
    expect(fechas).toEqual([...fechas].sort());               // orden cronológico
    expect(r.asientos.every((a) => a.balanceado)).toBe(true);
    expect(r.asientos.every((a) => a.referencias.length > 0)).toBe(true); // trazabilidad
    const rec = r.asientos.find((a) => /Reconocimiento/.test(a.glosa))!;
    expect(rec.lineas.some((l) => /proveedoresLocales/.test(l.cuenta))).toBe(false); // sin split sin respaldo
    // El anticipo lleva su moneda original.
    const a1 = r.asientos.find((a) => a.fecha === '2026-06-09')!;
    expect(a1.lineas.some((l) => l.monedaOrig === 'USD' && l.montoOrig === 3000)).toBe(true);
  });

  it('conciliaciones: 281 unidades DUA = factura; anticipos vs CIF; saldo despachante', () => {
    const inp = marpolos(40.10, 40.20);
    (inp.dua as any).unidadesComerciales = 281;
    const r = construirCosteoHistorico(inp);
    expect(r.conciliacion.unidades.factura).toBe(281);
    expect(r.conciliacion.unidades.dua).toBe(281);
    expect(r.conciliacion.unidades.ok).toBe(true);
    expect(r.conciliacion.anticiposVsCif?.difME).toBeCloseTo(0.14, 2);
    expect(r.conciliacion.tributos?.ok).toBe(true);
    // Cuenta del despachante: cargó 95.456 (hon+gastos+reembolso TCU+no facturable+IVA),
    // pagó 96.137 → saldo $681 a favor del importador (no incluye la agencia de carga).
    expect(r.conciliacion.despachante?.totalCargos).toBe(C(95456));
    expect(r.conciliacion.despachante?.saldo).toBe(C(96137) - C(95456));
  });
});

describe('construirCosteoHistorico — OTRO expediente (EUR, anticipo parcial)', () => {
  const otro: CosteoHistoricoInput = {
    dua: { nroDua: '002-2026-200000', tipoCambio: 45.5, valorAduanaPesos: 455000, importadorRut: '210000000011', importeFacturas: 10000, moneda: 'EUR',
      tributos: [{ codigo: '15', nombre: 'IVA importación', monto: 90000 }, { codigo: '02', nombre: 'Arancel', monto: 12000 }], unidadesComerciales: 50 } as any,
    factura: { fob: C(9500), flete: C(400), seguro: C(100), total: C(10000), moneda: 'EUR',
      articulos: [{ descripcion: 'X', codigo: 'X', cantidad: 50, total: C(10000) }] },
    servicios: [{ rutComprador: '210000000011', moneda: 'UYU', serie: 'A', numero: '900', emisor: 'Despachante', honorarios: 8000, gastosOperativos: 1000, iva: 1980, total: 100000, noFacturable: 102000 }],
    anticipos: [{ fecha: '2026-07-01', referencia: 'OP900', moneda: 'EUR', monto: 6000, comision: 50, cotizacion: 45.0 }], // cubre solo 6000 de 10000
    pagoSpeCtms: C(102000), pagoDespachanteCtms: null,
    fechaReconocimiento: '2026-08-01', cotizacionReconocimiento: 45.8, tcProvisional: 45.5, unidadesPacking: null, etiqueta: et,
  };

  it('el saldo no anticipado se valúa al TC de reconocimiento y va a proveedores del exterior', () => {
    const r = construirCosteoHistorico(otro);
    expect(r.estado).toBe('OK');
    expect(r.saldoNoAnticipado?.me).toBeCloseTo(4000, 2);
    expect(r.saldoNoAnticipado?.uyu).toBe(BigInt(Math.round(4000 * 45.8 * 100)));
    // adquisición = 6000×45.0 + 4000×45.8
    expect(r.adquisicionUYU).toBe(BigInt(Math.round(6000 * 45.0 * 100)) + BigInt(Math.round(4000 * 45.8 * 100)));
    const rec = r.asientos.find((a) => /Reconocimiento/.test(a.glosa))!;
    expect(rec.lineas.some((l) => /proveedoresExterior/.test(l.cuenta) && l.monedaOrig === 'EUR')).toBe(true);
  });

  it('las reglas son generales: tributos del DUA, ítems cuadran, unidades concilian', () => {
    const r = construirCosteoHistorico(otro);
    expect(r.ivaImportacion).toBe(C(90000));
    expect(r.items!.reduce((s, i) => s + i.costo, 0n)).toBe(r.costoInventario);
    expect(r.conciliacion.unidades.ok).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CONSISTENCIA: una única fuente de costo; las tres igualdades deben cerrar, y el
// exceso pagado (USD 0,14) NO se capitaliza. (PASO 4 y PASO 6)
// ═════════════════════════════════════════════════════════════════════════════
describe('construirCosteoHistorico — consistencia e importe en exceso', () => {
  it('NO capitaliza el exceso pagado sobre el CIF (USD 0,14)', () => {
    const r = construirCosteoHistorico(marpolos(40.10, 40.20));
    expect(r.excesoPagado?.me).toBeCloseTo(0.14, 2);
    expect(r.excesoPagado?.uyu).toBe(BigInt(Math.round(0.14 * 40.20 * 100)));
    // adquisición (mercadería) = pagado − exceso.
    expect(r.adquisicionUYU).toBe(r.anticiposPagadosUYU - r.excesoPagado!.uyu);
    // El exceso NO entra al costo de inventario.
    expect(r.costoInventario).toBe(r.adquisicionUYU + r.tributosNoRecuperables + r.totalGastosUYU);
  });

  it('cumple las TRES igualdades (costo = artículos = asientos; adquisición = asiento)', () => {
    const r = construirCosteoHistorico(marpolos(40.10, 40.20));
    expect(r.consistencia.ok).toBe(true);
    expect(r.consistencia.difArticulos).toBe(0n);
    expect(r.consistencia.difAsientos).toBe(0n);
    expect(r.consistencia.difAdquisicion).toBe(0n);
    // Verificación explícita de cada igualdad.
    expect(r.consistencia.sumaCostoArticulos).toBe(r.costoInventario);
    expect(r.consistencia.movimientosMercaderia).toBe(r.costoInventario);
    expect(r.consistencia.adquisicionAsiento).toBe(r.adquisicionUYU);
  });

  it('el asiento de reconocimiento NO deja la diferencia dentro de la mercadería', () => {
    const r = construirCosteoHistorico(marpolos(40.10, 40.20));
    const rec = r.asientos.find((a) => /Reconocimiento/.test(a.glosa))!;
    const debeMerc = rec.lineas.filter((l) => /mercaderiasImportadas/.test(l.cuenta)).reduce((s, l) => s + l.debe, 0n);
    const haberAnt = rec.lineas.filter((l) => /anticiposProveedores/.test(l.cuenta)).reduce((s, l) => s + l.haber, 0n);
    expect(debeMerc).toBe(r.adquisicionUYU);              // mercadería = CIF
    expect(debeMerc).toBe(haberAnt);                       // anticipos aplicados = CIF (el exceso queda como crédito)
    expect(r.anticiposPagadosUYU - haberAnt).toBe(r.excesoPagado!.uyu); // el crédito remanente = exceso
    expect(rec.balanceado).toBe(true);
  });

  it('consistencia general: también cierra en el expediente EUR con anticipo parcial', () => {
    const otro: CosteoHistoricoInput = {
      dua: { nroDua: '1', tipoCambio: 45.5, valorAduanaPesos: 455000, importadorRut: '21', declaranteRut: '99', importeFacturas: 10000, moneda: 'EUR', tributos: [{ codigo: '15', nombre: 'IVA', monto: 90000 }], unidadesComerciales: 50 } as any,
      factura: { fob: C(9500), flete: C(400), seguro: C(100), total: C(10000), moneda: 'EUR', articulos: [{ descripcion: 'X', codigo: 'X', cantidad: 30, total: C(6000) }, { descripcion: 'Y', codigo: 'Y', cantidad: 20, total: C(4000) }] },
      servicios: [{ rutComprador: '21', rutEmisor: '99', moneda: 'UYU', serie: 'A', numero: '900', emisor: 'Despachante', honorarios: 8000, gastosOperativos: 1000, iva: 1980, total: 100000, noFacturable: 0 }],
      anticipos: [{ fecha: '2026-07-01', referencia: 'OP900', moneda: 'EUR', monto: 6000, comision: 50, cotizacion: 45.0 }],
      pagoSpeCtms: C(90000), pagoDespachanteCtms: null, fechaReconocimiento: '2026-08-01', cotizacionReconocimiento: 45.8, tcProvisional: 45.5, unidadesPacking: null, etiqueta: et,
    };
    const r = construirCosteoHistorico(otro);
    expect(r.excesoPagado).toBeNull();
    expect(r.consistencia.ok).toBe(true);
    expect(r.consistencia.movimientosMercaderia).toBe(r.costoInventario);
    expect(r.consistencia.adquisicionAsiento).toBe(r.adquisicionUYU);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FLUJOS DE FONDOS: sin duplicar bancos; cuenta del despachante UNIFICADA; agencia
// separada; asientos con fecha; códigos de artículo; fuente de cotización.
// ═════════════════════════════════════════════════════════════════════════════
function marpolosFlujos(): CosteoHistoricoInput {
  const base = marpolos(40.10, 40.20);
  return {
    ...base,
    servicios: [
      ...base.servicios,
      // Agencia de carga (KIXOLER): prestador distinto, USD, con su fecha y cotización.
      { rutComprador: '220616930019', rutEmisor: '217127640018', moneda: 'USD', serie: 'A', numero: '24391', emisor: 'KIXOLER', honorarios: null, gastosOperativos: null, iva: null, total: 150.64, noFacturable: null, fecha: '2026-08-27', cotizacion: 40.18, fuenteCotizacion: 'BCU 2026-08-27 (venta)' } as any,
    ],
    anticipos: base.anticipos.map((a) => ({ ...a, fuente: `BCU ${a.fecha} (venta)` })),
    fechaPagoDespachante: '2026-08-28',
    pagoAgencia: { fecha: '2026-08-28', moneda: 'USD', montoME: 155 },
  };
}

describe('construirCosteoHistorico — flujos de fondos y cuentas', () => {
  it('NO duplica salidas de banco: los tributos van contra el despachante, no Banco', () => {
    const r = construirCosteoHistorico(marpolosFlujos());
    const trib = r.asientos.find((a) => /Tributos aduaneros/.test(a.glosa))!;
    // La contrapartida de los tributos es Despachantes (los pagó por cuenta), NO Banco.
    expect(trib.lineas.some((l) => /despachantes/.test(l.cuenta) && l.haber === C(83166))).toBe(true);
    expect(trib.lineas.some((l) => /banco/i.test(l.cuenta))).toBe(false);
    // El único egreso en pesos por el despachante es el recibo (no 83.166 + 96.137).
    const bancoPesosHaber = r.asientos.reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === 'bancoPesos').reduce((ss, l) => ss + l.haber, 0n), 0n);
    expect(bancoPesosHaber).toBe(C(96137)); // solo el recibo del despachante
  });

  it('cuenta corriente del despachante UNIFICADA (asientos = conciliación)', () => {
    const r = construirCosteoHistorico(marpolosFlujos());
    expect(r.cuentaDespachante?.cargosUYU).toBe(C(95456)); // tributos 83.166 + gastos 10.486 + IVA 1.804
    expect(r.cuentaDespachante?.pagosUYU).toBe(C(96137));
    expect(r.cuentaDespachante?.saldoUYU).toBe(C(96137) - C(95456)); // 681 a favor
    // La conciliación usa EXACTAMENTE la misma cuenta.
    expect(r.conciliacion.despachante?.totalCargos).toBe(r.cuentaDespachante?.cargosUYU);
    expect(r.conciliacion.despachante?.saldo).toBe(r.cuentaDespachante?.saldoUYU);
  });

  it('la agencia de carga es una cuenta SEPARADA del despachante', () => {
    const r = construirCosteoHistorico(marpolosFlujos());
    const ag = r.asientos.find((a) => /agencia de carga \/ plaza/i.test(a.glosa));
    expect(ag).toBeTruthy();
    expect(ag!.lineas.some((l) => /proveedoresLocales/.test(l.cuenta))).toBe(true);
    // KIXOLER no está en la cuenta del despachante.
    const kix = r.gastos.find((g) => g.documento.includes('24391'))!;
    expect(kix.esDelDespachante).toBe(false);
    expect(kix.fuenteCotizacion).toMatch(/BCU/);
  });

  it('NINGÚN asiento queda sin fecha', () => {
    const r = construirCosteoHistorico(marpolosFlujos());
    expect(r.asientos.length).toBeGreaterThan(0);
    expect(r.asientos.every((a) => !!a.fecha)).toBe(true);
  });

  it('los artículos conservan su código original de la factura', () => {
    const r = construirCosteoHistorico(marpolosFlujos());
    expect(r.items!.every((i) => i.codigo != null && i.codigo !== '')).toBe(true);
    expect(r.items![0].codigo).toBe('A1');
  });

  it('los anticipos muestran la fuente verificable de su cotización', () => {
    const r = construirCosteoHistorico(marpolosFlujos());
    expect(r.anticipos.every((a) => !!a.fuente)).toBe(true);
    expect(r.anticipos[0].fuente).toMatch(/BCU/);
  });

  it('sigue cerrando la consistencia (costo = artículos = asientos) con el flujo nuevo', () => {
    const r = construirCosteoHistorico(marpolosFlujos());
    expect(r.consistencia.ok).toBe(true);
    expect(r.consistencia.difArticulos).toBe(0n);
    expect(r.consistencia.difAsientos).toBe(0n);
    expect(r.asientos.every((a) => a.balanceado)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ACTUALIZACIÓN AUTOMÁTICA: si cambia una cotización o un gasto, el costo del
// inventario se recalcula y SIGUE cumpliendo costo = artículos = asientos. (PASO 5)
// ═════════════════════════════════════════════════════════════════════════════
describe('construirCosteoHistorico — recálculo automático y consistencia', () => {
  it('cambiar la cotización de un anticipo cambia el costo y mantiene las igualdades', () => {
    const a = construirCosteoHistorico(marpolos(40.10, 40.20));
    const b = construirCosteoHistorico(marpolos(41.50, 41.80)); // otras cotizaciones
    expect(b.costoInventario).not.toBe(a.costoInventario);         // el costo se actualiza
    for (const r of [a, b]) {
      expect(r.consistencia.ok).toBe(true);
      expect(r.consistencia.sumaCostoArticulos).toBe(r.costoInventario);
      expect(r.consistencia.movimientosMercaderia).toBe(r.costoInventario);
      expect(r.asientos.every((x) => x.balanceado)).toBe(true);
    }
  });

  it('cambiar un gasto cambia el costo y mantiene las igualdades', () => {
    const base = marpolos(40.10, 40.20);
    const masGasto: CosteoHistoricoInput = { ...base, servicios: base.servicios.map((s) => s.numero === '0040415' ? { ...s, honorarios: 9999 } : s) };
    const a = construirCosteoHistorico(base);
    const b = construirCosteoHistorico(masGasto);
    expect(b.totalGastosUYU).not.toBe(a.totalGastosUYU);
    expect(b.costoInventario).not.toBe(a.costoInventario);
    expect(b.consistencia.ok).toBe(true);
    expect(b.consistencia.sumaCostoArticulos).toBe(b.costoInventario);
    expect(b.consistencia.movimientosMercaderia).toBe(b.costoInventario);
  });

  it('el pago al despachante queda sujeto a confirmación salvo comprobante bancario', () => {
    const r1 = construirCosteoHistorico(marpolosFlujos());
    expect(r1.cuentaDespachante?.pagoConfirmado).toBe(false);
    expect(r1.conciliacion.despachante?.nota).toMatch(/SUJETO A CONFIRMACI/i);
    const r2 = construirCosteoHistorico({ ...marpolosFlujos(), pagoDespachanteConfirmado: true });
    expect(r2.cuentaDespachante?.pagoConfirmado).toBe(true);
    expect(r2.conciliacion.despachante?.nota).not.toMatch(/SUJETO A CONFIRMACI/i);
  });
});
