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
  nombre2?: string | null;
  apellido: string;
  apellido2?: string | null;
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
      label(X0 + 6, y, 'Apellidos:', [employee.apellido, employee.apellido2].filter(Boolean).join(' '), 48);
      label(MIDX + 6, y, 'C.I.:', employee.ci, 26);
      y += 12;
      label(X0 + 6, y, 'Nombres:', [employee.nombre, employee.nombre2].filter(Boolean).join(' '), 48);
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

// ═════════════════════════════════════════════════════════════════
// CONTRATO DE TRABAJO (documento imprimible para firmar)
// ═════════════════════════════════════════════════════════════════

interface EmpresaContrato {
  razonSocial: string;
  rut: string;
  domicilio: string | null;
  localidad?: string | null;
  departamento?: string | null;
  numeroBps?: string | null;
  representanteLegal?: string | null;
  representanteCi?: string | null;
  representanteCargo?: string | null;
}

interface PersonaContrato {
  nombre: string;
  nombre2?: string | null;
  apellido: string;
  apellido2?: string | null;
  ci: string;
  domicilio?: string | null;
  localidad?: string | null;
  departamento?: string | null;
  fechaNacimiento?: Date | null;
  nacionalidad?: number | null;
  estadoCivil?: string | null;
}

interface ContratoDoc {
  numero?: number | null;
  fechaIngreso: Date;
  tipoContrato?: string | null;
  cargo?: string | null;
  sector?: string | null;
  salaryType: string;
  salarioNominal: bigint;
  jornal?: bigint | null;
  horasSemanales?: number | null;
  regimenHorario?: string | null;
  sucursal?: string | null;
}

