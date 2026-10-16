/**
 * Extracción de datos desde un PDF (factura del proveedor, comprobante de pago,
 * DUA…) para autocompletar el formulario de importación. Lee el TEXTO del PDF
 * (pdfjs-dist) y busca, con heurísticas en español rioplatense (vocabulario de
 * la factura del despachante) e inglés, los valores típicos:
 * FOB/total, flete, seguro, IVA, N° de factura/DUA, fecha y moneda.
 *
 * Es BEST-EFFORT: el operador revisa y corrige antes de guardar. Para una
 * lectura exacta por formato de despachante hace falta calibrar con muestras
 * reales (ver docs/importaciones-diseno.md §7).
 */
import { ImportacionRegimen, TributoImportacionTipo } from '@prisma/client';
import type { ImportacionImportData } from './importaciones.import.service';

// pdfjs-dist (build legacy, CommonJS) — robusto con PDFs modernos (xref streams).
// Se carga con require porque el build legacy no trae tipos en esa ruta.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

/** Extrae el texto del PDF reconstruyendo las líneas por su posición vertical. */
async function textoDelPdf(buffer: Buffer): Promise<string> {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  const lineasOut: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const filas = new Map<number, Array<{ x: number; s: string }>>();
    for (const it of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (typeof it.str !== 'string' || !it.transform) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      if (!filas.has(y)) filas.set(y, []);
      filas.get(y)!.push({ x, s: it.str });
    }
    const ys = [...filas.keys()].sort((a, b) => b - a); // de arriba hacia abajo
    for (const y of ys) {
      const linea = filas.get(y)!.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim();
      if (linea) lineasOut.push(linea);
    }
  }
  return lineasOut.join('\n');
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Convierte "1.234,56" / "1,234.56" / "1234.56" / "12.345" a número. */
function parseMonto(raw: string): number | null {
  const t = raw.replace(/[^\d.,]/g, '');
  if (!t) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  const dec = Math.max(lastComma, lastDot);
  if (dec === -1) { const n = parseInt(t, 10); return Number.isNaN(n) ? null : n; }
  // El separador decimal es el ÚLTIMO de , o . ; el resto son miles.
  const intPart = t.slice(0, dec).replace(/[.,]/g, '');
  const decPart = t.slice(dec + 1).replace(/[.,]/g, '');
  const n = parseFloat(`${intPart || '0'}.${decPart || '0'}`);
  return Number.isNaN(n) ? null : n;
}

/** Último número "con pinta de importe" en una línea. */
function ultimoMonto(linea: string): number | null {
  const nums = linea.match(/\d[\d.,]*\d|\d/g);
  if (!nums || !nums.length) return null;
  for (let i = nums.length - 1; i >= 0; i--) {
    const v = parseMonto(nums[i]);
    if (v != null && v > 0) return v;
  }
  return null;
}

/** Importe en la primera línea que contenga alguno de los rótulos. */
function montoPorRotulo(lineas: string[], rotulos: string[]): number | null {
  for (const ln of lineas) {
    const low = normalize(ln);
    if (rotulos.some((k) => low.includes(k))) {
      const v = ultimoMonto(ln);
      if (v != null) return v;
    }
  }
  return null;
}

