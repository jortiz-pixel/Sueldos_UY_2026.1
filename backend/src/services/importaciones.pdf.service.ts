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
import { ImportacionEstado, ImportacionRegimen } from '@prisma/client';
import { armarAsientoImportacion } from './importaciones.service';
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
  notas?: string | null;
}
interface EmpresaPdf { razonSocial: string; rut: string | null }
interface ArticuloPdf { nro: number; codigo: string | null; descripcion: string; cantidad: number; precioUnit: number; total: bigint }
interface FacturaPdf { proveedor: string | null; numero: string | null; fecha: Date | null; moneda: string; incoterm: string | null; fob: bigint; flete: bigint; seguro: bigint; cif: bigint; total: bigint; articulos: ArticuloPdf[] }
interface LiquidacionPdf { carpeta: string | null; fecha: Date | null; aduana: string | null; despachante: string | null; transporte: string | null; tipoCambio: number | null; moneda: string; total: bigint; gastosAgenciaExtra: number | null; conceptos: { clave: string; monto: bigint }[] }
interface TransferenciaPdf { referencia: string | null; fecha: Date | null; moneda: string; importe: bigint; comision: bigint; totalDebitado: bigint; beneficiario: string | null; nroDocs: number }
interface DocumentoPdf { fileName: string; tipo: string | null; paginas: number | null; estado: string }

export interface InformeInput {
  empresa: EmpresaPdf;
  imp: ImportacionPdf;
  plan?: PlanCuentas | null;
  facturas: FacturaPdf[];
  liquidaciones: LiquidacionPdf[];
  transferencias: TransferenciaPdf[];
  documentos: DocumentoPdf[];
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
    const heading = (txt: string) => {
      ensure(30);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#0B1B3A').text(txt, M, y);
      y += 17;
      doc.moveTo(M, y).lineTo(RIGHT, y).strokeColor('#1E5BFF').lineWidth(0.8).stroke();
      y += 8;
    };
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

    // ── 1. Datos generales ──
    heading('1. Datos generales');
    kv('Importador', empresa.razonSocial);
    kv('Proveedor del exterior', imp.proveedorExterior ?? '—');
    kv('País de origen', imp.paisOrigen ?? '—');
    kv('Aduana', imp.aduana ?? '—');
    kv('Incoterm', imp.incoterm ?? '—');
    kv('Despachante', imp.despachante ?? '—');
    kv('Moneda / Tipo de cambio', `${imp.monedaOrigen} · ${imp.tipoCambio}`);
    kv('Fecha de nacionalización', fdate(imp.fechaNacionalizacion));

    // ── 2. Valor de importación ── (usa la factura extraída si existe)
    heading('2. Valor de importación');
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

    // ── 3. Pagos al exterior ──
    heading('3. Pagos al exterior');
    if (transferencias.length) {
      tabla(
        [{ w: 70, title: 'Ref.' }, { w: 70, title: 'Fecha' }, { w: 95, title: 'Importe', align: 'right' }, { w: 80, title: 'Comisión', align: 'right' }, { w: 90, title: 'Debitado', align: 'right' }, { w: W - 405, title: 'Respaldo' }],
        transferencias.map((t) => [t.referencia ?? '—', fdate(t.fecha), money(t.importe, sym(t.moneda)), money(t.comision, sym(t.moneda)), money(t.totalDebitado, sym(t.moneda)), t.nroDocs === 2 ? 'SWIFT + comprobante' : `${t.nroDocs} doc.`]),
      );
      y += 4;
      const totPag = transferencias.reduce((s, t) => s + t.importe, 0n);
      const totCom = transferencias.reduce((s, t) => s + t.comision, 0n);
      total2('Total transferido al proveedor', money(totPag, 'US$'), true);
      total2('Comisiones bancarias', money(totCom, 'US$'));
      if (fac) {
        const dif = totPag - fac.total;
        total2('Diferencia contra factura', money(dif < 0n ? -dif : dif, sym(fac.moneda)));
      }
    } else { doc.fontSize(9).font('Helvetica').fillColor('#777').text('Sin transferencias registradas.', M + 4, y); y += 14; }

    // ── 4. Gastos y tributos (liquidación del despachante) ──
    heading('4. Gastos y tributos (liquidación del despachante)');
    const liq = liquidaciones[0];
    if (liq) {
      kv('Carpeta / Fecha', `${liq.carpeta ?? '—'} · ${fdate(liq.fecha)}`);
      kv('Despachante / Transporte', `${liq.despachante ?? '—'} · ${liq.transporte ?? '—'}`);
      kv('Tipo de cambio', String(liq.tipoCambio ?? '—'));
      y += 2;
      for (const c of liq.conceptos.filter((x) => x.monto !== 0n)) total2(CONCEPTO_LIQ[c.clave] ?? c.clave, money(c.monto, sym(liq.moneda)));
      total2('Total liquidación', money(liq.total, sym(liq.moneda)), true);
      if (liq.gastosAgenciaExtra) total2('Gastos de agencia (informados aparte)', `US$ ${liq.gastosAgenciaExtra.toLocaleString('es-UY', { minimumFractionDigits: 2 })}`);
    } else { doc.fontSize(9).font('Helvetica').fillColor('#777').text('Sin liquidación del despachante registrada.', M + 4, y); y += 14; }

