/**
 * Parsers deterministas de los documentos de una importación uruguaya,
 * calibrados contra formatos reales (factura AFIP Exporta Simple, liquidación
 * de despachante estilo "Gastos del Embarque", comprobantes Itaú Link / SWIFT
 * MT103). Trabajan sobre el TEXTO ya extraído del PDF (ver
 * importaciones.pdf-extract.service: textoDelPdf). Son determinísticos y
 * auditables; la IA queda como respaldo para formatos no reconocidos.
 *
 * NO convierten moneda ni deciden tratamiento contable: solo estructuran lo que
 * dice el documento. Los importes se devuelven como números (en la moneda del
 * documento); la conversión a centésimos se hace al persistir.
 */

export type TipoDoc =
  | 'FACTURA_COMERCIAL' | 'LIQUIDACION_DESPACHANTE' | 'SWIFT' | 'DEBITO_BANCARIO'
  | 'DUA' | 'PACKING_LIST' | 'OTRO';

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** "1.234,56" / "49.843,00" / "2.500 ,00" / "1.804 , 0 0" → 1234.56 (tolera espacios). */
export function parseNum(raw: string): number | null {
  const t = raw.replace(/[^\d.,]/g, '');
  if (!t) return null;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  const dec = Math.max(lastComma, lastDot);
  if (dec === -1) return Number(t) || 0;
  const intPart = t.slice(0, dec).replace(/[.,]/g, '');
  const decPart = t.slice(dec + 1).replace(/[.,]/g, '');
  const n = parseFloat(`${intPart || '0'}.${decPart || '0'}`);
  return Number.isNaN(n) ? null : n;
}

// ── Clasificación ────────────────────────────────────────────────────────────
export function clasificarDocumento(texto: string): { tipo: TipoDoc; confianza: number } {
  const t = norm(texto);
  if (t.includes('transaction reference number') || /\b32a\b/.test(t) || t.includes('swift')) return { tipo: 'SWIFT', confianza: 0.9 };
  if (t.includes('ordenes de pago enviadas') || (t.includes('numero de operacion') && t.includes('comision'))) return { tipo: 'DEBITO_BANCARIO', confianza: 0.9 };
  if (t.includes('gastos del embarque') || (t.includes('carpeta') && t.includes('iva importacion'))) return { tipo: 'LIQUIDACION_DESPACHANTE', confianza: 0.9 };
  if (t.includes('factura de exportacion') || t.includes('factura') && t.includes('fob')) return { tipo: 'FACTURA_COMERCIAL', confianza: 0.85 };
  if (t.includes('dua') || t.includes('documento unico aduanero')) return { tipo: 'DUA', confianza: 0.6 };
  if (t.includes('packing list')) return { tipo: 'PACKING_LIST', confianza: 0.8 };
  return { tipo: 'OTRO', confianza: 0.2 };
}

// ── Factura comercial ────────────────────────────────────────────────────────
export interface ArticuloFactura { nro: number; codigo: string; descripcion: string; cantidad: number; precioUnit: number; total: number }
export interface FacturaParsed {
  proveedor: string | null; cuit: string | null; numero: string | null; fecha: string | null;
  importador: string | null; idImportador: string | null; moneda: string; incoterm: string | null;
  fob: number | null; flete: number; seguro: number; cif: number | null; total: number | null;
  articulos: ArticuloFactura[];
}

