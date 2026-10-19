/* Dev-only: genera un PDF de informe representativo (datos MARPOLOS sintéticos con
 * textos largos) y detecta superposiciones de texto con pdfjs. No se despliega. */
const fs = require('fs');
const path = require('path');
const { generateInformePDF } = require('../dist/services/importaciones.pdf.service.js');
const { construirCosteoHistorico } = require('../dist/services/importaciones.costeo.service.js');

const C = (n) => BigInt(Math.round(n * 100));
const et = (k) => k;

// Costeo histórico (misma forma que el motor real), con KIXOLER provisional y pago
// pendiente para ejercitar las notas largas.
const costeo = construirCosteoHistorico({
  dua: {
    nroDua: '002-2026-170135', tipoCambio: 40.266, valorAduanaPesos: 226650.87, importadorRut: '220616930019',
    importeFacturas: 5628.84, moneda: 'USD', declaranteRut: '217369500013', unidadesComerciales: 281,
    tributos: [
      { codigo: '16', nombre: 'Adelanto IVA', monto: 22665 }, { codigo: '15', nombre: 'IVA importación', monto: 49863 },
      { codigo: '26', nombre: 'Tasa consular', monto: 6800 }, { codigo: '06', nombre: 'TSA', monto: 453 },
      { codigo: '27', nombre: 'Guía', monto: 380 }, { codigo: '32', nombre: 'Timbre', monto: 270 },
      { codigo: '05', nombre: 'Extraordinario', monto: 1933 }, { codigo: '33', nombre: 'VUCE', monto: 239 },
      { codigo: '36', nombre: 'Escáner', monto: 563 },
    ],
  },
  factura: {
    fob: C(4838.44), flete: C(760.40), seguro: C(30), total: C(5628.84), moneda: 'USD',
    articulos: Array.from({ length: 33 }, (_, i) => ({ descripcion: `Artículo de catálogo número ${i + 1} con descripción larga para probar el ajuste de columnas`, codigo: `COD-${1000 + i}`, cantidad: 8 + i, total: C(170 + i * 3) })),
  },
  servicios: [
    { rutComprador: '220616930019', rutEmisor: '217369500013', moneda: 'UYU', serie: 'A', numero: '0040415', emisor: 'Pacini Despachante de Aduana', honorarios: 5700, gastosOperativos: 2500, iva: 1804, total: 93170, noFacturable: 83166 },
    { rutComprador: '220616930019', rutEmisor: '217127640018', moneda: 'USD', serie: 'A', numero: '24391', emisor: 'KIXOLER', honorarios: null, gastosOperativos: null, iva: null, total: 150.64, noFacturable: null, fecha: '2026-08-27', cotizacion: 40.266, fuenteCotizacion: 'DUA (cotización oficial del día de la operación)' },
  ],
  anticipos: [
    { fecha: '2026-06-09', referencia: '058197', moneda: 'USD', monto: 2000, comision: 40, cotizacion: 40.512, fuente: 'BCU 2026-06-09 (venta)' },
    { fecha: '2026-06-10', referencia: '075328', moneda: 'USD', monto: 1800, comision: 40, cotizacion: 40.674, fuente: 'BCU 2026-06-10 (venta)' },
    { fecha: '2026-06-11', referencia: '075329', moneda: 'USD', monto: 1828.98, comision: 40, cotizacion: 40.733, fuente: 'BCU 2026-06-11 (venta)' },
  ],
  pagoSpeCtms: C(83166), pagoDespachanteCtms: C(96137), fechaPagoDespachante: '2026-08-28',
  pagoAgencia: { fecha: '2026-08-28', moneda: 'USD', montoME: 155 },
  fechaReconocimiento: '2026-08-28', cotizacionReconocimiento: 40.674, tcProvisional: null,
  unidadesPacking: 222, packingBultos: 9, packingBultosDeclarados: 12,
  liquidacionPreliminar: { total: C(96137), conceptos: [
    { clave: 'tasaConsular', monto: C(6797) }, { clave: 'tsa', monto: C(453) }, { clave: 'extraordinario', monto: C(1932) },
    { clave: 'ivaImportacion', monto: C(49843) }, { clave: 'ivaAnticipado', monto: C(22656) }, { clave: 'guiaTransito', monto: C(380) },
    { clave: 'timbre', monto: C(270) }, { clave: 'vuce', monto: C(239) }, { clave: 'escaner', monto: C(563) },
    { clave: 'tcu', monto: C(3000) }, { clave: 'gastosOperativos', monto: C(2500) }, { clave: 'honorarios', monto: C(5700) }, { clave: 'ivaGastos', monto: C(1804) },
  ] },
  etiqueta: et,
});
const det = JSON.parse(JSON.stringify(costeo, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
// Stress: nombres de cuenta largos (como los que arma el plan de cuentas de la empresa).
const CUENTA_LARGA = {
  mercaderiasImportadas: 'Mercaderías importadas en tránsito — depósito aduanero (centro de costos Producción)',
  bancoMe: 'Banco Itaú cuenta corriente en moneda extranjera USD — casa matriz',
  bancoPesos: 'Banco BROU cuenta corriente en pesos uruguayos — pagos a proveedores de plaza',
  despachantes: 'Despachantes de aduana y agentes — cuenta corriente por expediente',
  proveedoresLocales: 'Proveedores de plaza — servicios de agencia de carga y logística internacional',
  ivaCompras: 'IVA compras — crédito fiscal por importación y servicios de plaza',
  anticiposIvaIrae: 'Anticipos de IVA e IRAE a la importación — pagos a cuenta',
};
const asientos = det.asientos.map((a) => ({ ...a, lineas: a.lineas.map((l) => ({ ...l, cuenta: CUENTA_LARGA[l.cuenta] || l.cuenta, debe: BigInt(l.debe), haber: BigInt(l.haber) })) }));

const imp = {
  estado: 'EN_PROCESO', regimen: 'DEFINITIVA', proveedorExterior: 'MARPOLOS INTERNATIONAL TRADING & MANUFACTURING COMPANY LIMITED (SHENZHEN) CO. LTD.',
  paisOrigen: 'China', incoterm: 'CIF', monedaOrigen: 'USD', tipoCambio: 40.674,
  duaNumero: '002-2026-170135', duaFecha: new Date('2026-08-28'), despachante: 'Pacini Despachante de Aduana',
  aduana: '001 MONTEVIDEO', fechaNacionalizacion: new Date('2026-08-28'),
  fob: costeo.adquisicionUYU, flete: 0n, seguro: 0n, cif: costeo.adquisicionUYU,
  totalTributos: costeo.totalTributos, totalGastos: costeo.totalGastosUYU,
  costoMercaderia: C(255712.57), creditoFiscalIva: costeo.creditoFiscalIva, anticipos: costeo.anticiposFiscales,
  gastos: costeo.gastos.filter((g) => g.ivaUYU > 0n).map((g) => ({ ivaGasto: g.ivaUYU })),
  tributos: costeo.tributos.map((t) => ({ tipo: t.tipo, monto: t.monto })),
  costeoEstado: costeo.estado, costeoMotivo: costeo.motivos.join(' · '),
  tcContable: null, tcAduanero: 40.266, notas: null,
};

const input = {
  empresa: { razonSocial: 'GRO Consultores & Asociados SRL', rut: '020000000011' },
  imp, plan: null,
  facturas: [{ proveedor: imp.proveedorExterior, numero: 'A24391', fecha: new Date('2026-08-20'), moneda: 'USD', incoterm: 'CIF', fob: C(4838.44), flete: C(760.40), seguro: C(30), cif: C(5628.84), total: C(5628.84), articulos: det.items.map((it, i) => ({ nro: i + 1, codigo: it.codigo, descripcion: it.descripcion, cantidad: it.cantidad, precioUnit: Number(it.fobME) / 100 / Math.max(1, it.cantidad), total: BigInt(it.fobME) })) }],
  liquidaciones: [{ carpeta: '105523', fecha: new Date('2026-08-27'), aduana: '001 MONTEVIDEO', despachante: 'Pacini Despachante de Aduana', transporte: 'Marítimo', tipoCambio: 40.266, moneda: 'UYU', kilosBrutos: 139, kilosNetos: 120, total: C(96137), gastosAgenciaExtra: null, conceptos: [{ clave: 'ivaImportacion', monto: C(49843) }, { clave: 'escaner', monto: C(563) }, { clave: 'honorarios', monto: C(5700) }] }],
  transferencias: [
    { referencia: '058197', fecha: new Date('2026-06-09'), moneda: 'USD', importe: C(3000), comision: C(40), totalDebitado: C(3040), beneficiario: 'MARPOLOS INTERNATIONAL TRADING CO. LTD.', nroDocs: 2 },
    { referencia: '075328', fecha: new Date('2026-06-10'), moneda: 'USD', importe: C(2628.98), comision: C(40), totalDebitado: C(2668.98), beneficiario: 'MARPOLOS INTERNATIONAL TRADING CO. LTD.', nroDocs: 2 },
  ],
  documentos: [
    { fileName: 'DUA_002-2026-170135.pdf', tipo: 'DUA', paginas: 3, estado: 'PROCESADO' },
    { fileName: 'factura_comercial_A24391.pdf', tipo: 'FACTURA_COMERCIAL', paginas: 2, estado: 'PROCESADO' },
    { fileName: 'liquidacion_despachante_105523.pdf', tipo: 'LIQUIDACION_DESPACHANTE', paginas: 1, estado: 'PROCESADO' },
  ],
  docExtracciones: [
    { tipo: 'DUA', emisor: null, rutEmisor: '217369500013', serie: null, numero: '002-2026-170135', fecha: new Date('2026-08-28'), moneda: 'UYU', total: C(83166), resumen: 'DUA', datos: { totalTributos: 83166, totalBultos: 12, pesoBruto: 139, pesoNeto: 120, ncm: '8205.59.00', importeFacturas: 5628.84, moneda: 'USD', unidadesComerciales: 281 } },
    { tipo: 'PACKING_LIST', emisor: null, rutEmisor: null, serie: null, numero: null, fecha: null, moneda: null, total: 0n, resumen: 'Packing', datos: { ncm: '8205.59.00', condicionVenta: 'CIF', paisOrigen: 'China', bancoDivisas: 'BROU', totalBultos: 9, cantidadTotal: 222, bultos: Array.from({ length: 9 }, (_, i) => ({ nro: i + 1, dimensiones: '40cmx30cmx25cm', cantidad: 20 + i, peso: 12.5 + i })) } },
    { tipo: 'PAGO_TRIBUTOS', emisor: 'BROU', rutEmisor: null, serie: null, numero: 'SPE-9988', fecha: new Date('2026-08-28'), moneda: 'UYU', total: C(83166), resumen: 'Pago SPE', datos: {} },
    { tipo: 'CERTIFICADO_ORIGEN', emisor: 'CCPIT', rutEmisor: null, serie: null, numero: 'CO-2026-55', fecha: new Date('2026-08-10'), moneda: null, total: 0n, resumen: 'Cert origen', datos: { pais: 'China' } },
  ],
  asientos,
};

(async () => {
  const pdf = await generateInformePDF(input);
  const out = path.join('/tmp/informe', 'informe_sample.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, pdf);
  console.log('PDF escrito:', out, pdf.length, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });
