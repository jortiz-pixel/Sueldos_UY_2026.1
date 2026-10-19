/**
 * TESTS — COSTO FISCAL DE ADQUISICIÓN (IRAE), motor separado del contable.
 * Ninguna prueba depende de importes específicos de MARPOLOS.
 *   npx jest tests/importaciones.fiscal.test.ts
 */
import { TributoImportacionTipo } from '@prisma/client';
import { construirCostoFiscalAdquisicion, CostoFiscalInput, CostoFiscalConfig, resolverFechaFiscalOperacion } from '../src/services/importaciones.fiscal.service';

const C = (n: number) => BigInt(Math.round(n * 100));

// Config fiscal validada y completa (criterio Art. 74, fecha = nacionalización).
const configOK: CostoFiscalConfig = {
  validado: true,
  metodoValuacionInventario: 'ADQUISICION',
  criterioMonedaExtranjera: 'ART74_INTERBANCARIO_COMPRADOR_DIA_ANTERIOR',
  criterioFechaOperacion: 'NACIONALIZACION',
  tratamientoIva: 'RECUPERABLE_TOTAL',
};

// Cotización fiscal (Art. 74) por fecha de operación.
const cotFija = (valor: number) => () => ({ valor, fuente: `BCU comprador billete (Art. 74) ${valor}` });

/** Escenario base parametrizable (sin depender de MARPOLOS). */
function escenario(opts: {
  anticipos?: Array<{ fecha: string | null; montoME: number }>;
  saldoNoAnticipado?: { me: number; uyu: bigint } | null;
  excesoPagado?: { me: number; uyu: bigint } | null;
  gastos?: CostoFiscalInput['contable']['gastos'];
  tributosNoRec?: bigint;
  ivaImportacion?: bigint;
  ivaGastos?: bigint;
  adquisicionUYU: bigint;
  cifME: number;
  articulos?: Array<{ codigo: string; descripcion: string; cantidad: number; fobME: bigint }>;
  config?: CostoFiscalConfig | null;
  cot?: CostoFiscalInput['cotizacionFiscal'];
  moneda?: string;
}): CostoFiscalInput {
  const arts = opts.articulos ?? [
    { codigo: 'A1', descripcion: 'Artículo 1', cantidad: 10, fobME: C(600) },
    { codigo: 'A2', descripcion: 'Artículo 2', cantidad: 5, fobME: C(400) },
  ];
  const tributosNoRec = opts.tributosNoRec ?? C(5000);
  const gastos = opts.gastos ?? [{ documento: 'Desp A1', concepto: 'Honorarios', moneda: 'UYU', fecha: '2026-03-10', montoME: 2000, montoUYU: C(2000), incluidoEnCosto: true, esDelDespachante: true }];
  const totalGastosUYU = gastos.filter((g) => g.incluidoEnCosto).reduce((s, g) => s + g.montoUYU, 0n);
  const costoInventario = opts.adquisicionUYU + tributosNoRec + totalGastosUYU;
  const sumaFob = arts.reduce((s, a) => s + a.fobME, 0n);
  let acum = 0n;
  const items = arts.map((a, i) => {
    let costo: bigint;
    if (sumaFob > 0n && i < arts.length - 1) { costo = (costoInventario * a.fobME) / sumaFob; acum += costo; }
    else costo = costoInventario - acum;
    return { codigo: a.codigo, descripcion: a.descripcion, cantidad: a.cantidad, fobME: a.fobME, costo };
  });
  return {
    contable: {
      adquisicionUYU: opts.adquisicionUYU, tributosNoRecuperables: tributosNoRec, totalGastosUYU, costoInventario,
      ivaImportacion: opts.ivaImportacion ?? C(8000), ivaGastosUYU: opts.ivaGastos ?? 0n,
      anticipos: opts.anticipos ?? [{ fecha: '2026-02-01', montoME: opts.cifME }],
      excesoPagado: opts.excesoPagado ?? null, saldoNoAnticipado: opts.saldoNoAnticipado ?? null,
      gastos, tributos: [{ tipo: TributoImportacionTipo.TASA_SERVICIOS, monto: tributosNoRec, recuperable: false, codigo: '06' }],
      items, cifME: opts.cifME, monedaOrigen: opts.moneda ?? 'USD',
    },
    factura: { numero: 'F-1', fecha: '2026-03-01', articulos: arts.map((a) => ({ ...a, unidad: 'u' })) },
    fechas: { nacionalizacion: '2026-03-15', factura: '2026-03-01' },
    duaNumero: '000-0000-000000',
    config: opts.config === undefined ? configOK : opts.config,
    cotizacionFiscal: opts.cot ?? cotFija(39.5),
  };
}