function fechaDMY(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export function parseFacturaComercial(texto: string): FacturaParsed {
  // El PDF suele traer ORIGINAL + DUPLICADO + TRIPLICADO (mismo contenido). Se
  // parsea SOLO la primera copia para no triplicar los artículos.
  const dupIdx = Math.min(...['DUPLICADO', 'TRIPLICADO', 'COPIA'].map((k) => {
    const i = texto.indexOf(k, 200); return i === -1 ? Infinity : i;
  }));
  const base = Number.isFinite(dupIdx) ? texto.slice(0, dupIdx) : texto;
  const lineas = base.split('\n').map((l) => l.trim()).filter(Boolean);

  const buscar = (re: RegExp): string | null => { const m = base.match(re); return m ? m[1].trim() : null; };
  const proveedor = buscar(/Raz[oó]n Social:\s*([^\n]+)/i);
  const cuit = buscar(/CUIT:\s*([\d]+)/i);
  const numero = buscar(/Compr\.?\s*Nro:\s*([\w-]+)/i);
  const fecha = fechaDMY(buscar(/Fecha de Emisi[oó]n:\s*([\d/]+)/i));
  const importador = buscar(/Se[ñn]or\(es\):\s*([^\n]+?)(?:\s+Domicilio:|$)/i);
  const idImportador = buscar(/ID Impositivo:\s*([\d]+)/i);
  const incoterm = buscar(/Incoterms?:\s*([A-Z]{3})/i);
  const fob = (() => { const v = buscar(/Monto FOB en esta Factura:\s*\n?\s*USD\s*([\d.,]+)/i) || buscar(/Monto FOB DES:\s*USD\s*([\d.,]+)/i); return v ? parseNum(v) : null; })();
  const total = (() => { const v = buscar(/Importe Total:\s*([\d.,]+)/i); return v ? parseNum(v) : null; })();

  // Artículos: se anclan en el TRÍO de números de cada renglón
  // (cantidad precioUnit total). Toda línea de artículo lo tiene al final. La
  // descripción ("CODE - …") suele estar en el mismo renglón, pero a veces se
  // parte: el código queda antes del número de ítem y una palabra suelta
  // después. Por eso, si el renglón del trío no trae "CODE - …", se reconstruye
  // mirando hacia atrás (línea con " - ") y hacia adelante (continuación corta).
  const reTrio = /(\d[\d.]*,\d{2,6})\s+(\d[\d.]*,\d{2,6})\s+(\d[\d.]*,\d{2})\s*$/;
  const esBordeDesc = (l: string) => /^U\.?\s*Medida/i.test(l) || /^\d{3,4}$/.test(l) || reTrio.test(l);
  const articulos: ArticuloFactura[] = [];
  let flete = 0, seguro = 0, nroArt = 0;
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(reTrio);
    if (!m) continue;
    const cantidad = parseNum(m[1]) ?? 0;
    const precioUnit = parseNum(m[2]) ?? 0;
    const totalItem = parseNum(m[3]) ?? 0;
    let texto = lineas[i].slice(0, m.index).trim();
    if (!texto.includes(' - ')) {
      // buscar hacia atrás la línea con "CODE - descripción"
      let atras = '';
      for (let k = i - 1; k >= 0 && k >= i - 4; k--) {
        if (esBordeDesc(lineas[k])) { if (/^\d{3,4}$/.test(lineas[k])) continue; else break; }
        if (lineas[k].includes(' - ')) { atras = lineas[k]; break; }
      }
      // continuación corta hacia adelante (ej. "Brillante"), antes de "U. Medida"
      let adelante = '';
      const sig = lineas[i + 1] ?? '';
      if (sig && !esBordeDesc(sig) && !sig.includes(' - ') && sig.length <= 30) adelante = sig;
      texto = `${atras} ${texto} ${adelante}`.replace(/\s+/g, ' ').trim();
    }
    if (!texto.includes(' - ')) continue; // no es un renglón de artículo
    const sep = texto.indexOf(' - ');
    const codigo = texto.slice(0, sep).trim();
    const descripcion = texto.slice(sep + 3).trim();
    const d = norm(descripcion);
    if (d.startsWith('flete')) { flete = totalItem; continue; }
    if (d.startsWith('seguro')) { seguro = totalItem; continue; }
    nroArt += 1;
    articulos.push({ nro: nroArt, codigo, descripcion, cantidad, precioUnit, total: totalItem });
  }

  const cif = total; // en estas facturas "Importe Total" ya es el CIF (FOB+flete+seguro)
  return {
    proveedor, cuit, numero, fecha, importador, idImportador,
    moneda: /USD|D[oó]lar/i.test(base) ? 'USD' : 'USD',
    incoterm, fob, flete, seguro, cif, total, articulos,
  };
}

// ── Liquidación del despachante ──────────────────────────────────────────────
export interface LiquidacionParsed {
  despachante: string | null; carpeta: string | null; fecha: string | null; aduana: string | null;
  importador: string | null; proveedor: string | null; origen: string | null; transporte: string | null;
  cif: number | null; tipoCambio: number | null; moneda: string;
  kilosBrutos: number | null; kilosNetos: number | null;
  conceptos: Record<string, number>; total: number | null; gastosAgenciaExtra: number | null;
}