    // ── 5. Costo del inventario y distribución por artículo ──
    heading('5. Costo del inventario y distribución por artículo');
    total2('Costo de la mercadería', money(imp.costoMercaderia), true);
    y += 4;
    if (fac && fac.articulos.length) {
      const sumaFob = fac.articulos.reduce((s, a) => s + a.total, 0n);
      let acum = 0n;
      const rows = fac.articulos.map((a, i) => {
        let costo: bigint;
        if (sumaFob > 0n && i < fac.articulos.length - 1) { costo = (imp.costoMercaderia * a.total) / sumaFob; acum += costo; }
        else costo = imp.costoMercaderia - acum;
        const unit = a.cantidad ? Number(costo) / 100 / a.cantidad : 0;
        return [String(a.nro), a.codigo ?? '', a.descripcion, String(a.cantidad), money(a.total, sym(fac.moneda)), '$ ' + n2(costo), unit.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
      });
      tabla(
        [{ w: 22, title: '#' }, { w: 62, title: 'Código' }, { w: W - 320, title: 'Descripción' }, { w: 34, title: 'Cant.', align: 'right' }, { w: 72, title: 'FOB', align: 'right' }, { w: 74, title: 'Costo', align: 'right' }, { w: 56, title: 'C. unit.', align: 'right' }],
        rows,
      );
      doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#777').text('Costo prorrateado por participación en el FOB de cada artículo.', M + 2, y + 2); y += 14;
    } else { doc.fontSize(9).font('Helvetica').fillColor('#777').text('Sin detalle de artículos (procesá la factura en "Datos extraídos").', M + 4, y); y += 14; }

    // ── 6. Tratamiento fiscal ──
    heading('6. Tratamiento fiscal (IVA y anticipos)');
    total2('Crédito fiscal IVA (importación + gastos)', money(imp.creditoFiscalIva), true);
    total2('Anticipos (IVA / IRAE, pago a cuenta)', money(imp.anticipos));
    total2('Tributos no recuperables (en el costo)', money(imp.totalTributos - imp.creditoFiscalIva - imp.anticipos > 0n ? imp.totalTributos - imp.creditoFiscalIva - imp.anticipos : 0n));
    doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#777').text('El IVA importación y los anticipos no integran el costo (son crédito fiscal / pagos a cuenta).', M + 2, y + 2); y += 14;

    // ── 7. Asientos contables ──
    heading('7. Asientos contables');
    const asiento = armarAsientoImportacion(imp, plan);
    tabla(
      [{ w: W - 220, title: 'Cuenta' }, { w: 110, title: 'Debe', align: 'right' }, { w: 110, title: 'Haber', align: 'right' }],
      asiento.lineas.map((l) => [l.cuenta, l.debe !== '0' ? n2(BigInt(l.debe)) : '', l.haber !== '0' ? n2(BigInt(l.haber)) : '']),
    );
    total2('TOTALES', `$ ${n2(BigInt(asiento.totalDebe))}      $ ${n2(BigInt(asiento.totalHaber))}`, true);
    if (!asiento.balanceado) { doc.fontSize(8).fillColor('#c00').text('⚠ El asiento no balancea.', M + 4, y); y += 12; }

    // ── 8. Conciliación ──
    heading('8. Conciliación');
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
    if (documentos.every((d) => (d.tipo ?? '') !== 'DUA')) check('DUA definitivo', false, 'no se adjuntó el DUA oficial (expediente preliminar).');

    // ── 9. Documentación de respaldo ──
    heading('9. Documentación de respaldo');
    if (documentos.length) {
      const estadoCorto: Record<string, string> = { PROCESADO: 'Procesado', PENDIENTE: 'Pendiente', PROCESANDO: 'Procesando', ERROR: 'Error', DUPLICADO: 'Duplicado' };
      tabla(
        [{ w: W - 210, title: 'Archivo' }, { w: 108, title: 'Tipo' }, { w: 32, title: 'Págs.', align: 'right' }, { w: 70, title: 'Estado' }],
        documentos.map((d) => [d.fileName, d.tipo ?? '—', d.paginas != null ? String(d.paginas) : '—', estadoCorto[d.estado] ?? d.estado]),
      );
    } else { doc.fontSize(9).font('Helvetica').fillColor('#777').text('Sin documentos adjuntos.', M + 4, y); y += 14; }

    // ── 10. Estado y aprobación ──
    heading('10. Estado y aprobación');
    kv('Estado del expediente', imp.estado);
    kv('Observaciones', imp.notas ?? '—');
    doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#777')
      .text('Informe generado por AsysTax. Los importes provienen del costeo y de la extracción documental del expediente.', M, y + 4, { width: W });

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
