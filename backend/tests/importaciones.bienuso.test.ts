/**
 * BIENES DE USO en importaciones — costeo por artículo y ruteo contable.
 *
 * Regla: una importación puede traer artículos MERCADERÍA (inventario) y
 * BIEN_DE_USO (activo fijo) mezclados. El COSTO se arma con la MISMA fórmula
 * (Adquisición + tributos no recuperables + gastos atribuibles) y se prorratea
 * por FOB; lo único que cambia es la CUENTA de destino: la parte de bienes de uso
 * se capitaliza en "Bienes de Uso", no en "Mercaderías". El costo total y las
 * cantidades no cambian; cuando no hay bienes de uso, nada cambia (MARPOLOS-safe).
 */
import { TributoImportacionTipo } from '@prisma/client';
import { calcularCosteo, armarAsientoImportacion } from '../src/services/importaciones.service';
import { construirCosteoHistorico } from '../src/services/importaciones.costeo.service';

describe('Costeo manual (calcularCosteo) con bienes de uso', () => {
  const base = {
    fob: 90000n, flete: 7000n, seguro: 3000n, // CIF = 100.000
    tributos: [
      { tipo: TributoImportacionTipo.RECARGO, monto: 10000n },        // no recuperable → costo
      { tipo: TributoImportacionTipo.IVA_IMPORTACION, monto: 22000n }, // recuperable → crédito
    ],
    gastos: [],
  };

  test('separa el costo del artículo bien de uso (mismo costo total)', () => {
    const r = calcularCosteo({
      ...base,
      items: [
        { fobTotal: 60000n, clasificacion: 'MERCADERIA' },
        { fobTotal: 40000n, clasificacion: 'BIEN_DE_USO' },
      ],
    });
    // Costo total = CIF 100.000 + no recuperables 10.000 = 110.000.
    expect(r.costoMercaderia).toBe(110000n);
    // Prorrateo por FOB (60/40): 66.000 y 44.000.
    expect(r.costosItems).toEqual([66000n, 44000n]);
    // La parte de bien de uso es el costo del 2.º artículo.
    expect(r.costoBienesDeUso).toBe(44000n);
  });

  test('sin bienes de uso → costoBienesDeUso = 0', () => {
    const r = calcularCosteo({ ...base, items: [{ fobTotal: 60000n }, { fobTotal: 40000n }] });
    expect(r.costoBienesDeUso).toBe(0n);
  });

  test('el asiento rutea la parte bien de uso a su cuenta y balancea', () => {
    const r = calcularCosteo({
      ...base,
      items: [{ fobTotal: 60000n, clasificacion: 'MERCADERIA' }, { fobTotal: 40000n, clasificacion: 'BIEN_DE_USO' }],
    });
    const asiento = armarAsientoImportacion({
      fob: base.fob, flete: base.flete, seguro: base.seguro,
      totalTributos: r.totalTributos, totalGastos: r.totalGastos, anticipos: r.anticipos,
      costoMercaderia: r.costoMercaderia, creditoFiscalIva: r.creditoFiscalIva, gastos: [],
      costoBienesDeUso: r.costoBienesDeUso,
    });
    const bdu = asiento.lineas.find((l) => /Bienes de uso/i.test(l.cuenta));
    const merc = asiento.lineas.find((l) => /Mercader/i.test(l.cuenta));
    expect(bdu?.debe).toBe('44000');
    expect(merc?.debe).toBe('66000'); // 110.000 − 44.000
    expect(asiento.balanceado).toBe(true);
  });
});

