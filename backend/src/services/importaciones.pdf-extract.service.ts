/**
 * Extracción de datos desde un PDF (factura del proveedor, comprobante de pago,
 * DUA…) para autocompletar el formulario de importación. Lee el TEXTO del PDF
 * (pdf-parse) y busca, con heurísticas bilingües (es/en), los valores típicos:
 * FOB/total, flete, seguro, IVA, N° de factura/DUA, fecha y moneda.
 *
 * Es BEST-EFFORT: el operador revisa y corrige antes de guardar. Para una
 * lectura exacta por formato de despachante hace falta calibrar con muestras
 * reales (ver docs/importaciones-diseno.md §7).
 */
import pdfParse from 'pdf-parse';
import { ImportacionRegimen, TributoImportacionTipo } from '@prisma/client';
import type { ImportacionImportData } from './importaciones.import.service';

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
    const parsed = await pdfParse(buffer);
    texto = parsed.text || '';
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
  const marcar = (c: string, v: unknown) => { if (v != null && v !== '' && v !== 0) encontrados.push(c); return v; };

  const fob = montoPorRotulo(lineas, ['fob', 'valor fob', 'total fob', 'total factura', 'invoice total', 'total invoice', 'total amount', 'amount', 'importe total', 'total']) ?? 0;
  const flete = montoPorRotulo(lineas, ['flete', 'freight', 'fletes']) ?? 0;
  const seguro = montoPorRotulo(lineas, ['seguro', 'insurance']) ?? 0;
  const iva = montoPorRotulo(lineas, ['iva', 'i.v.a', 'v.a.t', 'vat', 'impuesto al valor']) ?? 0;
  const duaNumero = textoPorRotulo(lineas, ['dua', 'd.u.a', 'despacho n', 'numero de despacho']);
  const facturaNro = textoPorRotulo(lineas, ['factura n', 'factura nro', 'invoice no', 'invoice n', 'invoice #', 'nro factura', 'comprobante n']);
  const despachante = textoPorRotulo(lineas, ['despachante']);
  const duaFecha = primeraFecha(limpio);
  const moneda = detectarMoneda(limpio);

  marcar('FOB/total', fob);
  marcar('flete', flete);
  marcar('seguro', seguro);
  marcar('IVA', iva);
  marcar('DUA', duaNumero);
  marcar('N° factura', facturaNro);
  marcar('despachante', despachante);
  marcar('fecha', duaFecha);

  const datos: ImportacionImportData = {
    regimen: ImportacionRegimen.DEFINITIVA,
    proveedorExterior: null,
    paisOrigen: null,
    incoterm: null,
    monedaOrigen: moneda,
    tipoCambio: 1,
    duaNumero: duaNumero,
    duaFecha,
    despachante: despachante,
    aduana: null,
    fechaNacionalizacion: undefined,
    fob, flete, seguro,
    tributos: iva > 0 ? [{ tipo: TributoImportacionTipo.IVA_IMPORTACION, monto: iva }] : [],
    gastos: [],
  };
  // facturaNro no es parte del modelo de importación simplificado; se informa aparte.
  void facturaNro;

  const aviso = encontrados.length
    ? `Leí del PDF: ${encontrados.join(', ')}. Revisá y completá lo que falte antes de guardar.`
    : 'No pude identificar valores en el PDF. Cargalos a mano, o pasanos una muestra para calibrar la lectura.';

  return { datos, encontrados, texto: limpio.slice(0, 4000), aviso };
}