const num = (s: string | null) => (s == null ? null : Number(s));

describe('costo fiscal — prudencia (pendiente de aprobación)', () => {
  it('sin configuración fiscal → PENDIENTE y NO emite importe (no usa el contable)', () => {
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, config: null }));
    expect(r.estado).toBe('PENDIENTE');
    expect(r.definitivo).toBe(false);
    expect(r.totales.costoFiscal).toBeNull();
    expect(r.items.every((i) => i.costoFiscalTotal === null)).toBe(true);
    expect(r.motivos.join(' ')).toMatch(/configuraci/i);
  });

  it('config sin validar → PENDIENTE', () => {
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, config: { ...configOK, validado: false } }));
    expect(r.estado).toBe('PENDIENTE');
    expect(r.motivos.join(' ')).toMatch(/no está validada/i);
  });

  it('método PLAZA → PENDIENTE (este módulo sólo COSTO DE ADQUISICIÓN de ingreso)', () => {
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, config: { ...configOK, metodoValuacionInventario: 'PLAZA' } }));
    expect(r.estado).toBe('PENDIENTE');
    expect(r.motivos.join(' ')).toMatch(/COSTO DE ADQUISICIÓN/i);
  });

  it('falta la cotización fiscal de una fecha → PENDIENTE con motivo (Art. 74)', () => {
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, cot: () => null }));
    expect(r.estado).toBe('PENDIENTE');
    expect(r.motivos.join(' ')).toMatch(/cotización fiscal.*Art\. 74/i);
    expect(r.totales.costoFiscal).toBeNull();
  });
});

describe('costo fiscal — cálculo con config validada', () => {
  it('OK: suma de costos fiscales por artículo = costo fiscal total', () => {
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, cot: cotFija(39.5) }));
    expect(r.estado).toBe('OK');
    const total = BigInt(r.totales.costoFiscal!);
    const suma = r.items.reduce((s, i) => s + BigInt(i.costoFiscalTotal!), 0n);
    expect(suma).toBe(total);
    // Mercadería fiscal = 1000 × 39,5 ; + tributos 5000 + gastos 2000.
    expect(total).toBe(C(39500) + C(5000) + C(2000));
  });

  it('la conciliación contable→fiscal cierra (base + ajustes = fiscal)', () => {
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, cot: cotFija(39.5) }));
    expect(r.conciliacion.cuadra).toBe(true);
    expect(r.conciliacion.costoFiscal).toBe(r.totales.costoFiscal);
    // Hay un ajuste por diferencia de cambio (Art. 74) ≠ 0.
    expect(r.conciliacion.ajustes.some((a) => /diferencia de cambio.*mercader/i.test(a.concepto))).toBe(true);
  });

  it('diferencia de cambio: TC fiscal (comprador) ≠ TC contable (venta) → diferencia explicada, no cero', () => {
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, cot: cotFija(39.5) }));
    const difMerc = num(r.items[0].diferencia); // contable − fiscal, >0 porque fiscal menor
    expect(r.totales.diferencia).not.toBe('0');
    expect(difMerc).not.toBeNull();
    const aj = r.conciliacion.ajustes.find((a) => /mercader/i.test(a.concepto))!;
    expect(aj.norma).toMatch(/Art\. 74/);
  });

  it('cuando el criterio fiscal coincide con el contable, NO hay diferencia artificial', () => {
    // Si la cotización fiscal es la misma que valuó el contable (40), el costo fiscal = contable.
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, cot: cotFija(40) }));
    expect(r.estado).toBe('OK');
    expect(r.totales.costoFiscal).toBe(r.totales.costoContable);
    expect(r.totales.diferencia).toBe('0');
    expect(r.conciliacion.ajustes.length).toBe(0);
  });
});