describe('Costeo histórico (construirCosteoHistorico) con bienes de uso', () => {
  const factura = (clasifArt2: string | undefined) => ({
    fob: 90000n, flete: 7000n, seguro: 3000n, total: 100000n, moneda: 'USD',
    articulos: [
      { descripcion: 'Insumo', codigo: 'A1', cantidad: 1, total: 60000n, clasificacion: 'MERCADERIA' },
      { descripcion: 'Máquina', codigo: 'A2', cantidad: 1, total: 40000n, clasificacion: clasifArt2 },
    ],
  });
  const input = (clasifArt2: string | undefined) => ({
    dua: {
      nroDua: '123', tipoCambio: 40, valorAduanaPesos: 40000, importadorRut: '210000000011',
      declaranteRut: null, unidadesComerciales: 2, importeFacturas: 1000, moneda: 'USD',
      tributos: [
        { codigo: '01', nombre: 'Recargo', monto: 100 },     // no recuperable
        { codigo: '15', nombre: 'IVA importación', monto: 220 }, // crédito
      ],
    },
    factura: factura(clasifArt2),
    servicios: [],
    anticipos: [{ fecha: '2026-06-09', referencia: 'OP1', moneda: 'USD', monto: 1000, comision: 0, cotizacion: 40, fuente: 'BCU 2026-06-09' }],
    pagoSpeCtms: null, pagoDespachanteCtms: null, fechaReconocimiento: '2026-06-10',
    cotizacionReconocimiento: 40, tcProvisional: null, unidadesPacking: null,
    etiqueta: (k: string) => k,
  });

  test('mixta: separa mercadería y bien de uso, cuadra y queda OK', () => {
    const r = construirCosteoHistorico(input('BIEN_DE_USO'));
    expect(r.estado).toBe('OK');
    // Costo total = adquisición 4.000.000 (1000 USD × 40) + no recuperables 10.000 = 4.010.000.
    expect(r.costoInventario).toBe(4010000n);
    // Prorrateo 60/40: mercadería 2.406.000, bien de uso 1.604.000.
    expect(r.costoBienesDeUso).toBe(1604000n);
    expect(r.costoMercaderia).toBe(2406000n);
    expect((r.costoMercaderia ?? 0n) + (r.costoBienesDeUso ?? 0n)).toBe(r.costoInventario);
    // El alta en stock pasa de Importaciones en trámite a Mercaderías + Bienes de Uso.
    const alta = r.asientos.find((a) => /Alta en stock/i.test(a.glosa));
    expect(alta).toBeTruthy();
    expect(alta!.balanceado).toBe(true);
    expect(alta!.lineas.find((l) => l.cuenta === 'bienesDeUso')?.debe).toBe(1604000n);
    expect(alta!.lineas.find((l) => l.cuenta === 'mercaderiasImportadas')?.debe).toBe(2406000n);
    expect(alta!.lineas.find((l) => l.cuenta === 'mercaderiaTransito')?.haber).toBe(4010000n);
    // La cuenta de tránsito queda saldada y la consistencia cierra.
    expect(r.consistencia.movimientosTransito).toBe(0n);
    expect(r.consistencia.ok).toBe(true);
  });

  test('todo mercadería: sin reclasificación y costoBienesDeUso = 0 (MARPOLOS-safe)', () => {
    const r = construirCosteoHistorico(input(undefined));
    expect(r.estado).toBe('OK');
    expect(r.costoBienesDeUso).toBe(0n);
    expect(r.costoMercaderia).toBe(r.costoInventario);
    expect(r.asientos.some((a) => /Reclasificaci[oó]n a Bienes de Uso/i.test(a.glosa))).toBe(false);
    expect(r.consistencia.ok).toBe(true);
  });

  test('BORRADOR: el costo queda en tránsito, SIN alta en stock (y la consistencia cierra)', () => {
    const r = construirCosteoHistorico({ ...input(undefined), estadoImportacion: 'BORRADOR' });
    expect(r.altaEnStock).toBe(false);
    // No hay asiento de alta en stock.
    expect(r.asientos.some((a) => /Alta en stock/i.test(a.glosa))).toBe(false);
    // Todo el costo sigue acumulado en Importaciones en trámite.
    expect(r.consistencia.movimientosTransito).toBe(r.costoInventario);
    // Igual cierra la verificación (costo = artículos = movimientos a cuentas de costo).
    expect(r.consistencia.ok).toBe(true);
  });

  test('desglose por artículo: Adquisición + Tributos + Gastos = Costo y cada columna cuadra', () => {
    const r = construirCosteoHistorico(input('BIEN_DE_USO'));
    const its = r.items!;
    // En cada artículo, la suma de componentes = su costo.
    for (const i of its) expect(i.adquisicion + i.tributos + i.gastos).toBe(i.costo);
    // Cada columna suma su total (adquisición 4.000.000 · tributos no recup. 10.000 · gastos 0).
    expect(its.reduce((s, i) => s + i.adquisicion, 0n)).toBe(4000000n);
    expect(its.reduce((s, i) => s + i.tributos, 0n)).toBe(10000n);
    expect(its.reduce((s, i) => s + i.gastos, 0n)).toBe(0n);
    // Y la suma de costos cierra con el costo del inventario.
    expect(its.reduce((s, i) => s + i.costo, 0n)).toBe(r.costoInventario);
  });

  test('NACIONALIZADA: aparece el alta en stock y la cuenta de tránsito queda saldada', () => {
    const r = construirCosteoHistorico({ ...input(undefined), estadoImportacion: 'NACIONALIZADA' });
    expect(r.altaEnStock).toBe(true);
    expect(r.asientos.some((a) => /Alta en stock/i.test(a.glosa))).toBe(true);
    expect(r.consistencia.movimientosTransito).toBe(0n);
    expect(r.consistencia.ok).toBe(true);
  });
});

