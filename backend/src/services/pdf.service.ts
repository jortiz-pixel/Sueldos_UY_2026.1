/**
 * SERVICIO DE GENERACIÓN DE PDF
 * Genera recibos de sueldo en formato PDF usando PDFKit.
 */

import PDFDocument from 'pdfkit';
import { ItemType } from '@prisma/client';
import { toPesos, formatPesos } from '../utils/money';
import { formatDate } from '../utils/date';

interface LiquidationForPdf {
  id: string;
  year: number;
  month: number;
  type: string;
  status: string;
  diasTrabajados: number;
  totalHaberes: bigint;
  totalDescuentos: bigint;
  totalPatronal: bigint;
  liquidoPercibir: bigint;
  items: Array<{
    itemType: string;
    concepto: string;
    descripcion: string;
    baseCalculo: bigint | null;
    rate: number | null;
    amount: bigint;
  }>;
}

interface EmployeeForPdf {
  ci: string;
  nombre: string;
  apellido: string;
  cargo: string | null;
  categoria: string | null;
  fechaIngreso: Date;
  salarioNominal: bigint;
  company: {
    razonSocial: string;
    rut: string;
    domicilio: string | null;
  } | null;
}

const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export function generateReciboPDF(
  liquidation: LiquidationForPdf,
  employee: EmployeeForPdf,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 80; // usable width
    const COL1 = 40;
    const COL2 = 320;

    // ── Header ─────────────────────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').text('RECIBO DE SUELDO', COL1, 40, { align: 'center', width: W });
    doc.fontSize(10).font('Helvetica').text(
      `${MESES[liquidation.month]} ${liquidation.year}`,
      COL1, 58, { align: 'center', width: W },
    );

    // Horizontal rule
    doc.moveTo(COL1, 75).lineTo(COL1 + W, 75).stroke();

    // ── Empresa ────────────────────────────────────────────────
    let y = 85;
    doc.fontSize(9).font('Helvetica-Bold').text('EMPRESA:', COL1, y);
    doc.font('Helvetica').text(employee.company?.razonSocial ?? '—', COL1 + 55, y);
    doc.font('Helvetica-Bold').text('RUT:', COL2, y);
    doc.font('Helvetica').text(employee.company?.rut ?? '—', COL2 + 30, y);

    y += 14;
    if (employee.company?.domicilio) {
      doc.font('Helvetica-Bold').text('DOMICILIO:', COL1, y);
      doc.font('Helvetica').text(employee.company.domicilio, COL1 + 65, y);
    }

    // ── Empleado ───────────────────────────────────────────────
    y += 20;
    doc.moveTo(COL1, y).lineTo(COL1 + W, y).stroke();
    y += 8;

    doc.font('Helvetica-Bold').text('EMPLEADO:', COL1, y);
    doc.font('Helvetica').text(`${employee.apellido}, ${employee.nombre}`, COL1 + 65, y);
    doc.font('Helvetica-Bold').text('C.I.:', COL2, y);
    doc.font('Helvetica').text(employee.ci, COL2 + 25, y);

    y += 14;
    doc.font('Helvetica-Bold').text('CARGO:', COL1, y);
    doc.font('Helvetica').text(employee.cargo || '-', COL1 + 45, y);
    doc.font('Helvetica-Bold').text('INGRESO:', COL2, y);
    doc.font('Helvetica').text(formatDate(employee.fechaIngreso), COL2 + 55, y);

    y += 14;
    doc.font('Helvetica-Bold').text('CATEGORÍA:', COL1, y);
    doc.font('Helvetica').text(employee.categoria || '-', COL1 + 65, y);
    doc.font('Helvetica-Bold').text('DÍAS TRAB.:', COL2, y);
    doc.font('Helvetica').text(String(liquidation.diasTrabajados), COL2 + 70, y);

    // ── Items table ────────────────────────────────────────────
    y += 24;
    doc.moveTo(COL1, y).lineTo(COL1 + W, y).stroke();
    y += 6;

    // Table header
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text('CONCEPTO', COL1, y);
    doc.text('BASE', COL1 + 220, y, { width: 80, align: 'right' });
    doc.text('TASA', COL1 + 310, y, { width: 50, align: 'right' });
    doc.text('IMPORTE', COL1 + 370, y, { width: W - 370, align: 'right' });

    y += 12;
    doc.moveTo(COL1, y).lineTo(COL1 + W, y).stroke();
    y += 4;

    // HABERES
    doc.font('Helvetica-Bold').fontSize(8).text('HABERES', COL1, y);
    y += 12;

    const haberes = liquidation.items.filter((i) => i.itemType === ItemType.HABER);
    for (const item of haberes) {
      doc.font('Helvetica').fontSize(8).text(`  ${item.descripcion}`, COL1, y, { width: 215 });
      if (item.baseCalculo) {
        doc.text(formatPesos(item.baseCalculo), COL1 + 220, y, { width: 80, align: 'right' });
      }
      if (item.rate) {
        doc.text(`${(item.rate / 100).toFixed(2)}%`, COL1 + 310, y, { width: 50, align: 'right' });
      }
      doc.text(formatPesos(item.amount), COL1 + 370, y, { width: W - 370, align: 'right' });
      y += 12;
      if (y > 700) { doc.addPage(); y = 40; }
    }

    y += 4;
    doc.moveTo(COL1 + 220, y).lineTo(COL1 + W, y).stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(8).text('TOTAL HABERES', COL1, y);
    doc.text(formatPesos(liquidation.totalHaberes), COL1 + 370, y, { width: W - 370, align: 'right' });
    y += 16;

    // DESCUENTOS
    doc.font('Helvetica-Bold').fontSize(8).text('DESCUENTOS', COL1, y);
    y += 12;

    const descuentos = liquidation.items.filter((i) => i.itemType === ItemType.DESCUENTO_OBRERO);
    for (const item of descuentos) {
      doc.font('Helvetica').fontSize(8).text(`  ${item.descripcion}`, COL1, y, { width: 215 });
      if (item.baseCalculo) {
        doc.text(formatPesos(item.baseCalculo), COL1 + 220, y, { width: 80, align: 'right' });
      }
      if (item.rate) {
        doc.text(`${(item.rate / 100).toFixed(3)}%`, COL1 + 310, y, { width: 50, align: 'right' });
      }
      doc.text(formatPesos(item.amount), COL1 + 370, y, { width: W - 370, align: 'right' });
      y += 12;
      if (y > 700) { doc.addPage(); y = 40; }
    }

    y += 4;
    doc.moveTo(COL1 + 220, y).lineTo(COL1 + W, y).stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(8).text('TOTAL DESCUENTOS', COL1, y);
    doc.text(formatPesos(liquidation.totalDescuentos), COL1 + 370, y, { width: W - 370, align: 'right' });
    y += 20;

    // ── Neto ───────────────────────────────────────────────────
    doc.moveTo(COL1, y).lineTo(COL1 + W, y).lineWidth(2).stroke();
    doc.lineWidth(1);
    y += 8;
    doc.font('Helvetica-Bold').fontSize(11).text('LÍQUIDO A PERCIBIR:', COL1, y);
    doc.fontSize(11).text(formatPesos(liquidation.liquidoPercibir), COL1 + 370, y, { width: W - 370, align: 'right' });
    y += 20;

    // Aportes patronales (informativos)
    const patronal = liquidation.items.filter((i) => i.itemType === ItemType.APORTE_PATRONAL);
    if (patronal.length > 0) {
      doc.moveTo(COL1, y).lineTo(COL1 + W, y).dash(3, { space: 3 }).stroke();
      doc.undash();
      y += 8;
      doc.font('Helvetica-Bold').fontSize(7).text('APORTES PATRONALES (informativos — no deducidos del neto)', COL1, y);
      y += 10;
      for (const item of patronal) {
        doc.font('Helvetica').fontSize(7).text(`  ${item.descripcion}`, COL1, y);
        doc.text(formatPesos(item.amount), COL1 + 370, y, { width: W - 370, align: 'right' });
        y += 10;
      }
      doc.font('Helvetica-Bold').fontSize(7).text('TOTAL PATRONAL:', COL1, y);
      doc.text(formatPesos(liquidation.totalPatronal), COL1 + 370, y, { width: W - 370, align: 'right' });
    }

    // ── Footer ─────────────────────────────────────────────────
    doc.fontSize(7).font('Helvetica').text(
      `Liquidación ID: ${liquidation.id} | Generado: ${new Date().toLocaleString('es-UY')}`,
      COL1, doc.page.height - 50,
      { align: 'center', width: W },
    );

    // Firma
    y = doc.page.height - 110;
    doc.moveTo(COL1 + 20, y).lineTo(COL1 + 140, y).stroke();
    doc.moveTo(COL1 + W - 140, y).lineTo(COL1 + W - 20, y).stroke();
    y += 5;
    doc.fontSize(7).text('Firma Empresa', COL1 + 20, y, { width: 120, align: 'center' });
    doc.text('Firma Empleado', COL1 + W - 140, y, { width: 120, align: 'center' });

    doc.end();
  });
}