// clave → subcadena de la etiqueta (solo letras, sin tildes, minúsculas) que la
// identifica. Tolera los espacios internos raros del PDF ("IVA gas tos").
const LIQ_CONCEPTOS: Array<{ clave: string; match: string }> = [
  { clave: 'imaduni', match: 'imaduni' },
  { clave: 'recargo', match: 'recargo' },
  { clave: 'tasaConsular', match: 'tasaconsular' },
  { clave: 'tsa', match: 'tsa' },
  { clave: 'extraordinario', match: 'extraordinario' },
  { clave: 'ivaImportacion', match: 'ivaimportacion' },
  { clave: 'ivaAnticipado', match: 'ivaanticipado' },
  { clave: 'guiaTransito', match: 'guiatransito' },
  { clave: 'timbre', match: 'timbre' },
  { clave: 'vuce', match: 'vuce' },
  { clave: 'escaner', match: 'escaner' },
  { clave: 'tcu', match: 'tcu' },
  { clave: 'gastosOperativos', match: 'gastosoperativos' },
  { clave: 'honorarios', match: 'honorarios' },
  { clave: 'ivaGastos', match: 'ivagastos' },
];

export function parseLiquidacionDespachante(texto: string): LiquidacionParsed {
  const lineas = texto.split('\n');
  const buscar = (re: RegExp): string | null => { const m = texto.match(re); return m ? m[1].trim() : null; };
  const conceptos: Record<string, number> = {};
  for (const { clave, match } of LIQ_CONCEPTOS) {
    const ln = lineas.find((l) => {
      if (!l.includes(':')) return false;
      const etiqueta = norm(l.slice(0, l.lastIndexOf(':')).replace(/[^A-Za-z]/g, ''));
      return etiqueta.includes(match);
    });
    if (!ln) continue;
    const val = ln.slice(ln.lastIndexOf(':') + 1).replace(/\s+/g, '');
    const n = parseNum(val);
    if (n != null) conceptos[clave] = n;
  }
  // Kilos (label con punteado y espacios raros): se busca por etiqueta sin espacios.
  const numPorEtiqueta = (match: string): number | null => {
    const ln = lineas.find((l) => l.includes(':') && norm(l.slice(0, l.lastIndexOf(':')).replace(/[^A-Za-z]/g, '')).includes(match));
    if (!ln) return null;
    return parseNum(ln.slice(ln.lastIndexOf(':') + 1).replace(/\s+/g, ''));
  };
  const kilosBrutos = numPorEtiqueta('kilosbrutos');
  const kilosNetos = numPorEtiqueta('kilosnetos');
  const total = (() => { const v = texto.match(/Total[.\s]*\$?\s*([\d.\s]+,\d+)/i); return v ? parseNum(v[1]) : null; })();
  const gastosAgencia = (() => { const v = texto.match(/Gastos Agencia[.\sU$S]*?([\d.\s]+,\d+)/i); return v ? parseNum(v[1]) : null; })();
  return {
    despachante: buscar(/^([A-Za-zÁÉÍÓÚñ ]+?)\s+Hoja:/m),
    carpeta: buscar(/Carpeta[.\s]*:\s*([\w/]+)/i),
    fecha: fechaDMY(buscar(/Fecha Liquidaci[oó]n[.\s]*:\s*([\d/\s]+)/i)?.replace(/\s/g, '') ?? null),
    aduana: buscar(/Aduana[.\s]*:\s*([^\n]+)/i),
    importador: buscar(/Importador[.\s]*:\s*([^\n]+)/i),
    proveedor: buscar(/Proveedor[.\s]*:\s*([^\n]+)/i),
    origen: buscar(/Origen[.\s]*:\s*([^\n]+)/i),
    transporte: buscar(/Transporte[.\s]*:\s*([^\n]+)/i),
    cif: (() => { const v = buscar(/Importe CIF[.\sU$S]*:?\s*([\d.,]+)/i); return v ? parseNum(v) : null; })(),
    tipoCambio: (() => { const v = buscar(/T\/?Cambio[^\d]*([\d.,]+)/i); return v ? parseNum(v) : null; })(),
    moneda: 'UYU',
    kilosBrutos, kilosNetos,
    conceptos, total, gastosAgenciaExtra: gastosAgencia,
  };
}

