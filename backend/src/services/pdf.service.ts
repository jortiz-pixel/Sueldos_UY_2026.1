/**
 * SERVICIO DE GENERACIÓN DE PDF — Recibo de sueldo
 *
 * Replica el formato uruguayo clásico (estilo GNS): encabezado con datos del
 * empleador y del empleado, dos columnas Haberes / Descuentos con detalle,
 * totales, bloque IRPF, líquido con redondeo, textos legales, importe en
 * letras y firma. Se imprime DOS veces en la hoja: Original Empresa y Copia
 * Empleado.
 */

import PDFDocument from 'pdfkit';
import { ItemType } from '@prisma/client';

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

interface CompanyForPdf {
  razonSocial: string;
  nombreFantasia?: string | null;
  rut: string;
  domicilio: string | null;
  numeroBps?: string | null;
  numeroBse?: string | null;
  grupoActividadNum?: number | null;
  subgrupo?: string | null;
}

interface EmployeeForPdf {
  ci: string;
  nombre: string;
  apellido: string;
  cargo: string | null;
  categoria: string | null;
  fechaIngreso: Date;
  salaryType: string;
  salarioNominal: bigint;
  company: CompanyForPdf | null;
}

interface ContratoForPdf {
  numero?: number | null;
  cargo?: string | null;
  sector?: string | null;
  regimenHorario?: string | null;
  salaryType?: string | null;
}