describe('Costeo histórico — Nacionalización vs Tránsito (régimen)', () => {
  // Mismo fixture que el bloque anterior.
  const input = (esTransito: boolean, estado?: string) => ({
    dua: {
      nroDua: '123', tipoCambio: 40, valorAduanaPesos: 40000, importadorRut: '210000000011',
      declaranteRut: null, unidadesComerciales: 2, importeFacturas: 1000, moneda: 'USD',
      tributos: [
        { codigo: '01', nombre: 'Recargo', monto: 100 },     // no recuperable → 10.000
        { codigo: '15', nombre: 'IVA importación', monto: 220 }, // crédito → 22.000
      ],
    },
    factura: {
      fob: 90000n, flete: 7000n, seguro: 3000n, total: 100000n, moneda: 'USD',
      articulos: [
        { descripcion: 'Insumo', codigo: 'A1', cantidad: 1, total: 60000n, clasificacion: 'MERCADERIA' },
        { descripcion: 'Repuesto', codigo: 'A2', cantidad: 1, total: 40000n, clasificacion: 'MERCADERIA' },
      ],
    },
    servicios: [], anticipos: [{ fecha: '2026-06-09', referencia: 'OP1', moneda: 'USD', monto: 1000, comision: 0, cotizacion: 40, fuente: 'BCU 2026-06-09' }],
    pagoSpeCtms: null, pagoDespachanteCtms: null, fechaReconocimiento: '2026-06-10',
    cotizacionReconocimiento: 40, tcProvisional: null, unidadesPacking: null,
    estadoImportacion: estado, esTransito, etiqueta: (k: string) => k,
  });

  test('NACIONALIZACIÓN (definitiva): tributos al costo, IVA crédito y alta en stock', () => {
    const r = construirCosteoHistorico(input(false, 'NACIONALIZADA'));
    expect(r.esTransito).toBe(false);
    // Costo = adquisición 4.000.000 + no recuperables 10.000.
    expect(r.costoInventario).toBe(4010000n);
    expect(r.creditoFiscalIva).toBe(22000n); // IVA importación es crédito
    expect(r.altaEnStock).toBe(true);
    expect(r.asientos.some((a) => /Alta en stock/i.test(a.glosa))).toBe(true);
    expect(r.asientos.some((a) => /Tributos aduaneros/i.test(a.glosa))).toBe(true);
    expect(r.consistencia.ok).toBe(true);
  });

  test('TRÁNSITO: tributos SUSPENDIDOS (fuera del costo y del crédito), sin alta en stock', () => {
    const r = construirCosteoHistorico(input(true, 'NACIONALIZADA')); // aun "nacionalizada", el régimen manda
    expect(r.esTransito).toBe(true);
    // Costo = adquisición 4.000.000 SIN tributos (quedan suspendidos).
    expect(r.costoInventario).toBe(4000000n);
    // El IVA importación NO es crédito en tránsito; sí lo sería el IVA de gastos (acá 0).
    expect(r.creditoFiscalIva).toBe(0n);
    // El DUA de tránsito no trae anticipos de IVA/IRAE ni tributo liquidado: todo en 0.
    expect(r.anticiposFiscales).toBe(0n);
    expect(r.ivaImportacion).toBe(0n);
    expect(r.totalTributos).toBe(0n);
    expect(r.tributosNoRecuperables).toBe(0n);
    expect(r.asientos.some((a) => /Anticipos de IVA\/IRAE/i.test(a.glosa))).toBe(false);
    // Igual queda OK (el DUA y la factura están; el costo no depende de anticipos fiscales).
    expect(r.estado).toBe('OK');
    // Nunca se da alta en stock: la mercadería queda en Importaciones en trámite.
    expect(r.altaEnStock).toBe(false);
    expect(r.asientos.some((a) => /Alta en stock/i.test(a.glosa))).toBe(false);
    expect(r.asientos.some((a) => /Tributos aduaneros/i.test(a.glosa))).toBe(false);
    // Consistencia cierra: el costo (4.000.000) sigue acumulado en tránsito.
    expect(r.consistencia.movimientosTransito).toBe(4000000n);
    expect(r.consistencia.ok).toBe(true);
    // El desglose por artículo no carga tributos (columna tributos = 0) y cada costo cuadra.
    for (const i of r.items!) { expect(i.tributos).toBe(0n); expect(i.adquisicion + i.tributos + i.gastos).toBe(i.costo); }
    expect(r.items!.reduce((s, i) => s + i.costo, 0n)).toBe(r.costoInventario);
  });

  // Detección automática de régimen por el DUA (sin impuestos de nacionalización = tránsito).
  const inputTributos = (esTransito: boolean, tributos: Array<{ codigo: string; nombre: string; monto: number }>) => ({
    dua: { nroDua: '123', tipoCambio: 40, valorAduanaPesos: 40000, importadorRut: '210000000011', declaranteRut: null, unidadesComerciales: 1, importeFacturas: 1000, moneda: 'USD', tributos },
    factura: { fob: 100000n, flete: 0n, seguro: 0n, total: 100000n, moneda: 'USD', articulos: [{ descripcion: 'X', codigo: 'A1', cantidad: 1, total: 100000n, clasificacion: 'MERCADERIA' }] },
    servicios: [], anticipos: [{ fecha: '2026-06-09', referencia: 'OP1', moneda: 'USD', monto: 1000, comision: 0, cotizacion: 40, fuente: 'BCU 2026-06-09' }],
    pagoSpeCtms: null, pagoDespachanteCtms: null, fechaReconocimiento: '2026-06-10', cotizacionReconocimiento: 40,
    tcProvisional: null, unidadesPacking: null, esTransito, etiqueta: (k: string) => k,
  });
  const CON_IVA = [{ codigo: '01', nombre: 'Recargo', monto: 100 }, { codigo: '15', nombre: 'IVA importación', monto: 220 }];
  const SIN_IMP: Array<{ codigo: string; nombre: string; monto: number }> = []; // DUA de tránsito: sin impuestos de nacionalización

  test('marcada NACIONALIZACIÓN pero el DUA no liquida impuestos → avisa que parece tránsito', () => {
    const r = construirCosteoHistorico(inputTributos(false, SIN_IMP));
    expect(r.avisoRegimen).toBeTruthy();
    expect(r.avisoRegimen).toMatch(/TRÁNSITO/);
  });

  test('marcada TRÁNSITO pero el DUA liquida impuestos → avisa que parece nacionalización', () => {
    const r = construirCosteoHistorico(inputTributos(true, CON_IVA));
    expect(r.avisoRegimen).toBeTruthy();
    expect(r.avisoRegimen).toMatch(/NACIONALIZACIÓN/);
  });

  test('régimen coherente con el DUA → sin aviso', () => {
    expect(construirCosteoHistorico(inputTributos(false, CON_IVA)).avisoRegimen).toBeNull(); // nacionalización con impuestos
    expect(construirCosteoHistorico(inputTributos(true, SIN_IMP)).avisoRegimen).toBeNull();  // tránsito sin impuestos
  });

  // IVA del despachante: crédito en nacionalización, COSTO (capitalizado) en tránsito.
  const inputConDespachante = (esTransito: boolean) => ({
    dua: { nroDua: '123', tipoCambio: 40, valorAduanaPesos: 40000, importadorRut: '210000000011', declaranteRut: null, unidadesComerciales: 1, importeFacturas: 1000, moneda: 'USD', tributos: [] as Array<{ codigo: string; nombre: string; monto: number }> },
    factura: { fob: 100000n, flete: 0n, seguro: 0n, total: 100000n, moneda: 'USD', articulos: [{ descripcion: 'X', codigo: 'A1', cantidad: 1, total: 100000n, clasificacion: 'MERCADERIA' }] },
    // Despachante local: honorarios 8.000 + operativos 1.000 = 9.000 gravado, IVA 1.980.
    servicios: [{ rutComprador: '210000000011', moneda: 'UYU', serie: 'A', numero: '900', emisor: 'Despachante', honorarios: 8000, gastosOperativos: 1000, iva: 1980, total: 10980 }],
    anticipos: [{ fecha: '2026-06-09', referencia: 'OP1', moneda: 'USD', monto: 1000, comision: 0, cotizacion: 40, fuente: 'BCU 2026-06-09' }],
    pagoSpeCtms: null, pagoDespachanteCtms: null, fechaReconocimiento: '2026-06-10', cotizacionReconocimiento: 40,
    tcProvisional: null, unidadesPacking: null, esTransito, etiqueta: (k: string) => k,
  });

  test('IVA del despachante: crédito en nacionalización, capitalizado al costo en tránsito', () => {
    const nac = construirCosteoHistorico(inputConDespachante(false));
    const tra = construirCosteoHistorico(inputConDespachante(true));
    const ivaGastos = 198000n; // 1.980 en centésimos
    // Nacionalización: el IVA de servicios es crédito y NO integra el costo.
    expect(nac.creditoFiscalIva).toBe(ivaGastos);
    // Tránsito: sin crédito fiscal; el IVA del despachante se capitaliza al costo.
    expect(tra.creditoFiscalIva).toBe(0n);
    expect(tra.costoInventario! - nac.costoInventario!).toBe(ivaGastos);
    // En tránsito la cuenta de tránsito acumula el costo CON el IVA capitalizado y cierra.
    expect(tra.consistencia.movimientosTransito).toBe(tra.costoInventario);
    expect(tra.consistencia.ok).toBe(true);
    // El IVA capitalizado va a mercadería en tránsito, no a IVA compras de plaza:
    // NINGÚN asiento de tránsito debita IVA compras, y todos balancean.
    const debitaIvaCompras = tra.asientos.some((a) => a.lineas.some((l) => /ivaCompras/i.test(l.cuenta) && l.debe > 0n));
    expect(debitaIvaCompras).toBe(false);
    expect(tra.asientos.every((a) => a.balanceado)).toBe(true);
    // En nacionalización, en cambio, SÍ hay débito de IVA compras (crédito fiscal).
    expect(nac.asientos.some((a) => a.lineas.some((l) => /ivaCompras/i.test(l.cuenta) && l.debe > 0n))).toBe(true);
  });
});