// ── Pagos al exterior (Itaú Link / SWIFT) ────────────────────────────────────
export interface PagoParsed {
  ref: string | null;          // referencia/operación — clave para deduplicar SWIFT vs comprobante
  fecha: string | null;        // YYYY-MM-DD
  moneda: string;
  importe: number | null;      // al proveedor
  comision: number;            // comisiones bancarias
  totalDebitado: number | null;
  beneficiario: string | null;
  esComprobante: boolean;      // true = comprobante bancario (con comisión); false = SWIFT
}

const MESES_ES: Record<string, string> = { ENE: '01', FEB: '02', MAR: '03', ABR: '04', MAY: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', SEP: '09', OCT: '10', NOV: '11', DIC: '12' };

export function parsePagoExterior(texto: string): PagoParsed {
  const esComprobante = /N[uú]mero de operaci[oó]n/i.test(texto) && /COMISION/i.test(texto);
  const beneficiario = (texto.match(/Beneficiario[^:]*:\s*\/?\S*\s*([A-Z][A-Za-z .&]+SRL|[A-Z][A-Za-z .&]+S\.?A\.?)/)?.[1]
    || texto.match(/Beneficiary Customer:\s*\n?\s*\/\S*\s*([^\n]+)/i)?.[1] || '').trim() || null;

  if (esComprobante) {
    const ref = texto.match(/N[uú]mero de operaci[oó]n:\s*(\S+)/i)?.[1] ?? null;
    const importe = (() => { const v = texto.match(/Importe:\s*U?\$?S?\s*([\d.,]+)/i); return v ? parseNum(v[1]) : null; })();
    const comision = (() => { const v = texto.match(/COMISION[.\s]*:?\s*([\d.,]+)/i); return v ? (parseNum(v[1]) ?? 0) : 0; })();
    const totalDeb = (() => { const v = texto.match(/TOTAL[.\s]*:?\s*U?\$?S?\s*([\d.,]+)\s*$/im) || texto.match(/TOTAL[.\s]*\.\s*:\s*U?\$?S?\s*([\d.,]+)/i); return v ? parseNum(v[1]) : null; })();
    const vm = texto.match(/Valor:\s*(\d{1,2})([A-Z]{3})(\d{4})/i);
    const fecha = vm ? `${vm[3]}-${MESES_ES[vm[2].toUpperCase()] ?? '01'}-${vm[1].padStart(2, '0')}` : null;
    return { ref, fecha, moneda: 'USD', importe, comision, totalDebitado: totalDeb, beneficiario, esComprobante: true };
  }
  // SWIFT MT103
  const ref = texto.match(/Transaction reference number:\s*\n?\s*(\S+)/i)?.[1] ?? null;
  const m32 = texto.match(/32A[^:]*:\s*\n?\s*(\d{6})\s*([A-Z]{3})\s*([\d.,]+)/i);
  const fecha = m32 ? `20${m32[1].slice(0, 2)}-${m32[1].slice(2, 4)}-${m32[1].slice(4, 6)}` : null;
  const moneda = m32 ? m32[2] : 'USD';
  const importe = m32 ? parseNum(m32[3]) : null;
  return { ref, fecha, moneda, importe, comision: 0, totalDebitado: importe, beneficiario, esComprobante: false };
}

/** Deduplica pagos por referencia: une SWIFT + comprobante de la misma operación. */
export function consolidarPagos(pagos: PagoParsed[]): Array<{ ref: string | null; fecha: string | null; moneda: string; importe: number | null; comision: number; totalDebitado: number | null; beneficiario: string | null; docs: number }> {
  const porRef = new Map<string, PagoParsed[]>();
  for (const p of pagos) {
    const k = p.ref ?? `sinref_${porRef.size}`;
    if (!porRef.has(k)) porRef.set(k, []);
    porRef.get(k)!.push(p);
  }
  return [...porRef.entries()].map(([ref, grupo]) => {
    const comp = grupo.find((g) => g.esComprobante);
    const swift = grupo.find((g) => !g.esComprobante);
    const base = comp ?? swift ?? grupo[0];
    return {
      ref: ref.startsWith('sinref_') ? null : ref,
      fecha: base.fecha ?? swift?.fecha ?? null,
      moneda: base.moneda,
      importe: base.importe ?? swift?.importe ?? null,
      comision: comp?.comision ?? 0,
      totalDebitado: comp?.totalDebitado ?? base.importe ?? null,
      beneficiario: base.beneficiario,
      docs: grupo.length,
    };
  });
}