const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Nombre del archivo del recibo (sin extensión): "Nombre Apellido - Empresa MM-YYYY". */
export function reciboFilename(liq: { month: number; year: number }, emp: EmployeeForPdf): string {
  const empresa = emp.company?.nombreFantasia || emp.company?.razonSocial || 'Empresa';
  const mm = String(liq.month).padStart(2, '0');
  const base = `${emp.nombre} ${emp.apellido} - ${empresa} ${mm}-${liq.year}`;
  return base.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Helpers ──────────────────────────────────────────────────────
function fmt(cents: bigint): string {
  const neg = cents < 0n;
  const c = neg ? -cents : cents;
  const entero = (c / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = (c % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${entero},${dec}`;
}

function ddmmyy(d: Date | null | undefined): string {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getFullYear()).slice(-2)}`;
}

// Número entero a letras en español (0 .. 999.999.999).
function numeroALetras(n: number): string {
  if (n === 0) return 'Cero';
  const UNI = ['', 'Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez', 'Once', 'Doce', 'Trece', 'Catorce', 'Quince', 'Dieciséis', 'Diecisiete', 'Dieciocho', 'Diecinueve', 'Veinte'];
  const DEC = ['', '', 'Veinti', 'Treinta', 'Cuarenta', 'Cincuenta', 'Sesenta', 'Setenta', 'Ochenta', 'Noventa'];
  const CEN = ['', 'Ciento', 'Doscientos', 'Trescientos', 'Cuatrocientos', 'Quinientos', 'Seiscientos', 'Setecientos', 'Ochocientos', 'Novecientos'];
  function hasta999(x: number): string {
    if (x === 0) return '';
    if (x === 100) return 'Cien';
    let s = '';
    const c = Math.floor(x / 100); const resto = x % 100;
    if (c) s += CEN[c] + ' ';
    if (resto <= 20) s += UNI[resto];
    else {
      const d = Math.floor(resto / 10); const u = resto % 10;
      if (d === 2) s += u ? 'Veinti' + UNI[u].toLowerCase() : 'Veinte';
      else s += DEC[d] + (u ? ' y ' + UNI[u] : '');
    }
    return s.trim();
  }
  let resultado = '';
  const millones = Math.floor(n / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  if (millones) resultado += (millones === 1 ? 'Un Millón' : hasta999(millones) + ' Millones') + ' ';
  if (miles) resultado += (miles === 1 ? 'Mil' : hasta999(miles) + ' Mil') + ' ';
  if (resto) resultado += hasta999(resto);
  return resultado.trim();
}

export function generateReciboPDF(
  liquidation: LiquidationForPdf,
  employee: EmployeeForPdf,
  contrato?: ContratoForPdf | null,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 24 });
    // El Title del PDF es lo que muchos navegadores usan como nombre al guardar.
    doc.info.Title = reciboFilename(liquidation, employee);
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const co = employee.company;
    const haberes = liquidation.items.filter((i) => i.itemType === ItemType.HABER);
    const descuentosRaw = liquidation.items.filter((i) => i.itemType === ItemType.DESCUENTO_OBRERO);

    // Base gravada (la que usan los aportes): la baseCalculo del BPS/FONASA.
    const baseAporte = descuentosRaw.find((d) => d.concepto === 'BPS_JUBILATORIO' || d.concepto === 'FONASA')?.baseCalculo ?? liquidation.totalHaberes;

    // Construir las filas de descuentos al estilo GNS (FONASA dividido en
    // "Seguro x Enfermedad" 3% + "Adic. Sist. Nac. Int. de Salud").
    type Fila = { nombre: string; detalle: string; importe: bigint };
    const descFilas: Fila[] = [];
    for (const d of descuentosRaw) {
      const baseTxt = d.baseCalculo ? `de ${fmt(d.baseCalculo)}` : '';
      if (d.concepto === 'BPS_JUBILATORIO') {
        descFilas.push({ nombre: 'Aporte Jubilatorio', detalle: `${((d.rate ?? 0) / 100)} % ${baseTxt}`, importe: d.amount });
      } else if (d.concepto === 'FONASA') {
        const base = d.baseCalculo ?? 0n;
        const seguro = (base * 3n) / 100n;
        const adic = d.amount - seguro;
        descFilas.push({ nombre: 'Seguro x Enfermedad', detalle: `3 % ${baseTxt}`, importe: seguro });
        if (adic > 0n) {
          const adicRate = ((d.rate ?? 0) - 300) / 100;
          descFilas.push({ nombre: 'Adic. Sist. Nac. Int. de Salud', detalle: `${adicRate} % ${baseTxt}`, importe: adic });
        }
      } else if (d.concepto === 'FRL') {
        descFilas.push({ nombre: 'FRL', detalle: `${((d.rate ?? 0) / 100)} % ${baseTxt}`, importe: d.amount });
      } else if (d.concepto === 'IRPF') {
        descFilas.push({ nombre: 'I.R.P.F.', detalle: '', importe: d.amount });
      } else {
        descFilas.push({ nombre: d.descripcion, detalle: d.rate ? `${(d.rate / 100)} % ${baseTxt}` : '', importe: d.amount });
      }
    }
    const habFilas: Fila[] = haberes.map((h) => ({
      nombre: h.descripcion.replace(/\s*\(.*\)\s*$/, ''),
      detalle: h.rate ? `${(h.rate / 100)} % ${h.baseCalculo ? 'de ' + fmt(h.baseCalculo) : ''}` : '',
      importe: h.amount,
    }));

    // Redondeo al peso entero.
    const liqCent = liquidation.liquidoPercibir;
    const liqEnteroPesos = Math.round(Number(liqCent) / 100);
    const redondeoCent = BigInt(liqEnteroPesos) * 100n - liqCent;
    const letras = numeroALetras(liqEnteroPesos);

    // ── Dibuja UNA copia a partir de originY ────────────────────────
    const X0 = 24;
    const X1 = doc.page.width - 24;
    const Wt = X1 - X0;
    const MIDX = X0 + Wt / 2;

    // Paleta de marca AsysTax
    const NAVY = '#0B1B3A';
    const PRIMARY = '#1E5BFF';

    function label(x: number, y: number, etiqueta: string, valor: string, vx = 0) {
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#444').text(etiqueta, x, y);
      doc.font('Helvetica').fontSize(8).fillColor('#000').text(valor, x + (vx || etiqueta.length * 3.6 + 6), y - 0.5);
    }

    // Sello de marca "AsysTax." dibujado con segmentos de color (sutil).
    function asystaxMark(x: number, y: number, size: number) {
      doc.fontSize(size).font('Helvetica-Bold');
      doc.fillColor(NAVY).text('Asys', x, y, { continued: true });
      doc.fillColor(PRIMARY).text('Tax.', { continued: false });
    }

    function drawCopia(top: number, copiaLabel: string): number {
      let y = top;
      doc.lineWidth(0.6).strokeColor('#888');

      // Encabezado: empresa + liquidación
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text((co?.nombreFantasia || co?.razonSocial || '—').toUpperCase(), X0 + 6, y + 5, { width: Wt * 0.62 });
      doc.font('Helvetica').fontSize(7.5).fillColor('#000');
      doc.text(`Liquidación: Mensualidad ${liquidation.month}/${liquidation.year}`, MIDX, y + 5, { width: Wt / 2 - 6, align: 'right' });
      doc.text(copiaLabel, MIDX, y + 16, { width: Wt / 2 - 6, align: 'right' });

      y += 24;
      // Caja datos empleador
      const boxTop = y;
      label(X0 + 6, y, 'RUT:', co?.rut ?? '—', 28);
      label(MIDX + 6, y, 'BPS:', co?.numeroBps ?? '', 28);
      y += 12;
      label(X0 + 6, y, 'Dirección:', co?.domicilio ?? '', 50);
      label(MIDX + 6, y, 'BSE:', co?.numeroBse ?? '', 28);
      y += 12;
      label(X0 + 6, y, 'Mes:', `${MESES[liquidation.month]} ${liquidation.year}`, 28);
      label(MIDX + 6, y, 'Grupo/Sub:', co?.grupoActividadNum ? `${co.grupoActividadNum}${co.subgrupo ? ' / ' + co.subgrupo : ''}` : '', 56);
      y += 16;
      doc.rect(X0, boxTop - 3, Wt, y - boxTop + 1).stroke();

      // DATOS DEL EMPLEADO
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(PRIMARY).text('DATOS DEL EMPLEADO', X0 + 6, y);
      y += 11;
      const eTop = y;
      label(X0 + 6, y, 'Apellidos:', employee.apellido, 48);
      label(MIDX + 6, y, 'C.I.:', employee.ci, 26);
      y += 12;
      label(X0 + 6, y, 'Nombres:', employee.nombre, 48);
      label(MIDX + 6, y, 'Cargo:', contrato?.cargo || employee.cargo || '', 34);
      y += 12;
      label(X0 + 6, y, 'Fecha Ingreso:', ddmmyy(employee.fechaIngreso), 66);
      label(MIDX + 6, y, 'Sector:', contrato?.sector || '', 34);
      y += 12;
      label(X0 + 6, y, 'Nº Contrato:', contrato?.numero != null ? String(contrato.numero) : '', 58);
      label(MIDX + 6, y, 'Remuneración:', (contrato?.salaryType || employee.salaryType) === 'JORNALERO' ? 'Jornalero' : 'Mensual', 66);
      y += 12;
      if (contrato?.regimenHorario) { label(X0 + 6, y, 'Horario:', contrato.regimenHorario, 40); y += 12; }
      doc.rect(X0, eTop - 3, Wt, y - eTop + 1).stroke();

      // ── Dos columnas: HABERES | DESCUENTOS ──────────────────────
      y += 6;
      const tblTop = y;
      const colMid = MIDX;
      // Cabeceras
      doc.font('Helvetica-Bold').fontSize(7.5);
      doc.rect(X0, y, Wt / 2 - 2, 13).fill('#EAF0FF');
      doc.rect(colMid, y, Wt / 2, 13).fill('#EAF0FF');
      doc.fillColor(NAVY).text('HABERES', X0 + 4, y + 3);
      doc.text('DESCUENTOS', colMid + 4, y + 3);
      y += 13;
      // Subcabeceras
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#666');
      doc.text('Detalle', X0 + 4, y + 2);
      doc.text('Importe', X0 + 4, y + 2, { width: Wt / 2 - 8, align: 'right' });
      doc.text('Detalle', colMid + 4, y + 2);
      doc.text('Importe', colMid + 4, y + 2, { width: Wt / 2 - 8, align: 'right' });
      y += 10;
      const rowsTop = y;
      doc.font('Helvetica').fontSize(7.5).fillColor('#000');
      const nFilas = Math.max(habFilas.length, descFilas.length, 1);
      let yh = y; let yd = y;
      for (let i = 0; i < nFilas; i++) {
        const h = habFilas[i]; const d = descFilas[i];
        if (h) {
          doc.font('Helvetica').fontSize(7.5).text(h.nombre, X0 + 4, yh, { width: Wt / 2 - 70 });
          if (h.detalle) doc.fontSize(6).fillColor('#888').text(h.detalle, X0 + 4, yh + 8, { width: Wt / 2 - 70 });
          doc.fontSize(7.5).fillColor('#000').text(fmt(h.importe), X0 + 4, yh, { width: Wt / 2 - 8, align: 'right' });
          yh += h.detalle ? 16 : 11;
        }
        if (d) {
          doc.font('Helvetica').fontSize(7.5).fillColor('#000').text(d.nombre, colMid + 4, yd, { width: Wt / 2 - 70 });
          if (d.detalle) doc.fontSize(6).fillColor('#888').text(d.detalle, colMid + 4, yd + 8, { width: Wt / 2 - 70 });
          doc.fontSize(7.5).fillColor('#000').text(fmt(d.importe), colMid + 4, yd, { width: Wt / 2 - 8, align: 'right' });
          yd += d.detalle ? 16 : 11;
        }
      }
      y = Math.max(yh, yd) + 2;
      // Bordes columnas
      doc.lineWidth(0.6).strokeColor('#888');
      doc.rect(X0, tblTop, Wt / 2 - 2, y - tblTop).stroke();
      doc.rect(colMid, tblTop, Wt / 2, y - tblTop).stroke();

      // Totales
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
      doc.text(`Total de Haberes:  $ ${fmt(liquidation.totalHaberes)}`, X0 + 4, y + 3, { width: Wt / 2 - 8, align: 'right' });
      doc.text(`Total de Descuentos:  $ ${fmt(liquidation.totalDescuentos)}`, colMid + 4, y + 3, { width: Wt / 2 - 8, align: 'right' });
      y += 16;

      // Bloque IRPF + neto
      doc.font('Helvetica').fontSize(6.5).fillColor('#000');
      doc.text(`Total Gravado: $ ${fmt(baseAporte)}    ·    Monto computable IRPF: ${fmt(baseAporte)}    ·    Tipo IRPF: adelanto de mes ${MESES[liquidation.month]}-${String(liquidation.year).slice(-2)}`, X0 + 4, y, { width: Wt - 8 });
      y += 14;

      // Líquido a cobrar
      doc.lineWidth(1).strokeColor(PRIMARY).rect(X0, y, Wt, 30).stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#000');
      doc.text(`Total neto: $ ${fmt(liqCent)}`, X0 + 8, y + 4);
      doc.text(`Redondeo: $ ${fmt(redondeoCent)}`, X0 + 8, y + 16);
      doc.font('Helvetica-Bold').fontSize(13).fillColor(PRIMARY);
      doc.text(`Líquido a Cobrar:  $ ${fmt(BigInt(liqEnteroPesos) * 100n)}`, MIDX, y + 8, { width: Wt / 2 - 8, align: 'right' });
      y += 36;

      // Texto legal + importe en letras
      doc.font('Helvetica').fontSize(6.3).fillColor('#333');
      doc.text(`Recibí el importe de Pesos Uruguayos ${letras} y copia de esta liquidación, no teniendo nada que reclamar por ningún concepto.`, X0 + 4, y, { width: Wt - 8 });
      y += 16;
      doc.text('La empresa declara haber efectuado los aportes de seguridad social y DGI correspondientes a los haberes del mes anterior según decreto 278/017. Conforme Res. 192 del MTSS de 11/2017, el Nº de transacción se encuentra consignado en el documento emitido por la institución de intermediación financiera.', X0 + 4, y, { width: Wt - 8 });
      y += 24;

      // Firma
      doc.lineWidth(0.6).strokeColor('#000').moveTo(X1 - 180, y + 6).lineTo(X1 - 24, y + 6).stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#000').text('Firma del empleado', X1 - 180, y + 8, { width: 156, align: 'center' });

      // Pie de marca, muy sutil, alineado a la izquierda (frente a la firma).
      const pre = 'Generado con ';
      doc.font('Helvetica').fontSize(6).fillColor('#8493AD').text(pre, X0 + 4, y + 9);
      asystaxMark(X0 + 4 + doc.widthOfString(pre), y + 9, 6);

      return y + 20;
    }

    // Dos copias en la misma hoja
    const yAfter1 = drawCopia(28, 'Original Empresa');
    // Separador punteado
    doc.lineWidth(0.5).strokeColor('#bbb').dash(3, { space: 3 }).moveTo(X0, yAfter1 + 6).lineTo(X1, yAfter1 + 6).stroke().undash();
    drawCopia(yAfter1 + 16, 'Copia Empleado');

    doc.end();
  });
}