/** Texto a continuación de un rótulo (para N° de factura / DUA). */
function textoPorRotulo(lineas: string[], rotulos: string[]): string | null {
  for (const ln of lineas) {
    const low = normalize(ln);
    for (const k of rotulos) {
      const i = low.indexOf(k);
      if (i >= 0) {
        const after = ln.slice(i + k.length).replace(/^[\s:#.\-]*/, '').trim();
        const tok = after.split(/\s{2,}|\t/)[0]?.trim();
        if (tok) return tok.slice(0, 40);
      }
    }
  }
  return null;
}

/** Valor a continuación de una etiqueta que ESTÁ AL INICIO de la línea
 * (estilo factura del despachante: "Proveedor   FRATELLI CURRAO SRL"). Evita
 * falsos positivos (p. ej. "proveedor" dentro de "País del proveedor"). */
function valorInicio(lineas: string[], etiquetas: string[]): string | null {
  for (const ln of lineas) {
    const low = normalize(ln);
    for (const et of etiquetas) {
      if (low.startsWith(et)) {
        const resto = ln.slice(et.length).replace(/^[\s:#.\-]*/, '').trim();
        if (resto) return resto.slice(0, 80);
      }
    }
  }
  return null;
}

/** Fecha en la línea que empieza con alguna etiqueta (o la primera fecha suelta). */
function fechaPorRotulo(lineas: string[], etiquetas: string[]): string | undefined {
  for (const ln of lineas) {
    const low = normalize(ln);
    if (etiquetas.some((e) => low.startsWith(e))) {
      const f = primeraFecha(ln);
      if (f) return f;
    }
  }
  return undefined;
}

function primeraFecha(texto: string): string | undefined {
  const m = texto.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = texto.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (m2) {
    const d = m2[1].padStart(2, '0');
    const mo = m2[2].padStart(2, '0');
    const y = m2[3].length === 2 ? '20' + m2[3] : m2[3];
    const iso = `${y}-${mo}-${d}`;
    return Number.isNaN(new Date(iso).getTime()) ? undefined : iso;
  }
  return undefined;
}

function detectarMoneda(texto: string): string {
  const t = normalize(texto);
  if (/u\$s|us\$|usd|dolar/.test(t)) return 'USD';
  if (/eur|€/.test(t)) return 'EUR';
  if (/\$u|uyu|pesos uruguayos/.test(t)) return 'UYU';
  return 'USD';
}

export interface PdfExtractResult {
  datos: ImportacionImportData | null;
  encontrados: string[];   // qué campos se pudieron leer
  texto: string;           // texto leído (recortado) para que el operador verifique
  aviso?: string;
}

export async function extraerImportacionDesdePdf(buffer: Buffer): Promise<PdfExtractResult> {
  let texto = '';
  try {
    texto = await textoDelPdf(buffer);
  } catch {
    return { datos: null, encontrados: [], texto: '', aviso: 'No se pudo leer el PDF (puede estar protegido o dañado).' };
  }

  const limpio = texto.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const lineas = limpio.split('\n').map((l) => l.trim()).filter(Boolean);

  if (lineas.length === 0) {
    return {
      datos: null, encontrados: [], texto: '',
      aviso: 'El PDF no tiene texto seleccionable (parece escaneado/imagen). Adjuntalo igual y cargá los datos a mano; para leer PDF escaneados haría falta OCR.',
    };
  }

  const encontrados: string[] = [];
  const marcar = (c: string, v: unknown) => {
    if (v != null && v !== '' && v !== 0) encontrados.push(c);
  };

  // ── Identificación de la operación (vocabulario de la factura del despachante) ──
  const proveedorExterior = valorInicio(lineas, ['proveedor']);
  const paisOrigen = valorInicio(lineas, ['pais del proveedor', 'pais de origen', 'pais', 'origen']);
  const incotermRaw = valorInicio(lineas, ['condicion comercial', 'condicion de venta', 'condicion de compra', 'condicion', 'incoterm']);
  const incoterm = incotermRaw ? incotermRaw.toUpperCase().slice(0, 10) : null;
  const aduana = valorInicio(lineas, ['aduana']);
  const transporteDoc = valorInicio(lineas, ['transporte', 'via de transporte', 'medio de transporte', 'via']);
  const facturaComercialNro = valorInicio(lineas, ['factura comercial', 'factura n', 'factura nro', 'invoice no', 'invoice n', 'nro factura', 'comprobante']);
  const despachante = valorInicio(lineas, ['despachante']);
  const carpeta = valorInicio(lineas, ['carpeta despachante', 'carpeta', 'referencia', 'ref despachante']);
  const cuit = valorInicio(lineas, ['cuit proveedor', 'cuit', 'tax id', 'vat number']);
  const mercaderia = valorInicio(lineas, ['mercaderia', 'descripcion de la mercaderia', 'descripcion de mercaderia', 'descripcion']);
  const fechaLiquidacion = valorInicio(lineas, ['fecha liquidacion', 'fecha de liquidacion', 'fecha liquidacion gastos']);

  // Moneda y tipo de cambio
  const monedaRaw = valorInicio(lineas, ['moneda']);
  const moneda = monedaRaw ? (detectarMoneda(monedaRaw) || detectarMoneda(limpio)) : detectarMoneda(limpio);
  const tipoCambio = montoPorRotulo(lineas, ['tipo de cambio', 't.c', 'tc liquidacion', 'arbitraje', 'exchange rate']) ?? 1;

  // Fechas
  const facturaComercialFecha = fechaPorRotulo(lineas, ['fecha de factura', 'fecha factura', 'fecha de la factura', 'fecha comprobante']);
  const duaFecha = fechaPorRotulo(lineas, ['fecha liquidacion', 'fecha de liquidacion']) ?? primeraFecha(limpio);

  // ── Valores (sección de importes de la liquidación) ──
  const fob = montoPorRotulo(lineas, ['fob', 'valor fob', 'total fob', 'valor mercaderia', 'total factura', 'invoice total', 'total amount', 'importe total']) ?? 0;
  const flete = montoPorRotulo(lineas, ['flete', 'freight', 'fletes', 'flete internacional']) ?? 0;
  const seguro = montoPorRotulo(lineas, ['seguro', 'insurance', 'prima de seguro']) ?? 0;
  const iva = montoPorRotulo(lineas, ['iva importacion', 'iva anticipo', 'iva', 'i.v.a', 'v.a.t', 'vat', 'impuesto al valor']) ?? 0;

  marcar('proveedor', proveedorExterior);
  marcar('país', paisOrigen);
  marcar('condición comercial', incoterm);
  marcar('aduana', aduana);
  marcar('transporte', transporteDoc);
  marcar('N° factura', facturaComercialNro);
  marcar('despachante', despachante);
  marcar('mercadería', mercaderia);
  marcar('moneda', monedaRaw);
  marcar('tipo de cambio', tipoCambio !== 1 ? tipoCambio : 0);
  marcar('fecha factura', facturaComercialFecha);
  marcar('FOB/total', fob);
  marcar('flete', flete);
  marcar('seguro', seguro);
  marcar('IVA', iva);

  // Datos adicionales del despachante que no tienen campo propio → a Notas.
  const notasPartes: string[] = [];
  if (cuit) notasPartes.push(`CUIT proveedor: ${cuit}`);
  if (carpeta) notasPartes.push(`Carpeta despachante: ${carpeta}`);
  if (fechaLiquidacion) notasPartes.push(`Fecha liquidación de gastos: ${fechaLiquidacion}`);
  const notas = notasPartes.length ? notasPartes.join(' · ') : null;

  const datos: ImportacionImportData = {
    regimen: ImportacionRegimen.DEFINITIVA,
    proveedorExterior,
    paisOrigen,
    incoterm,
    monedaOrigen: moneda,
    tipoCambio,
    duaNumero: carpeta, // la carpeta del despachante identifica la operación mientras no haya DUA
    duaFecha,
    despachante,
    aduana,
    fechaNacionalizacion: undefined,
    fob, flete, seguro,
    tributos: iva > 0 ? [{ tipo: TributoImportacionTipo.IVA_IMPORTACION, monto: iva }] : [],
    gastos: [],
    facturaComercialNro,
    facturaComercialFecha,
    transporteDoc,
    notas,
    items: mercaderia ? [{ descripcion: mercaderia }] : [],
  };

  const aviso = encontrados.length
    ? `Leí del PDF: ${encontrados.join(', ')}. Revisá y completá lo que falte antes de guardar.`
    : 'No pude identificar datos en el PDF (puede tener otra disposición de texto). Revisá el texto leído y cargá a mano, o pasanos esta muestra para calibrar la lectura.';

  return { datos, encontrados, texto: limpio.slice(0, 4000), aviso };
}
