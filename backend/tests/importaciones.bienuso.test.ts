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

  test('NACIONALIZADA: aparece el alta en stock y la cuenta de tránsito queda saldada', () => {
    const r = construirCosteoHistorico({ ...input(undefined), estadoImportacion: 'NACIONALIZADA' });
    expect(r.altaEnStock).toBe(true);
    expect(r.asientos.some((a) => /Alta en stock/i.test(a.glosa))).toBe(true);
    expect(r.consistencia.movimientosTransito).toBe(0n);
    expect(r.consistencia.ok).toBe(true);
  });
});
