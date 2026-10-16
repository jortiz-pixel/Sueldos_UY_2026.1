/**
 * PDF — Informe completo del expediente de importación (comercio exterior).
 * Profesional y paginado (maneja saltos de página; no deja hojas en blanco).
 * Secciones: portada, datos generales, valor de importación, pagos al exterior,
 * gastos y tributos (liquidación), costo del inventario + distribución por
 * artículo, tratamiento fiscal, asientos contables, conciliación, documentos y
 * estado/aprobación. Reúne el costeo del expediente y la extracción
 * estructurada (factura+artículos, liquidación+conceptos, transferencias).
 */
import PDFDocument from 'pdfkit';
import { ImportacionEstado, ImportacionRegimen, TributoImportacionTipo } from '@prisma/client';
import type { PlanCuentas } from './importaciones.config.service';

export interface ImportacionPdf {
  estado: ImportacionEstado;
  regimen: ImportacionRegimen;
  proveedorExterior: string | null;
  paisOrigen: string | null;
  incoterm: string | null;
  monedaOrigen: string;
  tipoCambio: number;
  duaNumero: string | null;
  duaFecha: Date | null;
  despachante: string | null;
  aduana: string | null;
  fechaNacionalizacion: Date | null;
  fob: bigint; flete: bigint; seguro: bigint; cif: bigint;
  totalTributos: bigint; totalGastos: bigint;
  costoMercaderia: bigint; creditoFiscalIva: bigint; anticipos: bigint;
  gastos: { ivaGasto: bigint }[];
  tributos: { tipo: TributoImportacionTipo; monto: bigint }[];
  costeoEstado?: string | null; costeoMotivo?: string | null;
  tcContable?: number | null; tcAduanero?: number | null;
  notas?: string | null;
}
interface AsientoRefPdf { documento: string; pagina?: string | null; regla: string }
interface AsientoInformePdf { fecha: string | null; glosa: string; definitivo: boolean; balanceado: boolean; referencias?: AsientoRefPdf[]; lineas: { cuenta: string; monedaOrig?: string | null; montoOrig?: number | null; debe: bigint; haber: bigint }[] }
interface EmpresaPdf { razonSocial: string; rut: string | null }
interface ArticuloPdf { nro: number; codigo: string | null; descripcion: string; cantidad: number; precioUnit: number; total: bigint }
interface FacturaPdf { proveedor: string | null; numero: string | null; fecha: Date | null; moneda: string; incoterm: string | null; fob: bigint; flete: bigint; seguro: bigint; cif: bigint; total: bigint; articulos: ArticuloPdf[] }
interface LiquidacionPdf { carpeta: string | null; fecha: Date | null; aduana: string | null; despachante: string | null; transporte: string | null; tipoCambio: number | null; moneda: string; kilosBrutos: number | null; kilosNetos: number | null; total: bigint; gastosAgenciaExtra: number | null; conceptos: { clave: string; monto: bigint }[] }
interface TransferenciaPdf { referencia: string | null; fecha: Date | null; moneda: string; importe: bigint; comision: bigint; totalDebitado: bigint; beneficiario: string | null; nroDocs: number }
interface DocumentoPdf { fileName: string; tipo: string | null; paginas: number | null; estado: string }
// Extracción genérica (DUA, e-facturas de servicios UY, packing, pagos locales,
// recibos, certificado de origen). `datos` es el objeto estructurado del parser.
interface DocExtraccionPdf {
  tipo: string; emisor: string | null; rutEmisor: string | null; serie: string | null; numero: string | null;
  fecha: Date | null; moneda: string | null; total: bigint; resumen: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  datos: any;
}