describe('costo fiscal — escenarios de importación', () => {
  it('contado (sin anticipos, saldo total) a TC de nacionalización', () => {
    const r = construirCostoFiscalAdquisicion(escenario({
      adquisicionUYU: C(41000), cifME: 1000, anticipos: [], saldoNoAnticipado: { me: 1000, uyu: C(41000) }, cot: cotFija(40),
    }));
    expect(r.estado).toBe('OK');
    expect(BigInt(r.totales.costoFiscal!)).toBe(C(40000) + C(5000) + C(2000));
  });

  it('anticipos a TC de pago (criterio PAGO) usando cada cotización fiscal', () => {
    const cot = (f: string) => ({ '2026-01-10': { valor: 38, fuente: 'BCU' }, '2026-02-10': { valor: 39, fuente: 'BCU' } } as Record<string, { valor: number; fuente: string }>)[f] ?? null;
    const r = construirCostoFiscalAdquisicion(escenario({
      adquisicionUYU: C(40000), cifME: 1000,
      anticipos: [{ fecha: '2026-01-10', montoME: 600 }, { fecha: '2026-02-10', montoME: 400 }],
      config: { ...configOK, criterioFechaOperacion: 'PAGO' }, cot,
    }));
    expect(r.estado).toBe('OK');
    // 600×38 + 400×39 = 22800 + 15600 = 38400 ; + 5000 + 2000.
    expect(BigInt(r.totales.costoFiscal!)).toBe(C(38400) + C(5000) + C(2000));
  });

  it('saldo pendiente (anticipos parciales) — anticipo a su TC y saldo al de nacionalización', () => {
    const cot = (f: string) => ({ '2026-01-10': { valor: 38, fuente: 'BCU' }, '2026-03-15': { valor: 41, fuente: 'BCU' } } as Record<string, { valor: number; fuente: string }>)[f] ?? null;
    const r = construirCostoFiscalAdquisicion(escenario({
      adquisicionUYU: C(40000), cifME: 1000,
      anticipos: [{ fecha: '2026-01-10', montoME: 600 }],
      saldoNoAnticipado: { me: 400, uyu: C(16400) },
      config: { ...configOK, criterioFechaOperacion: 'PAGO' }, cot,
    }));
    expect(r.estado).toBe('OK');
    // 600×38 (anticipo) + 400×41 (saldo a nacionalización) = 22800 + 16400 = 39200.
    expect(BigInt(r.totales.costoFiscal!)).toBe(C(39200) + C(5000) + C(2000));
  });

  it('varias facturas / varios artículos: la distribución por FOB cuadra con el total', () => {
    const arts = [
      { codigo: 'X1', descripcion: 'Uno', cantidad: 3, fobME: C(250) },
      { codigo: 'X2', descripcion: 'Dos', cantidad: 7, fobME: C(350) },
      { codigo: 'X3', descripcion: 'Tres', cantidad: 2, fobME: C(400) },
    ];
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, articulos: arts, cot: cotFija(39.5) }));
    const suma = r.items.reduce((s, i) => s + BigInt(i.costoFiscalTotal!), 0n);
    expect(suma).toBe(BigInt(r.totales.costoFiscal!));
    expect(r.items.length).toBe(3);
  });

  it('distintas monedas: gasto en ME se re-valúa por Art. 74 (no al TC contable)', () => {
    const gastos = [
      { documento: 'Desp', concepto: 'Honorarios', moneda: 'UYU', fecha: '2026-03-10', montoME: 2000, montoUYU: C(2000), incluidoEnCosto: true, esDelDespachante: true },
      { documento: 'Agencia USD', concepto: 'Flete local', moneda: 'USD', fecha: '2026-03-12', montoME: 100, montoUYU: C(4000), incluidoEnCosto: true, esDelDespachante: false },
    ];
    const cot = (f: string) => ({ '2026-03-15': { valor: 39.5, fuente: 'BCU' }, '2026-03-12': { valor: 39, fuente: 'BCU' } } as Record<string, { valor: number; fuente: string }>)[f] ?? null;
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, gastos, cot }));
    expect(r.estado).toBe('OK');
    // gasto USD fiscal = 100 × 39 = 3900 (≠ 4000 contable) ; gasto UYU = 2000.
    // mercadería 1000×39,5=39500 + tributos 5000 + gastos (2000+3900)=5900.
    expect(BigInt(r.totales.costoFiscal!)).toBe(C(39500) + C(5000) + C(5900));
  });

  it('IVA parcialmente no recuperable (prorrata) integra el costo', () => {
    const r = construirCostoFiscalAdquisicion(escenario({
      adquisicionUYU: C(40000), cifME: 1000, ivaImportacion: C(8000), ivaGastos: C(0),
      config: { ...configOK, tratamientoIva: 'PRORRATA', porcentajeIvaNoRecuperable: 50 }, cot: cotFija(40),
    }));
    expect(r.estado).toBe('OK');
    // IVA no recuperable = 50% de 8000 = 4000, se suma.
    expect(BigInt(r.totales.costoFiscal!)).toBe(C(40000) + C(5000) + C(2000) + C(4000));
    expect(r.conciliacion.ajustes.some((a) => /IVA no recuperable/i.test(a.concepto))).toBe(true);
  });

  it('IVA totalmente no recuperable suma todo el crédito al costo', () => {
    const r = construirCostoFiscalAdquisicion(escenario({
      adquisicionUYU: C(40000), cifME: 1000, ivaImportacion: C(8000), ivaGastos: C(500),
      config: { ...configOK, tratamientoIva: 'NO_RECUPERABLE' }, cot: cotFija(40),
    }));
    expect(BigInt(r.totales.costoFiscal!)).toBe(C(40000) + C(5000) + C(2000) + C(8500));
  });

  it('gastos facturados posteriormente (fecha propia) se re-valúan a su fecha fiscal', () => {
    const gastos = [{ documento: 'Gasto posterior USD', concepto: 'Servicio', moneda: 'USD', fecha: '2026-04-20', montoME: 50, montoUYU: C(2100), incluidoEnCosto: true, esDelDespachante: false }];
    const cot = (f: string) => ({ '2026-03-15': { valor: 39.5, fuente: 'BCU' }, '2026-04-20': { valor: 42, fuente: 'BCU' } } as Record<string, { valor: number; fuente: string }>)[f] ?? null;
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, gastos, cot }));
    // gasto fiscal = 50 × 42 = 2100 ; mercadería 39500 + tributos 5000 + gasto 2100.
    expect(BigInt(r.totales.costoFiscal!)).toBe(C(39500) + C(5000) + C(2100));
  });

  it('materias primas y reventa directa dan el MISMO costo de adquisición (tipoBienes informativo)', () => {
    const mp = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, config: { ...configOK }, cot: cotFija(39.5) }));
    const rev = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, config: { ...configOK }, cot: cotFija(39.5) }));
    expect(mp.totales.costoFiscal).toBe(rev.totales.costoFiscal);
  });

  it('el exceso pagado sobre el CIF NO integra el costo fiscal (queda excluido)', () => {
    const r = construirCostoFiscalAdquisicion(escenario({
      adquisicionUYU: C(40000), cifME: 1000, excesoPagado: { me: 0.14, uyu: C(6) }, cot: cotFija(39.5),
    }));
    // La mercadería fiscal se valúa sobre el CIF (1000), no sobre lo pagado de más.
    expect(BigInt(r.totales.costoFiscal!)).toBe(C(39500) + C(5000) + C(2000));
    expect(r.componentes.find((c) => c.clave === 'F')!.nota).toMatch(/exceso/i);
  });
});

describe('costo fiscal — resolución de fecha fiscal y normas', () => {
  it('resuelve la fecha fiscal según el criterio', () => {
    const fechas = { nacionalizacion: '2026-03-15', factura: '2026-03-01' };
    const ant = [{ fecha: '2026-01-10' }];
    expect(resolverFechaFiscalOperacion('NACIONALIZACION', fechas, ant)).toBe('2026-03-15');
    expect(resolverFechaFiscalOperacion('FACTURA', fechas, ant)).toBe('2026-03-01');
    expect(resolverFechaFiscalOperacion('PAGO', fechas, ant)).toBe('2026-01-10');
    expect(resolverFechaFiscalOperacion(null, fechas, ant)).toBeNull();
  });

  it('expone las normas aplicadas con su artículo y vigencia', () => {
    const r = construirCostoFiscalAdquisicion(escenario({ adquisicionUYU: C(40000), cifME: 1000, cot: cotFija(40) }));
    expect(r.normas.some((n) => /Art\. 74/.test(n.articulo))).toBe(true);
    expect(r.normas.some((n) => /Art\. 80/.test(n.articulo))).toBe(true);
    expect(r.normas.every((n) => !!n.vigenciaDesde && !!n.fuente)).toBe(true);
  });
});
