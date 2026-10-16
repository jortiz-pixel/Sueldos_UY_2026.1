/**
 * PDF — Ficha de costeo de una importación (comercio exterior).
 * Encabezado con empresa y DUA, datos de la operación, CIF, tributos, gastos,
 * ítems con costo prorrateado, resumen del costeo y asiento contable.
 */
import PDFDocument from 'pdfkit';
import { ImportacionEstado, ImportacionRegimen, TributoImportacionTipo, GastoImportacionConcepto } from '@prisma/client';
import { armarAsientoImportacion } from './importaciones.service';
import type { PlanCuentas } from './importaciones.config.service';

interface ItemPdf { descripcion: string; ncm: string | null; cantidad: number; fobTotal: bigint; costoProrrateado: bigint }
interface TributoPdf { tipo: TributoImportacionTipo; tasa: number; monto: bigint }
interface GastoPdf { concepto: GastoImportacionConcepto; descripcion: string | null; monto: bigint; ivaGasto: bigint }
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
  items: ItemPdf[]; tributos: TributoPdf[]; gastos: GastoPdf[];
}
interface EmpresaPdf { razonSocial: string; rut: string | null }

const REGIMEN: Record<ImportacionRegimen, string> = {
  DEFINITIVA: 'Definitiva', ADMISION_TEMPORARIA: 'Admisión temporaria',
  DEPOSITO: 'Depósito', TRANSITO: 'Tránsito', ZONA_FRANCA: 'Zona franca',
};
const TRIBUTO: Record<TributoImportacionTipo, string> = {
  ARANCEL_TEC: 'Arancel / TEC', TASA_SERVICIOS: 'Tasa de servicios', IMESI: 'IMESI',
  IVA_IMPORTACION: 'IVA importación', ANTICIPO_IVA: 'Anticipo IVA', ANTICIPO_IRAE: 'Anticipo IRAE',
  RECARGO: 'Recargo', OTRO: 'Otro',
};
const GASTO: Record<GastoImportacionConcepto, string> = {
  HONORARIOS_DESPACHANTE: 'Honorarios despachante', DEPOSITO: 'Depósito', MOVILIZACION: 'Movilización',
  GASTOS_BANCARIOS: 'Gastos bancarios', FLETE_INTERNO: 'Flete interno', SEGURO_LOCAL: 'Seguro local', OTRO: 'Otro',
};