export function contratoFilename(emp: PersonaContrato, co: EmpresaContrato): string {
  const base = `Contrato - ${emp.nombre} ${emp.apellido} - ${co.razonSocial}`;
  return base.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function generateContratoPDF(
  persona: PersonaContrato,
  contrato: ContratoDoc,
  empresa: EmpresaContrato,
  opts?: { aPrueba?: boolean },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 } });
    doc.info.Title = contratoFilename(persona, empresa);
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const NAVY = '#0B1B3A';
    const PRIMARY = '#1E5BFF';
    const nombreCompleto = [persona.nombre, persona.nombre2, persona.apellido, persona.apellido2].filter(Boolean).join(' ');
    const lugar = [empresa.localidad, empresa.departamento].filter(Boolean).join(', ') || 'Montevideo';
    const hoy = new Date();
    const MESES_L = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
    const fechaHoy = `${hoy.getDate()} de ${MESES_L[hoy.getMonth() + 1]} de ${hoy.getFullYear()}`;
    const fIng = new Date(contrato.fechaIngreso);
    const fechaIngresoTxt = `${fIng.getDate()} de ${MESES_L[fIng.getMonth() + 1]} de ${fIng.getFullYear()}`;

    const NACIONALIDAD: Record<number, string> = { 1: 'oriental', 2: 'ciudadano/a legal uruguayo/a', 3: 'extranjero/a' };
    const ESTADO_CIVIL: Record<string, string> = {
      SOLTERO: 'soltero/a', CASADO: 'casado/a', CONCUBINATO: 'en unión concubinaria',
      DIVORCIADO: 'divorciado/a', VIUDO: 'viudo/a',
    };
    const fNac = persona.fechaNacimiento ? new Date(persona.fechaNacimiento) : null;
    const fechaNacTxt = fNac ? `${fNac.getDate()} de ${MESES_L[fNac.getMonth() + 1]} de ${fNac.getFullYear()}` : null;

    const esJornalero = (contrato.salaryType || 'MENSUAL') === 'JORNALERO';
    const remBruta = esJornalero && contrato.jornal ? contrato.jornal : contrato.salarioNominal;
    const remPesos = Math.round(Number(remBruta) / 100);
    const remTexto = esJornalero
      ? `$ ${fmt(remBruta)} (pesos uruguayos ${numeroALetras(remPesos)}) por jornal`
      : `$ ${fmt(remBruta)} (pesos uruguayos ${numeroALetras(remPesos)}) nominales mensuales`;

    // Título
    doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY)
      .text(opts?.aPrueba ? 'CONTRATO DE TRABAJO A PRUEBA' : 'CONTRATO DE TRABAJO', { align: 'center' });
    doc.moveDown(0.3);
    doc.lineWidth(1.2).strokeColor(PRIMARY)
      .moveTo(doc.page.width / 2 - 60, doc.y).lineTo(doc.page.width / 2 + 60, doc.y).stroke();
    doc.moveDown(1.2);

    // Comparecientes (con representación legal y datos civiles completos)
    const rep = empresa.representanteLegal
      ? `, representada en este acto por ${empresa.representanteLegal}${empresa.representanteCi ? `, titular de la cédula de identidad Nº ${empresa.representanteCi}` : ''}, en su calidad de ${empresa.representanteCargo || 'representante legal'}, con facultades suficientes para este otorgamiento`
      : '';
    const datosCiviles = [
      NACIONALIDAD[persona.nacionalidad ?? 1] ?? 'oriental',
      persona.estadoCivil ? (ESTADO_CIVIL[persona.estadoCivil] ?? persona.estadoCivil.toLowerCase()) : null,
      fechaNacTxt ? `nacido/a el ${fechaNacTxt}` : null,
    ].filter(Boolean).join(', ');
    const domicilioPersona = [persona.domicilio, persona.localidad, persona.departamento].filter(Boolean).join(', ');

    doc.font('Helvetica').fontSize(10.5).fillColor('#111').lineGap(3);
    doc.text(
      `En ${lugar}, a los ${fechaHoy}, POR UNA PARTE: ${empresa.razonSocial}, RUT ${empresa.rut}` +
      `${empresa.numeroBps ? `, Nº de empresa BPS ${empresa.numeroBps}` : ''}, ` +
      `con domicilio en ${empresa.domicilio ?? '—'}${rep} (en adelante "el empleador"); ` +
      `Y POR OTRA PARTE: ${nombreCompleto}, ${datosCiviles}, titular de la cédula de identidad Nº ${persona.ci}` +
      `${domicilioPersona ? `, con domicilio en ${domicilioPersona}` : ''} (en adelante "el trabajador"), ` +
      `quienes convienen la celebración del presente contrato de trabajo, que se regirá por las siguientes cláusulas:`,
      { align: 'justify' },
    );
    doc.moveDown(0.8);

    const clausula = (titulo: string, cuerpo: string) => {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text(titulo, { continued: true });
      doc.font('Helvetica').fillColor('#111').text(` ${cuerpo}`, { align: 'justify' });
      doc.moveDown(0.6);
    };

    clausula('PRIMERO (Objeto).', `El empleador contrata los servicios personales del trabajador para desempeñarse como ${contrato.cargo || 'dependiente'}${contrato.sector ? `, en el sector ${contrato.sector}` : ''}, obligándose el trabajador a cumplir las tareas propias del cargo, así como las accesorias o complementarias razonablemente vinculadas a aquél, con diligencia, lealtad y responsabilidad.`);
    if (opts?.aPrueba) {
      clausula('SEGUNDO (Período de prueba).', `El trabajador es contratado A PRUEBA por el término de noventa (90) días corridos contados a partir del ${fechaIngresoTxt}, fecha de inicio efectivo de la relación laboral. Durante dicho período cualquiera de las partes podrá rescindir unilateralmente la relación laboral sin expresión de causa y sin que se genere derecho a indemnización por despido, sin perjuicio del cobro por el trabajador de los haberes devengados (salario por los días trabajados, licencia, salario vacacional y aguinaldo proporcionales). Vencido el período de prueba sin que ninguna de las partes manifieste su voluntad de rescindir, la relación laboral continuará por tiempo indeterminado, computándose la antigüedad desde la fecha de ingreso indicada.`);
    } else {
      clausula('SEGUNDO (Plazo).', `La relación laboral se inicia el ${fechaIngresoTxt}${contrato.tipoContrato ? `, bajo la modalidad de contrato ${contrato.tipoContrato.toLowerCase()}` : ', por tiempo indeterminado'}, rigiéndose por las normas laborales vigentes en la República Oriental del Uruguay.`);
    }
    clausula('TERCERO (Jornada y horario).', `La jornada de labor será de ${contrato.horasSemanales ?? 44} horas semanales${contrato.regimenHorario ? `, cumplida en el siguiente régimen: ${contrato.regimenHorario}` : ', distribuidas conforme al régimen legal de la actividad'}, con los descansos intermedio y semanal establecidos por la normativa vigente. El trabajo en horas extraordinarias se regirá por la Ley 15.996.`);
    clausula('CUARTO (Remuneración).', `El trabajador percibirá una remuneración de ${remTexto}, sujeta a los aportes y retenciones legales, pagadera dentro de los plazos legales (Decreto-Ley 14.159 y normas concordantes) mediante los medios de pago previstos en la Ley 19.210. La remuneración no será inferior al salario mínimo del laudo aplicable a la categoría del trabajador según el Consejo de Salarios del grupo de actividad del empleador. Percibirá asimismo sueldo anual complementario (Ley 12.840), licencia anual reglamentaria (Ley 12.590) y salario vacacional (Ley 16.101).`);
    clausula('QUINTO (Lugar de trabajo).', `Las tareas se desarrollarán en ${contrato.sucursal || empresa.domicilio || 'el establecimiento del empleador'}, sin perjuicio de los traslados transitorios que la organización del trabajo razonablemente requiera, sin desmedro de la remuneración ni de la categoría del trabajador.`);
    clausula('SEXTO (Obligaciones del trabajador).', `El trabajador se obliga a cumplir las tareas asignadas en forma personal y diligente, observar los reglamentos internos que se le comuniquen, cuidar los bienes y herramientas de trabajo que se le confíen y guardar reserva sobre la información del empleador y de sus clientes a la que acceda en ocasión del trabajo, obligación que subsistirá luego de extinguida la relación laboral.`);
    clausula('SÉPTIMO (Seguridad social y registro).', `El empleador declara que inscribirá al trabajador ante el Banco de Previsión Social (declaración nominada de alta), lo registrará en la planilla de trabajo unificada (MTSS) y lo amparará en el seguro sobre accidentes de trabajo y enfermedades profesionales del Banco de Seguros del Estado (Ley 16.074), efectuando los aportes de seguridad social que correspondan.`);
    clausula('OCTAVO (Domicilios y notificaciones).', `Las partes constituyen domicilio a todos los efectos judiciales y extrajudiciales derivados de este contrato en los indicados en la comparecencia, donde se tendrán por válidas las notificaciones que allí se practiquen, obligándose a comunicar por escrito cualquier modificación.`);
    clausula('NOVENO (Jurisdicción).', `Para todo litigio derivado del presente contrato las partes se someten a la jurisdicción de los tribunales de trabajo competentes${empresa.departamento ? ` del departamento de ${empresa.departamento}` : ''}, conforme a las Leyes 18.572 y 18.847 (proceso laboral).`);
    clausula('DÉCIMO (Aceptación).', `Previa lectura y ratificación de su contenido, las partes aceptan las cláusulas precedentes y firman dos (2) ejemplares del mismo tenor, quedando uno en poder de cada parte, en el lugar y fecha indicados en la comparecencia.`);

    // Firmas
    doc.moveDown(2.5);
    const y = doc.y;
    const w = (doc.page.width - 128) / 2 - 20;
    doc.lineWidth(0.7).strokeColor('#111');
    doc.moveTo(64, y).lineTo(64 + w, y).stroke();
    doc.moveTo(doc.page.width - 64 - w, y).lineTo(doc.page.width - 64, y).stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#111');
    doc.text(empresa.representanteLegal ? empresa.representanteLegal : `Por ${empresa.razonSocial}`, 64, y + 5, { width: w, align: 'center' });
    doc.text(nombreCompleto, doc.page.width - 64 - w, y + 5, { width: w, align: 'center' });
    doc.fontSize(8).fillColor('#666');
    doc.text(
      `${empresa.representanteCargo || 'Empleador'}${empresa.representanteCi ? ` · C.I. ${empresa.representanteCi}` : ''} — ${empresa.razonSocial}`,
      64, y + 18, { width: w, align: 'center' },
    );
    doc.text(`Trabajador · C.I. ${persona.ci}`, doc.page.width - 64 - w, y + 18, { width: w, align: 'center' });

    // Pie de marca sutil
    doc.font('Helvetica').fontSize(6.5).fillColor('#8493AD');
    const pieY = doc.page.height - 48;
    doc.text('Generado con ', 64, pieY, { continued: true });
    doc.font('Helvetica-Bold').fillColor(NAVY).text('Asys', { continued: true });
    doc.fillColor(PRIMARY).text('Tax.', { continued: false });

    doc.end();
  });
}