export interface InformeInput {
  empresa: EmpresaPdf;
  imp: ImportacionPdf;
  plan?: PlanCuentas | null;
  facturas: FacturaPdf[];
  liquidaciones: LiquidacionPdf[];
  transferencias: TransferenciaPdf[];
  documentos: DocumentoPdf[];
  docExtracciones?: DocExtraccionPdf[];
  asientos?: AsientoInformePdf[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  costeoDetalle?: any; // CosteoHistorico serializado (anticipos, gastos, conciliaciones)
}

const REGIMEN: Record<ImportacionRegimen, string> = {
  DEFINITIVA: 'Definitiva', ADMISION_TEMPORARIA: 'Admisión temporaria',
  DEPOSITO: 'Depósito', TRANSITO: 'Tránsito', ZONA_FRANCA: 'Zona franca',
};
const CONCEPTO_LIQ: Record<string, string> = {
  imaduni: 'Imaduni', recargo: 'Recargo', tasaConsular: 'Tasa Consular', tsa: 'TSA',
  extraordinario: 'Extraordinario', ivaImportacion: 'IVA Importación', ivaAnticipado: 'IVA Anticipado',
  guiaTransito: 'Guía Tránsito', timbre: 'Timbre', vuce: 'VUCE', escaner: 'Escáner', tcu: 'TCU',
  gastosOperativos: 'Gastos Operativos', honorarios: 'Honorarios', ivaGastos: 'IVA gastos',
};

const n2 = (c: bigint) => (Number(c) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sym = (m: string) => (m === 'USD' ? 'US$' : '$');
const money = (c: bigint, m = '$') => `${m} ${n2(c)}`;
const fdate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

export function costeoFilename(imp: ImportacionPdf): string {
  return `informe_importacion_${(imp.duaNumero || 'sindua').replace(/[^\w-]/g, '')}`;
}

export function generateInformePDF(input: InformeInput): Promise<Buffer> {
  const { empresa, imp, plan, facturas, liquidaciones, transferencias, documentos } = input;
  const asientos = input.asientos ?? [];
  const det = input.costeoDetalle ?? null;
  const pendiente = imp.costeoEstado === 'PENDIENTE' || imp.costeoEstado === 'PROVISIONAL';
  const nMoney = (s: string | number | null | undefined, m = '$') => `${m} ${(Number(s ?? 0) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const meMoney = (v: number | null | undefined, m: string) => `${sym(m)} ${(Number(v ?? 0)).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const docExtracciones = input.docExtracciones ?? [];
  const exDua = docExtracciones.find((e) => e.tipo === 'DUA');
  const exServicios = docExtracciones.filter((e) => e.tipo === 'FACTURA_SERVICIOS_UY');
  const exPagosLocales = docExtracciones.filter((e) => e.tipo === 'PAGO_TRIBUTOS' || e.tipo === 'PAGO_SERVICIOS_LOCAL');
  const exRecibos = docExtracciones.filter((e) => e.tipo === 'RECIBO');
  const exPacking = docExtracciones.find((e) => e.tipo === 'PACKING_LIST');
  const exCert = docExtracciones.find((e) => e.tipo === 'CERTIFICADO_ORIGEN');
  return new Promise((resolve, reject) => {
    const M = 42;
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
    doc.info.Title = costeoFilename(imp);
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 2 * M;
    const RIGHT = M + W;
    const bottom = () => doc.page.height - M - 16;
    let y = M;

    const ensure = (h: number) => { if (y + h > bottom()) { doc.addPage(); y = M; } };
    let secN = 0;
    const heading = (txt: string) => {
      secN += 1;
      ensure(30);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#0B1B3A').text(`${secN}. ${txt}`, M, y);
      y += 17;
      doc.moveTo(M, y).lineTo(RIGHT, y).strokeColor('#1E5BFF').lineWidth(0.8).stroke();
      y += 8;
    };
    // Subtítulo dentro de una sección (sin numeración).
    const subheading = (txt: string) => {
      ensure(18);
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#1E5BFF').text(txt, M, y);
      y += 14;
    };
    const nota = (txt: string) => { doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#777').text(txt, M + 2, y + 2, { width: W }); y += Math.max(12, doc.heightOfString(txt, { width: W })) + 2; };
    const vacio = (txt: string) => { doc.fontSize(9).font('Helvetica').fillColor('#777').text(txt, M + 4, y); y += 14; };
    const kv = (label: string, val: string) => {
      const h = Math.max(13, doc.heightOfString(val, { width: W - 165 }));
      ensure(h);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#555').text(label, M, y, { width: 160 });
      doc.font('Helvetica').fillColor('#000').text(val, M + 165, y, { width: W - 165 });
      y += h + 2;
    };
    const total2 = (a: string, b: string, bold = false) => {
      ensure(14);
      doc.fontSize(9.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000');
      doc.text(a, M + 4, y, { width: W - 150 });
      doc.text(b, RIGHT - 146, y, { width: 142, align: 'right' });
      y += 13;
    };
    // Tabla con salto de página y encabezado repetido.
    type Col = { w: number; title: string; align?: 'left' | 'right' };
    const tabla = (cols: Col[], rows: string[][]) => {
      const drawHead = () => {
        ensure(16);
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#555');
        let x = M;
        for (const c of cols) { doc.text(c.title, x + 2, y, { width: c.w - 4, align: c.align ?? 'left' }); x += c.w; }
        y += 12;
        doc.moveTo(M, y).lineTo(RIGHT, y).strokeColor('#ccc').lineWidth(0.4).stroke();
        y += 3;
      };
      drawHead();
      for (const r of rows) {
        const hs = cols.map((c, i) => doc.heightOfString(r[i] ?? '', { width: c.w - 4 }));
        const h = Math.max(11, ...hs);
        if (y + h > bottom()) { doc.addPage(); y = M; drawHead(); }
        doc.fontSize(8).font('Helvetica').fillColor('#000');
        let x = M;
        for (let i = 0; i < cols.length; i++) { doc.text(r[i] ?? '', x + 2, y, { width: cols[i].w - 4, align: cols[i].align ?? 'left' }); x += cols[i].w; }
        y += h + 2;
      }
    };

    // ── Portada ──
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#0B1B3A').text('Informe de importación', M, y); y += 26;
    doc.fontSize(11).font('Helvetica').fillColor('#333').text(empresa.razonSocial + (empresa.rut ? ` · RUT ${empresa.rut}` : ''), M, y); y += 16;
    doc.fontSize(10).fillColor('#555')
      .text(`Proveedor: ${imp.proveedorExterior ?? '—'}`, M, y); y += 14;
    doc.text(`Expediente / DUA: ${imp.duaNumero ?? '—'}   ·   Régimen: ${REGIMEN[imp.regimen]}   ·   Estado: ${imp.estado}`, M, y); y += 14;
    doc.text(`Fecha de elaboración: ${new Date().toISOString().slice(0, 10)}`, M, y); y += 10;
    doc.moveTo(M, y).lineTo(RIGHT, y).strokeColor('#1E5BFF').lineWidth(1).stroke(); y += 14;

    // ── Resumen ejecutivo (recuadro con cifras clave) ──
    const liq0 = liquidaciones[0];
    const fac0 = facturas[0];
    const totPagRes = transferencias.reduce((s, t) => s + t.importe, 0n);
    const resumen: Array<[string, string]> = [
      ['CIF (factura)', fac0 ? money(fac0.cif, sym(fac0.moneda)) : money(imp.cif)],
      ['Costo del inventario', pendiente ? 'PENDIENTE' : money(imp.costoMercaderia)],
      ['Crédito fiscal IVA', money(imp.creditoFiscalIva)],
      ['Anticipos (pago a cuenta)', money(imp.anticipos)],
      ['Total pagado al proveedor', money(totPagRes, 'US$')],
      ['TC fiscal (día operación)', `${imp.tcContable ?? '—'}`],
    ];
    const boxH = 16 + Math.ceil(resumen.length / 2) * 15 + 8;
    doc.save().rect(M, y, W, boxH).fill('#F3F6FF'); doc.restore();
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0B1B3A').text('RESUMEN EJECUTIVO', M + 8, y + 6);
    let ry = y + 22;
    for (let i = 0; i < resumen.length; i += 2) {
      const col = (idx: number, cx: number) => { if (!resumen[idx]) return; doc.fontSize(8.5).font('Helvetica').fillColor('#555').text(resumen[idx][0], cx, ry, { width: W / 2 - 110 }); doc.font('Helvetica-Bold').fillColor('#0B1B3A').text(resumen[idx][1], cx + W / 2 - 110, ry, { width: 100, align: 'right' }); };
      col(i, M + 8); col(i + 1, M + 8 + W / 2);
      ry += 15;
    }
    y += boxH + 10;

    // Aviso si el costeo está PENDIENTE (falta cotización contable, etc.).
    if (pendiente) {
      const msg = `COSTEO PENDIENTE — ${imp.costeoMotivo ?? 'faltan datos para completar el costo'}. El costo del inventario no se distribuye y los asientos definitivos quedan bloqueados hasta cargar la cotización contable.`;
      const h = Math.max(22, doc.heightOfString(msg, { width: W - 16 }) + 10);
      doc.save().rect(M, y, W, h).fill('#FDECEC'); doc.restore();
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#B42318').text(msg, M + 8, y + 5, { width: W - 16 });
      y += h + 10;
    }

    // ── 1. Datos generales ──
    heading('Datos generales');
    kv('Importador', empresa.razonSocial);
    kv('Proveedor del exterior', imp.proveedorExterior ?? '—');
    kv('País de origen', imp.paisOrigen ?? '—');
    kv('Aduana', imp.aduana ?? '—');
    kv('Incoterm', imp.incoterm ?? '—');
    kv('Despachante', imp.despachante ?? '—');
    kv('Moneda / Tipo de cambio', `${imp.monedaOrigen} · ${imp.tipoCambio}`);
    kv('Fecha de nacionalización', fdate(imp.fechaNacionalizacion));
    if (liq0) {
      kv('Transporte', liq0.transporte ?? '—');
      if (liq0.kilosBrutos != null || liq0.kilosNetos != null) kv('Peso bruto / neto', `${liq0.kilosBrutos ?? '—'} kg / ${liq0.kilosNetos ?? '—'} kg`);
    }

    // ── Declaración aduanera (DUA) ──
    heading('Declaración aduanera (DUA)');
    if (exDua) {
      const d = exDua.datos ?? {};
      kv('Nº DUA / Canal', `${d.nroDua ?? '—'}   ·   Canal ${d.canal ?? '—'}`);
      kv('Régimen / Carpeta', `${d.regimen ?? '—'}   ·   Carpeta ${d.carpeta ?? '—'}`);
      kv('Aduana', d.aduana ?? '—');
      kv('Fecha de pago / registro', `${d.fechaPago ?? '—'}   ·   registro ${d.fechaRegistro ?? '—'}`);
      kv('Importador', `${d.importador ?? '—'}${d.importadorRut ? ` · RUT ${d.importadorRut}` : ''}`);
      kv('Declarante / Despachante', `${d.declarante ?? '—'}${d.codDespachante ? ` · Cód. ${d.codDespachante}` : ''}${d.declaranteRut ? ` · RUT ${d.declaranteRut}` : ''}`);
      kv('Proveedor', d.proveedor ?? '—');
      kv('NCM / Origen / Estado', `${d.ncm ?? '—'}   ·   ${d.paisOrigen ?? '—'}   ·   ${d.estadoMercaderia ?? '—'}`);
      kv('Factura / AWB', `${d.facturaNro ?? '—'}   ·   AWB ${d.awb ?? '—'}`);
      kv('Bultos / Peso bruto / neto', `${d.totalBultos ?? '—'} bultos   ·   ${d.pesoBruto ?? '—'} kg / ${d.pesoNeto ?? '—'} kg`);
      kv('Moneda / Tipo de cambio', `${d.moneda ?? '—'} · ${d.tipoCambio ?? '—'}`);
      kv('Valor CIF / en Aduana', `${d.moneda ?? 'US$'} ${(d.valorCif ?? 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })}   ·   $ ${(d.valorAduanaPesos ?? 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })}`);
      y += 2;
      subheading('Tributos liquidados en el DUA');
      const trs: Array<{ codigo: string; nombre: string; monto: number }> = d.tributos ?? [];
      if (trs.length) {
        tabla(
          [{ w: 44, title: 'Cód.' }, { w: W - 160, title: 'Tributo' }, { w: 116, title: 'Monto', align: 'right' }],
          trs.map((t) => [t.codigo, t.nombre, `$ ${t.monto.toLocaleString('es-UY')}`]),
        );
        y += 2;
        total2('Total de tributos del DUA', `$ ${(d.totalTributos ?? 0).toLocaleString('es-UY')}`, true);
      }
      nota('Datos tomados de la declaración aduanera oficial (hoja de trabajo del DUA). Los tributos deben coincidir con el pago por SPE y con la liquidación del despachante.');
    } else { vacio('No se adjuntó el DUA oficial (expediente preliminar).'); }

    // ── 2. Valor de importación ── (usa la factura extraída si existe)
    heading('Valor de importación');
    const fac = facturas[0];
    if (fac) {
      const m = sym(fac.moneda);
      kv('Factura comercial', `${fac.numero ?? '—'} · ${fdate(fac.fecha)} · ${fac.moneda}`);
      total2('FOB (mercadería)', money(fac.fob, m));
      total2('Flete internacional', money(fac.flete, m));
      total2('Seguro', money(fac.seguro, m));
      total2('CIF', money(fac.cif, m), true);
    } else {
      total2('FOB', money(imp.fob)); total2('Flete', money(imp.flete)); total2('Seguro', money(imp.seguro)); total2('CIF', money(imp.cif), true);
    }

    // ── 3. Costo de adquisición histórico (anticipos al proveedor) ──
    heading('Costo de adquisición histórico (anticipos al proveedor)');
    const anticipos: Array<{ fecha: string | null; referencia: string | null; moneda: string; monto: number; comision: number; tcUsado: number | null; montoUYU: string; comisionUYU: string; provisional: boolean }> = det?.anticipos ?? [];
    if (anticipos.length) {
      tabla(
        [{ w: 62, title: 'Fecha' }, { w: 58, title: 'Ref.' }, { w: 80, title: 'Importe ME', align: 'right' }, { w: 58, title: 'TC fiscal', align: 'right' }, { w: 92, title: 'Importe $', align: 'right' }, { w: W - 350, title: 'Origen / regla' }],
        anticipos.map((a) => [a.fecha ?? '—', a.referencia ?? '—', meMoney(a.monto, a.moneda), `${a.tcUsado ?? '—'}${a.provisional ? '*' : ''}`, nMoney(a.montoUYU), `SWIFT op. ${a.referencia ?? '—'} · TC del día de pago${a.provisional ? ' (provisional)' : ''}`]),
      );
      y += 4;
      total2('Adquisición (CIF) histórica en pesos', nMoney(det?.adquisicionUYU), true);
      if (det?.saldoNoAnticipado) total2('Saldo no anticipado (al TC de reconocimiento)', `${meMoney(det.saldoNoAnticipado.me, imp.monedaOrigen)} = ${nMoney(det.saldoNoAnticipado.uyu)}`);
      total2('Comisiones bancarias (gasto, no inventario)', nMoney(det?.comisionesBancariasUYU));
      nota('La mercadería pagada por adelantado es una partida NO monetaria (NIC 21): cada anticipo se valúa al tipo de cambio fiscal de SU fecha de pago. Las comisiones bancarias son un gasto financiero (no integran el costo). * = cotización provisional (falta la del día).');
    } else if (transferencias.length) {
      tabla(
        [{ w: 70, title: 'Ref.' }, { w: 70, title: 'Fecha' }, { w: 95, title: 'Importe', align: 'right' }, { w: 80, title: 'Comisión', align: 'right' }, { w: W - 315, title: 'Respaldo' }],
        transferencias.map((t) => [t.referencia ?? '—', fdate(t.fecha), money(t.importe, sym(t.moneda)), money(t.comision, sym(t.moneda)), t.nroDocs === 2 ? 'SWIFT + comprobante' : `${t.nroDocs} doc.`]),
      );
    } else { vacio('Sin pagos al proveedor registrados.'); }

    // ── 4. Estado de cuenta del proveedor ──
    heading('Estado de cuenta del proveedor');
    if (facturas.length || transferencias.length) {
      const monP = sym(facturas[0]?.moneda ?? transferencias[0]?.moneda ?? 'USD');
      kv('Proveedor', imp.proveedorExterior ?? transferencias[0]?.beneficiario ?? '—');
      type Mov = { fecha: Date | null; concepto: string; debe: bigint; haber: bigint };
      const movs: Mov[] = [];
      for (const f of facturas) movs.push({ fecha: f.fecha, concepto: `Factura ${f.numero ?? ''}`.trim(), debe: f.total, haber: 0n });
      for (const t of transferencias) movs.push({ fecha: t.fecha, concepto: `Pago${t.referencia ? ` ref ${t.referencia}` : ''}`, debe: 0n, haber: t.importe });
      movs.sort((a, b) => (a.fecha?.getTime() ?? 0) - (b.fecha?.getTime() ?? 0));
      let saldo = 0n;
      const rows = movs.map((m) => { saldo += m.debe - m.haber; return [fdate(m.fecha), m.concepto, m.debe !== 0n ? money(m.debe, monP) : '', m.haber !== 0n ? money(m.haber, monP) : '', money(saldo, monP)]; });
      tabla(
        [{ w: 66, title: 'Fecha' }, { w: W - 322, title: 'Concepto' }, { w: 84, title: 'Factura', align: 'right' }, { w: 84, title: 'Pago', align: 'right' }, { w: 88, title: 'Saldo', align: 'right' }],
        rows,
      );
      y += 4;
      const totFac = facturas.reduce((s, f) => s + f.total, 0n);
      const totPag = transferencias.reduce((s, t) => s + t.importe, 0n);
      const totCom = transferencias.reduce((s, t) => s + t.comision, 0n);
      total2('Total facturado', money(totFac, monP), true);
      total2('Total pagado al proveedor', money(totPag, monP));
      const sdo = totFac - totPag;
      total2(sdo > 0n ? 'Saldo pendiente' : (sdo < 0n ? 'Pago en exceso' : 'Saldo'), money(sdo < 0n ? -sdo : sdo, monP), true);
      if (totCom > 0n) total2('Comisiones bancarias (no al proveedor)', money(totCom, monP));
    } else { doc.fontSize(9).font('Helvetica').fillColor('#777').text('Sin movimientos del proveedor.', M + 4, y); y += 14; }

    // ── 5. Estado de cuenta del despachante ──
    heading('Estado de cuenta del despachante');
    if (liq0) {
      const monD = sym(liq0.moneda);
      kv('Despachante', liq0.despachante ?? '—');
      total2('Total liquidación de gastos', money(liq0.total, monD), true);
      if (liq0.gastosAgenciaExtra) total2('Gastos de agencia (en USD, aparte)', `US$ ${liq0.gastosAgenciaExtra.toLocaleString('es-UY', { minimumFractionDigits: 2 })}`);
      total2('Fondos entregados al despachante', money(0n, monD));
      total2('Saldo a pagar al despachante', money(liq0.total, monD), true);
      doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#777').text('Una solicitud de fondos no constituye pago: el saldo refleja la liquidación menos los fondos efectivamente entregados y documentados.', M + 2, y + 2); y += 14;
    } else { doc.fontSize(9).font('Helvetica').fillColor('#777').text('Sin liquidación del despachante registrada.', M + 4, y); y += 14; }

    // ── 6. Gastos y tributos (liquidación del despachante) ──
    heading('Gastos y tributos (liquidación del despachante)');
    const liq = liquidaciones[0];
    if (liq) {
      kv('Carpeta / Fecha', `${liq.carpeta ?? '—'} · ${fdate(liq.fecha)}`);
      kv('Despachante / Transporte', `${liq.despachante ?? '—'} · ${liq.transporte ?? '—'}`);
      kv('Tipo de cambio', String(liq.tipoCambio ?? '—'));
      y += 2;
      for (const c of liq.conceptos.filter((x) => x.monto !== 0n)) total2(CONCEPTO_LIQ[c.clave] ?? c.clave, money(c.monto, sym(liq.moneda)));
      total2('Total liquidación', money(liq.total, sym(liq.moneda)), true);
      if (liq.gastosAgenciaExtra) total2('Gastos de agencia (informados aparte)', `US$ ${liq.gastosAgenciaExtra.toLocaleString('es-UY', { minimumFractionDigits: 2 })}`);
    } else if (exServicios.length) {
      vacio('Los gastos del despachante se detallan en la sección siguiente (e-factura CFE del despachante).');
    } else { vacio('Sin liquidación del despachante registrada.'); }

    // ── Facturas de servicios en plaza (CFE uruguayas) ──
    heading('Facturas de servicios en plaza (CFE)');
    if (exServicios.length) {
      tabla(
        [{ w: W - 300, title: 'Prestador' }, { w: 74, title: 'Comprob.' }, { w: 62, title: 'Fecha' }, { w: 40, title: 'Mon.' }, { w: 84, title: 'Total', align: 'right' }],
        exServicios.map((e) => [e.emisor ?? e.rutEmisor ?? '—', `${e.serie ?? ''}${e.numero ?? ''}`, fdate(e.fecha), e.moneda ?? '—', money(e.total, sym(e.moneda ?? 'UYU'))]),
      );
      y += 4;
      // Composición de los gastos del despachante (gravados + IVA + no facturable).
      const hon = exServicios.reduce((s, e) => s + Math.round((e.datos?.honorarios ?? 0) * 100), 0);
      const gop = exServicios.reduce((s, e) => s + Math.round((e.datos?.gastosOperativos ?? 0) * 100), 0);
      const ivaS = exServicios.reduce((s, e) => s + Math.round((e.datos?.iva ?? 0) * 100), 0);
      const noFac = exServicios.reduce((s, e) => s + Math.round((e.datos?.noFacturable ?? 0) * 100), 0);
      if (hon || gop || ivaS || noFac) {
        if (hon) total2('Honorarios del despachante (gravado)', money(BigInt(hon)));
        if (gop) total2('Gastos operativos (gravado)', money(BigInt(gop)));
        if (ivaS) total2('IVA de servicios (crédito fiscal)', money(BigInt(ivaS)));
        if (noFac) total2('Pagos por cuenta del importador (tributos / no facturable)', money(BigInt(noFac)));
      }
      y += 2;
      // Detalle línea a línea de cada comprobante.
      for (const e of exServicios) {
        const lineas: Array<{ descripcion: string; importe: number; codIva: string | null }> = e.datos?.lineas ?? [];
        if (!lineas.length) continue;
        subheading(`${e.emisor ?? 'Prestador'} · ${e.serie ?? ''}${e.numero ?? ''}`);
        tabla(
          [{ w: W - 160, title: 'Concepto' }, { w: 44, title: 'IVA' }, { w: 112, title: 'Importe', align: 'right' }],
          lineas.map((l) => [l.descripcion, l.codIva ?? '', `${sym(e.moneda ?? 'UYU')} ${l.importe.toLocaleString('es-UY', { minimumFractionDigits: 2 })}`]),
        );
        y += 3;
      }
      nota('Códigos de IVA (DGI): 1 Exento · 2 Tasa mínima · 3 Tasa básica (22%) · 6 No facturable (importes pagados por cuenta del importador: tributos y tasas oficiales).');
    } else { vacio('Sin facturas de servicios locales registradas.'); }

    // ── Pagos de tributos y servicios en plaza ──
    heading('Pagos de tributos y servicios en plaza');
    if (exPagosLocales.length || exRecibos.length) {
      if (exPagosLocales.length) {
        tabla(
          [{ w: W - 300, title: 'Concepto / Beneficiario' }, { w: 62, title: 'Fecha' }, { w: 66, title: 'Banco' }, { w: 72, title: 'Ref.' }, { w: 84, title: 'Importe', align: 'right' }],
          exPagosLocales.map((e) => {
            const esTrib = e.tipo === 'PAGO_TRIBUTOS';
            const concepto = esTrib ? 'Tributos del DUA (SPE)' : `Transferencia a ${e.datos?.beneficiario ?? 'agencia'}`;
            return [concepto, fdate(e.fecha), e.datos?.banco ?? e.emisor ?? '—', e.datos?.referencia ?? '—', money(e.total, sym(e.moneda ?? 'UYU'))];
          }),
        );
        y += 4;
        // Detalle de los tributos pagados por SPE (si está).
        const trib = exPagosLocales.find((e) => e.tipo === 'PAGO_TRIBUTOS');
        const concs: Array<{ codigo: string; descripcion: string; monto: number }> = trib?.datos?.conceptos ?? [];
        if (concs.length) {
          subheading('Detalle del pago de tributos (SPE / Sistarbanc)');
          tabla(
            [{ w: 80, title: 'Código' }, { w: W - 200, title: 'Concepto' }, { w: 120, title: 'Monto', align: 'right' }],
            concs.map((c) => [c.codigo, c.descripcion, `$ ${c.monto.toLocaleString('es-UY')}`]),
          );
          y += 2;
          total2('Total pagado por SPE', money(trib ? trib.total : 0n), true);
        }
      }
      if (exRecibos.length) {
        subheading('Recibos de respaldo');
        tabla(
          [{ w: W - 300, title: 'Emisor' }, { w: 74, title: 'Recibo' }, { w: 62, title: 'Fecha' }, { w: 40, title: 'Mon.' }, { w: 84, title: 'Total', align: 'right' }],
          exRecibos.map((e) => [e.emisor ?? e.datos?.concepto ?? '—', `${e.serie ?? ''}${e.numero ?? ''}`, fdate(e.fecha), e.moneda ?? '—', money(e.total, sym(e.moneda ?? 'UYU'))]),
        );
      }
    } else { vacio('Sin pagos locales registrados.'); }

    // ── 6. Costo del inventario y distribución por artículo ──
    // ÚNICA FUENTE: el costo, la composición y los ítems salen del motor de costeo
    // (costeoDetalle). No se recalcula nada acá (así no puede diverger del asiento).
    heading('Costo del inventario y distribución por artículo');
    total2('Adquisición (CIF de la factura, por anticipos)', nMoney(det?.adquisicionUYU ?? imp.cif.toString()));
    total2('+ Tributos no recuperables', nMoney(det?.tributosNoRecuperables));
    total2('+ Gastos de plaza directamente atribuibles', nMoney(det?.totalGastosUYU ?? imp.totalGastos.toString()));
    total2('= Costo del inventario', pendiente ? 'PENDIENTE' : nMoney(det?.costoInventario ?? imp.costoMercaderia.toString()), true);
    if (det?.excesoPagado) nota(`Se pagó de más ${meMoney(det.excesoPagado.me, imp.monedaOrigen)} (= ${nMoney(det.excesoPagado.uyu)}) sobre el CIF: NO se capitaliza al inventario; queda como crédito con el proveedor.`);
    if (exDua && exDua.datos?.valorAduanaPesos != null) nota(`Valor en Aduana (base fiscal de los tributos): $ ${(exDua.datos.valorAduanaPesos).toLocaleString('es-UY', { minimumFractionDigits: 2 })}. El costo del inventario NO usa ese valor: la adquisición es el CIF de la factura valuado por los anticipos (TC de cada pago). Los anticipos de IVA/IRAE son pagos a cuenta y NO integran el costo.`);
    y += 4;
    const itemsDet: Array<{ descripcion: string; cantidad: number; fobME: string; costo: string }> = det?.items ?? [];
    if (itemsDet.length) {
      tabla(
        [{ w: 24, title: '#' }, { w: W - 300, title: 'Descripción' }, { w: 44, title: 'Cant.', align: 'right' }, { w: 86, title: 'FOB', align: 'right' }, { w: 78, title: 'Costo $', align: 'right' }, { w: 68, title: 'C. unit. $', align: 'right' }],
        itemsDet.map((i, idx) => [String(idx + 1), i.descripcion, String(i.cantidad), money(BigInt(i.fobME), sym(imp.monedaOrigen)), n2(BigInt(i.costo)), (i.cantidad ? Number(i.costo) / 100 / i.cantidad : 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })]),
      );
      // Verificación: la suma de los costos por artículo cuadra con el costo total.
      const sumaArt = itemsDet.reduce((s, i) => s + BigInt(i.costo), 0n);
      const dif = (det?.costoInventario != null ? BigInt(det.costoInventario) : 0n) - sumaArt;
      doc.fontSize(7.5).font('Helvetica-Oblique').fillColor(dif === 0n ? '#1a7f37' : '#c00').text(`Suma de costos por artículo: $ ${n2(sumaArt)} ${dif === 0n ? '= costo del inventario (OK)' : `(¡diferencia $ ${n2(dif)}!)`}.`, M + 2, y + 2); y += 14;
    } else if (fac && fac.articulos.length) {
      doc.fontSize(9).font('Helvetica').fillColor('#777').text('Costo por artículo PENDIENTE (falta completar el costo del inventario).', M + 4, y); y += 14;
    } else { doc.fontSize(9).font('Helvetica').fillColor('#777').text('Sin detalle de artículos (procesá la factura en "Datos extraídos").', M + 4, y); y += 14; }

    // Verificación automática de consistencia (PASO 6).
    const cons = det?.consistencia;
    if (cons) {
      subheading('Verificación de consistencia (costo = artículos = asientos)');
      total2('Costo del inventario', nMoney(cons.costoInventario));
      total2('Suma de costos por artículo', `${nMoney(cons.sumaCostoArticulos)}   (dif ${nMoney(cons.difArticulos)})`);
      total2('Movimientos a Mercaderías en los asientos', `${nMoney(cons.movimientosMercaderia)}   (dif ${nMoney(cons.difAsientos)})`);
      total2('Adquisición contable vs del asiento', `${nMoney(cons.adquisicionContable)} vs ${nMoney(cons.adquisicionAsiento)}   (dif ${nMoney(cons.difAdquisicion)})`);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(cons.ok ? '#1a7f37' : '#c00').text(cons.ok ? 'OK — las tres igualdades se cumplen (sin diferencias).' : 'INCONSISTENTE — hay diferencias; expediente pendiente de aprobación.', M + 2, y + 2); y += 14;
    }

    // ── Gastos de plaza (desglose contable) ──
    heading('Gastos de plaza (desglose contable)');
    const gastosDet: Array<{ documento: string; concepto: string; moneda: string; montoME: number; cotizacion: number; montoUYU: string; incluidoEnCosto: boolean; porCuentaDeTerceros: boolean; tratamiento: string }> = det?.gastos ?? [];
    if (gastosDet.length) {
      tabla(
        [{ w: 86, title: 'Documento' }, { w: W - 406, title: 'Concepto' }, { w: 40, title: 'Mon.' }, { w: 52, title: 'TC', align: 'right' }, { w: 92, title: 'Importe $', align: 'right' }, { w: 136, title: 'Tratamiento' }],
        gastosDet.map((g) => [g.documento, g.concepto, g.moneda, g.moneda === 'UYU' ? '—' : String(g.cotizacion), g.incluidoEnCosto ? nMoney(g.montoUYU) : '(no suma)', g.tratamiento.length > 60 ? g.tratamiento.slice(0, 57) + '…' : g.tratamiento]),
      );
      y += 4;
      total2('Total gastos de plaza que integran el costo', nMoney(det?.totalGastosUYU), true);
      total2('IVA de servicios (crédito fiscal)', nMoney(det?.ivaGastosUYU));
      nota('Se incluyen solo los gastos facturados AL IMPORTADOR. Los pagos por cuenta de terceros (TCU re-facturado por el despachante) se cuentan una sola vez; la factura del terminal emitida al despachante y el "no facturable" (tributos del DUA) NO se suman como gasto.');
    } else { vacio('Sin gastos de plaza desglosados (procesá los documentos).'); }

    // ── 7. Tratamiento fiscal (IVA y anticipos, separados) ──
    heading('Tratamiento fiscal (IVA y anticipos)');
    const sumTrib = (...ts: TributoImportacionTipo[]) => imp.tributos.filter((t) => ts.includes(t.tipo)).reduce((s, t) => s + t.monto, 0n);
    const ivaImp = sumTrib(TributoImportacionTipo.IVA_IMPORTACION);
    const ivaGastos = imp.gastos.reduce((s, g) => s + g.ivaGasto, 0n);
    const antIva = sumTrib(TributoImportacionTipo.ANTICIPO_IVA);
    const antIrae = sumTrib(TributoImportacionTipo.ANTICIPO_IRAE);
    const recuperables: TributoImportacionTipo[] = [TributoImportacionTipo.IVA_IMPORTACION, TributoImportacionTipo.ANTICIPO_IVA, TributoImportacionTipo.ANTICIPO_IRAE];
    const noRec = imp.tributos.filter((t) => !recuperables.includes(t.tipo)).reduce((s, t) => s + t.monto, 0n);
    total2('IVA importación (crédito fiscal)', money(ivaImp));
    total2('IVA de servicios / plaza (crédito fiscal)', money(ivaGastos));
    total2('Crédito fiscal IVA total', money(imp.creditoFiscalIva), true);
    total2('Anticipo IVA importación', money(antIva));
    total2('Anticipo IRAE', money(antIrae));
    total2('Tributos no recuperables (integran el costo)', money(noRec > 0n ? noRec : 0n));
    doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#777').text('El IVA importación, el IVA de servicios y los anticipos de IVA/IRAE no integran el costo (son crédito fiscal / pagos a cuenta).', M + 2, y + 2); y += 14;

    // ── 7. Asientos contables CRONOLÓGICOS (en pesos, con moneda original y refs) ──
    heading('Asientos contables cronológicos');
    if (asientos.length) {
      for (const a of asientos) {
        subheading(`${fdate(a.fecha ? new Date(`${a.fecha}T00:00:00Z`) : null)} · ${a.glosa}${a.definitivo ? '' : '  (PROVISORIO)'}`);
        tabla(
          [{ w: W - 300, title: 'Cuenta' }, { w: 80, title: 'Moneda orig.', align: 'right' }, { w: 110, title: 'Debe $', align: 'right' }, { w: 110, title: 'Haber $', align: 'right' }],
          a.lineas.map((l) => [l.cuenta, l.montoOrig != null && l.monedaOrig ? meMoney(l.montoOrig, l.monedaOrig) : '', l.debe !== 0n ? n2(l.debe) : '', l.haber !== 0n ? n2(l.haber) : '']),
        );
        const d = a.lineas.reduce((s, l) => s + l.debe, 0n);
        const h = a.lineas.reduce((s, l) => s + l.haber, 0n);
        total2('Totales del asiento', `$ ${n2(d)}      $ ${n2(h)}`, true);
        if (!a.balanceado) { doc.fontSize(8).fillColor('#c00').text('! El asiento no balancea.', M + 4, y); y += 12; }
        for (const rf of (a.referencias ?? [])) doc.fontSize(7).font('Helvetica-Oblique').fillColor('#888').text(`Origen: ${rf.documento}${rf.pagina ? ` (${rf.pagina})` : ''} — ${rf.regla}`, M + 6, y, { width: W - 10 }), y += Math.max(9, doc.heightOfString(`Origen: ${rf.documento} — ${rf.regla}`, { width: W - 10 }));
        y += 5;
      }
      nota('Asientos en orden cronológico por su fecha real; importes en pesos con la moneda original a la vista. Cada uno cita el documento y la regla aplicada. El importe del proveedor del exterior no se divide entre cuentas sin respaldo documental.');
    } else { vacio('Sin asientos (costeo incompleto — procesá los documentos).'); }

    // ── 8. Conciliación ──
    heading('Conciliación');
    const check = (label: string, ok: boolean, detalle: string) => {
      ensure(14);
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(ok ? '#1a7f37' : '#b54708').text(ok ? 'OK' : '!', M + 2, y, { width: 18, lineBreak: false });
      doc.fontSize(9).font('Helvetica').fillColor('#000').text(`${label}: ${detalle}`, M + 22, y, { width: W - 22 });
      y += Math.max(13, doc.heightOfString(`${label}: ${detalle}`, { width: W - 22 })) + 1;
    };
    if (fac) {
      const cifCalc = fac.fob + fac.flete + fac.seguro;
      check('Factura: CIF = FOB + flete + seguro', cifCalc === fac.cif, `${money(fac.cif, sym(fac.moneda))} vs ${money(cifCalc, sym(fac.moneda))}`);
      if (transferencias.length) {
        const totPag = transferencias.reduce((s, t) => s + t.importe, 0n);
        const dif = totPag - fac.total; const abs = dif < 0n ? -dif : dif;
        check('Pagos contra factura', abs <= 20n, `pagado ${money(totPag, 'US$')} vs factura ${money(fac.total, sym(fac.moneda))} (dif. ${money(abs, 'US$')})`);
      }
    }
    if (liq) {
      const suma = liq.conceptos.reduce((s, c) => s + c.monto, 0n);
      check('Liquidación: suma de conceptos vs total', suma === liq.total, `${money(suma, sym(liq.moneda))} vs ${money(liq.total, sym(liq.moneda))}`);
    }
    if (exDua) {
      // Tributos del DUA vs pago por SPE.
      const totTribDua = Math.round((exDua.datos?.totalTributos ?? 0) * 100);
      const pagoSpe = exPagosLocales.find((e) => e.tipo === 'PAGO_TRIBUTOS');
      if (pagoSpe) {
        const dif = Math.abs(totTribDua - Number(pagoSpe.total));
        check('Tributos del DUA vs pago SPE', dif <= 100, `DUA $ ${(exDua.datos?.totalTributos ?? 0).toLocaleString('es-UY')} vs SPE ${money(pagoSpe.total)}`);
      }
      // Importe de factura del DUA vs factura comercial.
      if (fac && exDua.datos?.importeFacturas != null) {
        const difF = Math.abs(Math.round(exDua.datos.importeFacturas * 100) - Number(fac.total));
        check('Factura del DUA vs factura comercial', difF <= 100, `DUA ${sym(exDua.datos.moneda ?? 'USD')} ${exDua.datos.importeFacturas.toLocaleString('es-UY', { minimumFractionDigits: 2 })} vs factura ${money(fac.total, sym(fac.moneda))}`);
      }
    } else if (documentos.every((d) => (d.tipo ?? '') !== 'DUA')) {
      check('DUA definitivo', false, 'no se adjuntó el DUA oficial (expediente preliminar).');
    }
    // Conciliaciones del costeo histórico (unidades, anticipos vs CIF, despachante).
    const conc = det?.conciliacion;
    if (conc?.unidades) check(`Unidades DUA (${conc.unidades.dua ?? '—'}) vs factura (${conc.unidades.factura})`, !!conc.unidades.ok, conc.unidades.nota);
    if (conc?.anticiposVsCif) check('Anticipos vs CIF', Math.abs(conc.anticiposVsCif.difME) <= 1, conc.anticiposVsCif.nota);
    if (conc?.tributos) check('Tributos DUA vs pago SPE', !!conc.tributos.ok, `${nMoney(conc.tributos.dua)} vs ${nMoney(conc.tributos.spe)} (incluye Tasa Escáner $563)`);
    if (conc?.despachante) check('Cuenta del despachante', (conc.despachante.saldo ?? 0) >= 0 ? true : false, `cargos ${nMoney(conc.despachante.totalCargos)} · pagos ${nMoney(conc.despachante.totalPagos)} → ${conc.despachante.nota}`);

    // ── Packing list / detalle logístico ──
    heading('Packing list y detalle logístico');
    if (exPacking) {
      const p = exPacking.datos ?? {};
      kv('Mercadería / NCM', `${imp.proveedorExterior ? '' : ''}NCM ${p.ncm ?? exDua?.datos?.ncm ?? '—'}`);
      kv('Condición de venta', p.condicionVenta ?? imp.incoterm ?? '—');
      kv('País de origen', p.paisOrigen ?? imp.paisOrigen ?? '—');
      kv('Banco de ingreso de divisas', p.bancoDivisas ?? '—');
      kv('Bultos / unidades', `${exDua?.datos?.totalBultos ?? p.totalBultos ?? '—'} bultos · ${p.cantidadTotal ?? '—'} unidades`);
      kv('Peso bruto / neto (DUA)', `${exDua?.datos?.pesoBruto ?? '—'} kg / ${exDua?.datos?.pesoNeto ?? '—'} kg`);
      const bultos: Array<{ nro: number; dimensiones: string | null; cantidad: number | null; peso: number | null }> = p.bultos ?? [];
      if (bultos.length) {
        y += 2;
        subheading('Detalle de bultos (packing list)');
        tabla(
          [{ w: 40, title: '#', align: 'right' }, { w: W - 260, title: 'Dimensiones' }, { w: 100, title: 'Cantidad', align: 'right' }, { w: 120, title: 'Peso (kg)', align: 'right' }],
          bultos.map((bb) => [String(bb.nro), bb.dimensiones ?? '—', bb.cantidad != null ? String(bb.cantidad) : '—', bb.peso != null ? bb.peso.toLocaleString('es-UY', { minimumFractionDigits: 2 }) : '—']),
        );
      }
      nota('El packing list es informativo. Los bultos y pesos oficiales son los del DUA (casillas 37/38 y 58/59).');
    } else { vacio('Sin packing list adjunto.'); }

    // ── Certificado de origen ──
    heading('Certificado de origen');
    if (exCert) {
      const c = exCert.datos ?? {};
      kv('Nº certificado', c.numero ?? '—');
      kv('Acuerdo', c.acuerdo ?? '—');
      kv('Exportador', c.exportador ?? imp.proveedorExterior ?? '—');
      kv('Importador', c.importador ?? empresa.razonSocial);
      kv('País de origen', c.paisOrigen ?? imp.paisOrigen ?? '—');
      kv('Puerto / lugar de embarque', c.puertoEmbarque ?? '—');
      kv('Factura comercial', `${c.facturaNro ?? '—'}${c.facturaFecha ? ` · ${c.facturaFecha}` : ''}`);
      nota('Certificado de origen digital (ALADI/VUCE). Acredita el origen Mercosur de la mercadería a los efectos de la preferencia arancelaria.');
    } else { vacio('Sin certificado de origen adjunto.'); }

    // ── 9. Documentación de respaldo ──
    heading('Documentación de respaldo');
    if (documentos.length) {
      const estadoCorto: Record<string, string> = { PROCESADO: 'Procesado', PENDIENTE: 'Pendiente', PROCESANDO: 'Procesando', ERROR: 'Error', DUPLICADO: 'Duplicado' };
      tabla(
        [{ w: W - 210, title: 'Archivo' }, { w: 108, title: 'Tipo' }, { w: 32, title: 'Págs.', align: 'right' }, { w: 70, title: 'Estado' }],
        documentos.map((d) => [d.fileName, d.tipo ?? '—', d.paginas != null ? String(d.paginas) : '—', estadoCorto[d.estado] ?? d.estado]),
      );
    } else { doc.fontSize(9).font('Helvetica').fillColor('#777').text('Sin documentos adjuntos.', M + 4, y); y += 14; }

    // ── 12. Estado y aprobación ──
    heading('Estado y aprobación');
    kv('Estado del expediente', imp.estado);
    kv('Observaciones', imp.notas ?? '—');
    // Bloque de firmas.
    y += 16;
    ensure(56);
    const col3 = (W - 24) / 3;
    const firmas = ['Preparado por', 'Revisado por', 'Aprobado por'];
    firmas.forEach((f, i) => {
      const x = M + i * (col3 + 12);
      doc.moveTo(x, y + 24).lineTo(x + col3, y + 24).strokeColor('#999').lineWidth(0.5).stroke();
      doc.fontSize(8).font('Helvetica').fillColor('#555').text(f, x, y + 28, { width: col3, align: 'center' });
      doc.fontSize(7).fillColor('#999').text('Nombre · Fecha', x, y + 40, { width: col3, align: 'center' });
    });
    y += 56;
    doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#777')
      .text('Informe generado por AsysTax. Los importes provienen del costeo y de la extracción documental del expediente.', M, y + 2, { width: W });

    // Pie de página con numeración en todas las hojas. Se anula el margen
    // inferior al escribir para que pdfkit NO agregue páginas por "overflow".
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const prev = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(7.5).font('Helvetica').fillColor('#999')
        .text(`${empresa.razonSocial} · Expediente ${imp.duaNumero ?? '—'} · Pág. ${i + 1}/${range.count}`, M, doc.page.height - 26, { width: W, align: 'center', lineBreak: false });
      doc.page.margins.bottom = prev;
    }

    doc.end();
  });
}