const fmt = (c: bigint) => (Number(c) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

export function costeoFilename(imp: ImportacionPdf): string {
  return `costeo_importacion_${(imp.duaNumero || 'sindua').replace(/[^\w-]/g, '')}`;
}

export function generateCosteoPDF(imp: ImportacionPdf, empresa: EmpresaPdf, plan?: PlanCuentas | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    doc.info.Title = costeoFilename(imp);
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 36;
    const R = doc.page.width - 36;
    const W = R - L;

    // Encabezado
    doc.fillColor('#0B1B3A').fontSize(15).font('Helvetica-Bold').text('Ficha de costeo de importación', L, 36);
    doc.fontSize(9).font('Helvetica').fillColor('#333')
      .text(`${empresa.razonSocial}${empresa.rut ? ` · RUT ${empresa.rut}` : ''}`, L, 56);
    doc.text(`DUA ${imp.duaNumero || '—'}  ·  ${fecha(imp.duaFecha)}  ·  ${REGIMEN[imp.regimen]}  ·  ${imp.estado}`, L, 70);
    doc.moveTo(L, 86).lineTo(R, 86).strokeColor('#1E5BFF').lineWidth(1).stroke();

    let y = 96;
    const linea = (label: string, valor: string) => {
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#555').text(label, L, y, { width: 150, continued: false });
      doc.font('Helvetica').fillColor('#000').text(valor, L + 150, y, { width: W - 150 });
      y += 14;
    };
    linea('Proveedor del exterior', imp.proveedorExterior || '—');
    linea('País de origen', imp.paisOrigen || '—');
    linea('Incoterm', imp.incoterm || '—');
    linea('Moneda / Tipo de cambio', `${imp.monedaOrigen} · ${imp.tipoCambio}`);
    linea('Despachante', imp.despachante || '—');
    linea('Aduana', imp.aduana || '—');
    linea('Fecha nacionalización', fecha(imp.fechaNacionalizacion));

    // Helper de tabla simple de 2 columnas (concepto · importe)
    const seccion = (titulo: string) => {
      y += 6;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0B1B3A').text(titulo, L, y);
      y += 16;
    };
    const fila2 = (a: string, b: string, negrita = false) => {
      doc.fontSize(9).font(negrita ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000');
      doc.text(a, L + 4, y, { width: W - 120 });
      doc.text(b, R - 116, y, { width: 112, align: 'right' });
      y += 13;
    };

    seccion('Valor CIF');
    fila2('FOB (mercadería)', fmt(imp.fob));
    fila2('Flete internacional', fmt(imp.flete));
    fila2('Seguro', fmt(imp.seguro));
    fila2('CIF', fmt(imp.cif), true);

    if (imp.tributos.length) {
      seccion('Tributos del DUA');
      for (const t of imp.tributos) fila2(`${TRIBUTO[t.tipo]}${t.tasa ? ` (${t.tasa}%)` : ''}`, fmt(t.monto));
      fila2('Total tributos', fmt(imp.totalTributos), true);
    }

    if (imp.gastos.length) {
      seccion('Gastos de plaza');
      for (const g of imp.gastos) fila2(`${GASTO[g.concepto]}${g.descripcion ? ` — ${g.descripcion}` : ''}`, fmt(g.monto));
      fila2('Total gastos', fmt(imp.totalGastos), true);
    }

    if (imp.items.length) {
      seccion('Ítems (costo prorrateado)');
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#555');
      doc.text('Descripción', L + 4, y, { width: W - 280 });
      doc.text('NCM', L + W - 276, y, { width: 90 });
      doc.text('FOB', R - 186, y, { width: 90, align: 'right' });
      doc.text('Costo', R - 92, y, { width: 88, align: 'right' });
      y += 13;
      for (const it of imp.items) {
        doc.fontSize(8.5).font('Helvetica').fillColor('#000');
        doc.text(`${it.descripcion} ${it.cantidad ? `(x${it.cantidad})` : ''}`, L + 4, y, { width: W - 280 });
        doc.text(it.ncm || '—', L + W - 276, y, { width: 90 });
        doc.text(fmt(it.fobTotal), R - 186, y, { width: 90, align: 'right' });
        doc.text(fmt(it.costoProrrateado), R - 92, y, { width: 88, align: 'right' });
        y += 13;
      }
    }

    // Resumen del costeo
    y += 8;
    doc.moveTo(L, y).lineTo(R, y).strokeColor('#ccc').lineWidth(0.5).stroke();
    y += 8;
    seccion('Resumen del costeo');
    fila2('Costo de la mercadería', fmt(imp.costoMercaderia), true);
    fila2('Crédito fiscal IVA', fmt(imp.creditoFiscalIva));
    fila2('Anticipos (pago a cuenta)', fmt(imp.anticipos));
    doc.fontSize(7.5).font('Helvetica-Oblique').fillColor('#777')
      .text('El IVA importación y los anticipos no integran el costo (son crédito fiscal / pagos a cuenta).', L + 4, y, { width: W - 8 });
    y += 18;

    // Asiento contable
    const asiento = armarAsientoImportacion(imp, plan);
    seccion('Asiento contable');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#555');
    doc.text('Cuenta', L + 4, y, { width: W - 230 });
    doc.text('Debe', R - 226, y, { width: 108, align: 'right' });
    doc.text('Haber', R - 112, y, { width: 108, align: 'right' });
    y += 13;
    for (const l of asiento.lineas) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#000');
      doc.text(l.cuenta, L + 4, y, { width: W - 230 });
      doc.text(l.debe !== '0' ? fmt(BigInt(l.debe)) : '', R - 226, y, { width: 108, align: 'right' });
      doc.text(l.haber !== '0' ? fmt(BigInt(l.haber)) : '', R - 112, y, { width: 108, align: 'right' });
      y += 13;
    }
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000');
    doc.text('TOTALES', L + 4, y, { width: W - 230 });
    doc.text(fmt(BigInt(asiento.totalDebe)), R - 226, y, { width: 108, align: 'right' });
    doc.text(fmt(BigInt(asiento.totalHaber)), R - 112, y, { width: 108, align: 'right' });

    doc.end();
  });
}
