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
  | 'DUA' | 'PACKING_LIST' | 'FACTURA_SERVICIOS_UY' | 'PAGO_TRIBUTOS'
  | 'PAGO_SERVICIOS_LOCAL' | 'RECIBO' | 'CERTIFICADO_ORIGEN' | 'AUTORIZACION'
  | 'DOC_TRANSPORTE' | 'OTRO';

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Pesos enteros estilo DUA/Aduana: "22.665" \u2192 22665, "83.166" \u2192 83166
 *  (el punto es separador de miles y NO hay decimales). */
export function parseEntero(raw: string): number | null {
  const d = raw.replace(/[^\d]/g, '');
  if (!d) return null;
  const n = Number(d);
  return Number.isNaN(n) ? null : n;
}

/** RUT uruguayo a 12 d\u00edgitos (quita puntos/guiones). */
function rutDigitos(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  return d.length >= 11 ? d.slice(0, 12).padStart(12, '0') : null;
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
// El orden importa: va de lo MÁS específico a lo más genérico. Calibrada contra
// la carpeta real MARPOLOS (DUA 170135, carpeta 105523/2026): DUA oficial,
// certificado de origen digital ALADI, autorización ante Aduana, pago de tributos
// por SPE/Sistarbanc, transferencia local a la agencia de carga, recibos CFE,
// e-facturas de servicios UY (despachante/terminal/agencia) y packing list.
export function clasificarDocumento(texto: string): { tipo: TipoDoc; confianza: number } {
  const t = norm(texto);
  const corto = texto.trim().length < 40; // PDF escaneado sin capa de texto
  if (t.includes('documento unico aduanero')) return { tipo: 'DUA', confianza: 0.97 };
  if (t.includes('certificado de origen')) return { tipo: 'CERTIFICADO_ORIGEN', confianza: 0.95 };
  if (t.includes('autorizacion para sociedad comercial') || (t.includes('despachante') && t.includes('director') && t.includes('aduana'))) return { tipo: 'AUTORIZACION', confianza: 0.9 };
  if (t.includes('pague sus facturas por internet') || (t.includes('resultado de la transaccion') && t.includes('rut importador'))) return { tipo: 'PAGO_TRIBUTOS', confianza: 0.95 };
  if (t.includes('transferencias en el pais') || (t.includes('monto acreditado') && t.includes('cuenta destino'))) return { tipo: 'PAGO_SERVICIOS_LOCAL', confianza: 0.9 };
  // RECIBO: solo recibos reales (CFE de cobranza / recibo oficial). NO confundir
  // con la mención "RECIBO Nº ..." que las e-facturas del despachante traen en la
  // adenda (esas son FACTURA_SERVICIOS_UY).
  if (t.includes('e-factura - cobranza') || t.includes('recibo oficial')) return { tipo: 'RECIBO', confianza: 0.85 };
  if (t.includes('transaction reference number') || /\b32a\b/.test(t) || t.includes('swift')) return { tipo: 'SWIFT', confianza: 0.9 };
  if (t.includes('ordenes de pago enviadas') || (t.includes('numero de operacion') && t.includes('comision'))) return { tipo: 'DEBITO_BANCARIO', confianza: 0.9 };
  if (t.includes('gastos del embarque') || (t.includes('carpeta') && t.includes('iva importacion') && t.includes('hoja'))) return { tipo: 'LIQUIDACION_DESPACHANTE', confianza: 0.9 };
  if ((t.includes('e-factura') || t.includes('e factura')) && (t.includes('rut comprador') || t.includes('ruc comprador') || t.includes('cae'))) return { tipo: 'FACTURA_SERVICIOS_UY', confianza: 0.88 };
  if (t.includes('factura de exportacion') || (t.includes('factura') && t.includes('fob'))) return { tipo: 'FACTURA_COMERCIAL', confianza: 0.85 };
  if (t.includes('packing list') || (t.includes('condicion de venta') && t.includes('pais de origen')) || (texto.match(/\d+\s*cm\s*x\s*\d+\s*cm/gi)?.length ?? 0) >= 3) return { tipo: 'PACKING_LIST', confianza: 0.8 };
  if (corto) return { tipo: 'DOC_TRANSPORTE', confianza: 0.3 }; // escaneado → probable conocimiento/AWB
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

// ── DUA (Documento Único Aduanero) ───────────────────────────────────────────
// La declaración aduanera oficial. Es la fuente autorizada de: Nº DUA, canal,
// régimen, carpeta, aduana, importador/declarante/proveedor, NCM, país de origen,
// valor en aduana y la LIQUIDACIÓN DE TRIBUTOS (que debe cuadrar con el pago SPE).
export interface TributoDua { codigo: string; nombre: string; monto: number }
export interface DuaParsed {
  nroDua: string | null; canal: string | null; regimen: string | null; carpeta: string | null;
  aduana: string | null; fechaPago: string | null; fechaRegistro: string | null;
  importador: string | null; importadorRut: string | null;
  declarante: string | null; declaranteRut: string | null; codDespachante: string | null;
  proveedor: string | null;
  moneda: string | null; tipoCambio: number | null; importeFacturas: number | null;
  totalBultos: number | null; pesoBruto: number | null; pesoNeto: number | null; nroItems: number | null;
  valorCif: number | null; valorAduanaPesos: number | null; totalTributos: number | null;
  awb: string | null; ncm: string | null; paisOrigen: string | null; estadoMercaderia: string | null;
  facturaNro: string | null;
  tributos: TributoDua[];
}

const DUA_TRIBUTOS: Array<{ codigo: string; nombre: string; re: RegExp }> = [
  { codigo: '16', nombre: 'Adelanto de I.V.A.', re: /ADELANTO SOBRE I\.V\.A\.\s+([\d.]+)/ },
  { codigo: '15', nombre: 'I.V.A. Importación', re: /I\.V\.A\.\s*\(IMPUESTO AL VALOR AGREGADO\)\s+([\d.]+)/ },
  { codigo: '26', nombre: 'Tasa Consular', re: /TASA CONSULAR\s+([\d.]+)/ },
  { codigo: '06', nombre: 'Tasa de Servicios Aduaneros', re: /TASA DE SERVICIOS ADUANEROS\s+([\d.]+)/ },
  { codigo: '27', nombre: 'Guía de Tránsito', re: /GUIA DE TRANSITO\s+([\d.]+)/ },
  { codigo: '32', nombre: 'Timbre Profesional', re: /TIMBRE PROFESIONAL\s+([\d.]+)/ },
  { codigo: '05', nombre: 'Tasa por Servicios Extraordinarios', re: /TASA POR SERVICIOS EXTRAORDINARIOS\s+([\d.]+)/ },
  { codigo: '33', nombre: 'Certificado VUCE', re: /CERTIFICADO VUCE\s+([\d.]+)/ },
  { codigo: '36', nombre: 'Tasa Escáner', re: /TASA ESCANER\s+([\d.]+)/ },
  { codigo: '01', nombre: 'Recargo', re: /\bRECARGO\s+([\d.]+)/ },
  { codigo: '02', nombre: 'IMADUNI (Arancel)', re: /\bIMADUNI\s+([\d.]+)/ },
];

export function parseDUA(texto: string): DuaParsed {
  const b = (re: RegExp): string | null => { const m = texto.match(re); return m ? m[1].trim() : null; };
  const nroDua = b(/(\d{3}-\d{4}-\d{6})/);
  const canal = (texto.match(/\d{3}-\d{4}-\d{6}\s+(ROJO|VERDE|AMARILLO|NARANJA)/i)?.[1]
    || texto.match(/\b(ROJO|VERDE|AMARILLO|NARANJA)\b/)?.[1] || null);
  // "10 Importacion 105523" → régimen 10, nombre Importacion, carpeta 105523
  const mReg = texto.match(/\b(\d{1,2})\s+(Importaci[oó]n\w*)\s+(\d{4,6})\b/i);
  const regimen = mReg ? `${mReg[1]} ${mReg[2]}` : (b(/R[eé]gimen\/Oper[^\n]*\n[^\n]*?(\d+\s+Importaci[oó]n\w*)/i));
  const carpeta = mReg ? mReg[3] : b(/N[ºo°]\s*Carpeta[\s\S]*?(\d{4,6})/i);
  const aduana = b(/^(\d{3}\s+[A-ZÁÉÍÓÚ]+)\s+\d{1,2}\/\d{1,2}\/\d{4}/m);
  const fechaPago = fechaDMY(texto.match(/Adm\. Aduana Fecha de Pago[\s\S]*?(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]
    || texto.match(/^\d{3}\s+[A-ZÁÉÍÓÚ]+\s+(\d{1,2}\/\d{1,2}\/\d{4})/m)?.[1] || null);
  const fechaRegistro = fechaDMY(b(/Fecha Registro\s*(\d{1,2}\/\d{1,2}\/\d{4})/i));
  // Importador / Declarante: "4-220616930019 MARPOLOS URUGUAY SAS EN FORMACION ..."
  const mImp = texto.match(/\d-(\d{12})\s+(.+?(?:SAS|S\.?A\.?S?|SRL|LTDA|S\.? ?A\.?)(?:\s+EN FORMACI[OÓ]N)?)\b/);
  const importadorRut = mImp ? rutDigitos(mImp[1]) : null;
  const importador = mImp ? mImp[2].replace(/\s+/g, ' ').trim() : null;
  const mDecl = texto.match(/Declarante[\s\S]*?\d-(\d{12})\s+([A-ZÑÁÉÍÓÚ][A-ZÑÁÉÍÓÚ ]+?)\s+(\d{4})\b/);
  const declaranteRut = mDecl ? rutDigitos(mDecl[1]) : null;
  const declarante = mDecl ? mDecl[2].replace(/\s+/g, ' ').trim() : null;
  const codDespachante = mDecl ? mDecl[3] : null;
  const proveedor = b(/Proveedor\/Destinatario[\s\S]*?\n[^\n]*?\b([A-ZÑÁÉÍÓÚ][A-ZÑÁÉÍÓÚ .]+?(?:SRL|S\.?A\.?|SPA|LTDA|LLC|GMBH|CO\.?|INC))\b/);
  const importeFacturas = (() => { const v = b(/\n\s*\d+\s+([\d.]+,\d{2})\s+\d{3}\s+DOLARES/i) || b(/Importe Total Facturas[\s\S]*?([\d.]+,\d{2})/i); return v ? parseNum(v) : null; })();
  const moneda = /DOLARES/i.test(texto) ? 'USD' : (/\bEURO/i.test(texto) ? 'EUR' : 'USD');
  const tipoCambio = (() => { const v = texto.match(/TV\s+([\d.,]+)/i)?.[1] || texto.match(/Tipo de Cambio[\s\S]*?(\d{1,3},\d{3,})/i)?.[1]; return v ? parseNum(v) : null; })();
  // Totales: "12,000 139,000 0,00 1 5.628,84 83.166"
  const mTot = texto.match(/\n\s*([\d.]+,\d{3})\s+([\d.]+,\d{3})\s+[\d.]+,\d{2}\s+(\d+)\s+([\d.]+,\d{2})\s+([\d.]+)\s*\n/);
  const totalBultos = mTot ? parseNum(mTot[1]) : (() => { const v = b(/Total Bultos[\s\S]*?(\d+),\d{3}/i); return v ? parseNum(v) : null; })();
  const pesoBrutoHdr = mTot ? parseNum(mTot[2]) : null;
  const nroItems = mTot ? Number(mTot[3]) : null;
  const valorCif = (mTot ? parseNum(mTot[4]) : null) ?? (() => { const v = b(/Total Valor CIF[\s\S]*?([\d.]+,\d{2})/i); return v ? parseNum(v) : null; })();
  const totalTributosHdr = mTot ? parseEntero(mTot[5]) : null;
  // Datos del ítem: "PIEZAS/PIECES  cantidad  pesoNeto  pesoBruto  NCM"
  const mItem = texto.match(/PIEZAS\/PIECES\s+[\d.]+,\d{3}\s+([\d.]+,\d{3})\s+([\d.]+,\d{3})\s+(\d{6,10})/i);
  const pesoNeto = mItem ? parseNum(mItem[1]) : null;
  const pesoBruto = (mItem ? parseNum(mItem[2]) : null) ?? pesoBrutoHdr;
  const ncm = (mItem ? mItem[3] : null) || b(/C[oó]digo NCM[\s\S]*?(\d{8,10})/i) || b(/NCM\s*\n\s*(\d{8,10})/i);
  const awb = (() => { const v = b(/AWB\s*([\d-]{10,})/i); return v ? v.replace(/\D/g, '') : null; })();
  const paisOrigen = b(/Pa[ií]s Origen[\s\S]*?\d{3}\s+([A-ZÁÉÍÓÚ]+)/i) || b(/\b032\s+(ARGENTINA)\b/i);
  const estadoMercaderia = b(/\b10\s+(Nuevo)\b/i);
  const valorAduanaPesos = (() => { const v = b(/5\.628,84\s+([\d.]+,\d{2})/) || b(/Valor Aduanas Pesos[\s\S]*?([\d.]+,\d{2})/i); return v ? parseNum(v) : null; })();
  const facturaNro = b(/FACN\s+([\d-]+)/i);

  const tributos: TributoDua[] = [];
  for (const { codigo, nombre, re } of DUA_TRIBUTOS) {
    const m = texto.match(re);
    if (!m) continue;
    const monto = parseEntero(m[1]);
    if (monto != null && monto > 0) tributos.push({ codigo, nombre, monto });
  }
  const sumaTributos = tributos.reduce((a, t) => a + t.monto, 0);
  const totalTributos = totalTributosHdr ?? (sumaTributos || null);

  return {
    nroDua, canal: canal ?? null, regimen: regimen ?? null, carpeta: carpeta ?? null, aduana, fechaPago, fechaRegistro,
    importador, importadorRut, declarante, declaranteRut, codDespachante, proveedor,
    moneda, tipoCambio, importeFacturas, totalBultos, pesoBruto, pesoNeto, nroItems,
    valorCif, valorAduanaPesos, totalTributos, awb, ncm, paisOrigen, estadoMercaderia, facturaNro, tributos,
  };
}

// ── Factura de servicios UY (CFE: despachante, terminal, agencia de carga) ────
// e-Facturas uruguayas (DGI) de prestadores locales de la operación. Separan
// gastos facturables (gravados/exentos) de los importes "no facturables" que el
// prestador pagó por cuenta del importador (tributos, pagos oficiales, R.Gtos.).
export interface LineaServicio { descripcion: string; importe: number; codIva: string | null }
export interface FacturaServiciosParsed {
  emisor: string | null; rutEmisor: string | null; tipoDoc: string;
  serie: string | null; numero: string | null; rutComprador: string | null; comprador: string | null;
  fecha: string | null; moneda: string; total: number | null;
  subtotalGravado: number | null; iva: number | null; subtotalNoGravado: number | null; noFacturable: number | null;
  honorarios: number | null; gastosOperativos: number | null;
  carpeta: string | null; dua: string | null; tipoCambio: number | null;
  lineas: LineaServicio[];
}

const EMISORES_UY: Record<string, string> = {
  '217369500013': 'Estudio Pacini — Despachante de Aduana',
  '217369500013X': 'Estudio Pacini — Despachante de Aduana',
  '214902340010': 'TCU S.A. — Terminal de Cargas Uruguay',
  '217127640018': 'KIXOLER S.A. (Cielosur) — Agencia de carga aérea',
  '213372720018': 'Danico — Imprenta',
};

export function parseFacturaServiciosUY(texto: string): FacturaServiciosParsed {
  const lineas = texto.split('\n').map((l) => l.trim());
  const t = norm(texto);
  const idxComprador = (() => { const i = t.search(/ru[tc]\s+comprador|ru[tc] comprador/); return i === -1 ? Math.floor(texto.length / 2) : i; })();
  const antes = texto.slice(0, idxComprador);
  const despues = texto.slice(idxComprador);
  const rutEmisor = rutDigitos(antes.match(/\b\d{2}\.?\d{6}\.?\d{4}\b/)?.[0] || antes.match(/\b\d{11,12}\b/)?.[0] || null);
  const rutComprador = rutDigitos(despues.match(/\b\d{2}\.?\d{6}\.?\d{4}\b/)?.[0] || despues.match(/\b\d{11,12}\b/)?.[0] || null);
  const tipoDoc = /e-factura\s*-\s*cobranza/i.test(texto) ? 'Recibo (CFE)' : (/e-factura/i.test(texto) ? 'e-Factura' : 'Comprobante');
  const mSerie = texto.match(/\b([A-Z])\s*-?\s*(\d{4,8})\b/);
  const serie = mSerie ? mSerie[1] : null;
  const numero = mSerie ? mSerie[2] : null;
  const fecha = fechaDMY(texto.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] || null);
  const moneda = /pesos/i.test(texto) ? 'UYU' : (/d[oó]lar/i.test(texto) ? 'USD' : 'UYU');
  const total = (() => { const v = texto.match(/TOTAL A PAGAR:?\s*([\d.,]+)/i)?.[1] || texto.match(/Total a Pagar:?\s*([\d.,]+)/i)?.[1] || texto.match(/\bTOTAL:?\s*([\d.,]+)/i)?.[1]; return v ? parseNum(v) : null; })();

  // Helper: monto de una etiqueta que puede traer el número en la misma línea,
  // en la anterior o en la siguiente (los CFE separan label e importe en renglones).
  const montoEtiqueta = (re: RegExp): number | null => {
    const i = lineas.findIndex((l) => re.test(l));
    if (i === -1) return null;
    for (const cand of [lineas[i], lineas[i - 1] ?? '', lineas[i + 1] ?? '']) {
      const m = cand.match(/([\d.]+,\d{2})/);
      if (m) return parseNum(m[1]);
    }
    return null;
  };
  const subtotalGravado = montoEtiqueta(/SUBTOTAL GRAVADO/i);
  const subtotalNoGravado = montoEtiqueta(/SUBTOTAL NO GRAVADO/i);
  const iva = montoEtiqueta(/TOTAL IVA/i);
  const noFacturable = montoEtiqueta(/NO FACTURABLE/i);
  const honorarios = montoEtiqueta(/HONORARIOS/i);
  const gastosOperativos = montoEtiqueta(/Gastos operativos/i);
  const carpeta = texto.match(/CARPETA:?\s*([\d/]+)/i)?.[1]?.trim() ?? null;
  const dua = (() => { const v = texto.match(/No\.?\s*DUA:?\s*([\d.]+)/i)?.[1] || texto.match(/DUA-?(\d{6})/i)?.[1]; return v ? v.replace(/\./g, '') : null; })();
  const tipoCambio = (() => { const v = texto.match(/TIPO DE CAMBIO:?\s*([\d.,]+)/i)?.[1] || texto.match(/Tipo de Cambio\s+([\d.,]+)/i)?.[1]; return v ? parseNum(v) : null; })();

  // Líneas de detalle: importe (+ código IVA) seguido de su descripción, o
  // descripción seguida del importe. Se filtran subtotales/encabezados y se corta
  // en la ADENDA (donde van VALOR U$S, carpeta, correlativo, etc.).
  const iAdenda = lineas.findIndex((l) => /^ADENDA$/i.test(l));
  const lineasDet = iAdenda === -1 ? lineas : lineas.slice(0, iAdenda);
  const detalle: LineaServicio[] = [];
  const esResumen = (s: string) => /subtotal|total|iva|no facturable|export|p[aá]gina|c[oó]digo de seguridad|cae|rango de cae|vencimiento|valor u\$s|valor \$|valor dna|correlativo|despacho|entrega a cta|recibo n|saldo|tipo de cambio|tipo operacion/i.test(s);
  for (let i = 0; i < lineasDet.length; i++) {
    const l = lineasDet[i];
    const mImp = l.match(/^([\d.]+,\d{2})\s+([1-9])$/); // "453,00 6"
    if (mImp) {
      const desc = (lineas[i + 1] ?? '').replace(/\s+/g, ' ').trim();
      if (desc && !esResumen(desc)) detalle.push({ descripcion: desc.replace(/^-\s*/, '').replace(/\s*-\(R\.?Gtos\.?\)\s*$/i, '').trim(), importe: parseNum(mImp[1]) ?? 0, codIva: mImp[2] });
      continue;
    }
    const mFin = l.match(/^(.+?)\s+([\d.]+,\d{2})(?:\s+0,00)?$/); // "VZ - Verificación de Carga: 1 150,00"
    if (mFin && !esResumen(l) && /[a-zA-Z]{4,}/.test(mFin[1])) {
      detalle.push({ descripcion: mFin[1].replace(/\s+/g, ' ').trim(), importe: parseNum(mFin[2]) ?? 0, codIva: null });
    }
  }

  return {
    emisor: (rutEmisor && EMISORES_UY[rutEmisor]) || null,
    rutEmisor, tipoDoc, serie, numero, rutComprador,
    comprador: despues.match(/(?:NOMBRE\s+)?\b([A-ZÑ][A-ZÑ ]+?(?:SAS|SRL))\b/)?.[1]?.replace(/^NOMBRE\s+/i, '').trim() ?? null,
    fecha, moneda, total, subtotalGravado, iva, subtotalNoGravado, noFacturable,
    honorarios, gastosOperativos, carpeta, dua, tipoCambio, lineas: detalle,
  };
}

// ── Packing list ─────────────────────────────────────────────────────────────
export interface BultoPacking { nro: number; dimensiones: string | null; cantidad: number | null; peso: number | null }
export interface PackingParsed {
  importador: string | null; paisOrigen: string | null; condicionVenta: string | null;
  ncm: string | null; bancoDivisas: string | null;
  totalBultos: number; cantidadTotal: number | null; bultos: BultoPacking[];
}

export function parsePackingList(texto: string): PackingParsed {
  const b = (re: RegExp): string | null => { const m = texto.match(re); return m ? m[1].trim() : null; };
  const bultos: BultoPacking[] = [];
  const reDim = /(\d+)\s+([\d.,]+)\s+(?:[\d.,]+\s+)?(\d+\s*cm\s*x\s*\d+\s*cm\s*x\s*\d+\s*cm)\s+(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = reDim.exec(texto)) !== null) {
    bultos.push({ nro: Number(m[1]), peso: parseNum(m[2]), dimensiones: m[3].replace(/\s+/g, ''), cantidad: Number(m[4]) });
  }
  const cantidadTotal = bultos.length ? bultos.reduce((a, x) => a + (x.cantidad ?? 0), 0) : null;
  return {
    importador: b(/NOMBRE:\s*([A-ZÑ][A-Za-zÑ .]+SAS?)/i),
    paisOrigen: b(/Pa[ií]s de Origen:?\s*([A-Za-zÁÉÍÓÚ]+)/i),
    condicionVenta: b(/Condici[oó]n de Venta:?\s*([A-Za-z ]+?)(?:\n|Pa[ií]s)/i),
    ncm: b(/NCM\s*([\d.]+)/i),
    bancoDivisas: b(/Banco Ingreso de Divisas:?\s*([A-Za-z ]+?)(?:\n|Nuevo)/i),
    totalBultos: bultos.length, cantidadTotal, bultos,
  };
}

// ── Pagos locales (tributos por SPE, transferencia a la agencia) ──────────────
export interface PagoLocalParsed {
  subtipo: 'TRIBUTOS_SPE' | 'TRANSFERENCIA_LOCAL' | 'OTRO';
  referencia: string | null; fecha: string | null; moneda: string; importe: number | null;
  banco: string | null; beneficiario: string | null; detalle: string | null;
  conceptos: Array<{ codigo: string; descripcion: string; monto: number }>;
}

export function parsePagoLocal(texto: string): PagoLocalParsed {
  const t = norm(texto);
  if (t.includes('pague sus facturas') || (t.includes('resultado de la transaccion') && t.includes('importador'))) {
    const conceptos: Array<{ codigo: string; descripcion: string; monto: number }> = [];
    const reC = /^([A-Z]{2,10})\s+(.+?)\s+\$\s*([\d.,]+)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = reC.exec(texto)) !== null) {
      if (/^total$/i.test(m[1])) continue;
      conceptos.push({ codigo: m[1], descripcion: m[2].trim(), monto: parseNum(m[3]) ?? 0 });
    }
    const importe = (() => { const v = texto.match(/Total\s*\$\s*([\d.,]+)/i)?.[1] || texto.match(/Importe\s*\$\s*([\d.,]+)/i)?.[1]; return v ? parseNum(v) : null; })();
    return {
      subtipo: 'TRIBUTOS_SPE',
      referencia: texto.match(/(\d{4}-\d{6}-\d{2})/)?.[1] || texto.match(/autorizaci[oó]n\s+(\d+)/i)?.[1] || null,
      fecha: fechaDMY(texto.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] || null),
      moneda: 'UYU', importe,
      banco: texto.match(/\b(SANTANDER|ITAU|ITA[UÚ]|BROU|BBVA|SCOTIABANK|HSBC|HERITAGE)\b/i)?.[1] ?? null,
      beneficiario: null, detalle: null, conceptos,
    };
  }
  // Transferencia local (Itaú: pago a la agencia de carga en plaza)
  const mMonto = texto.match(/Monto acreditado:?\s*([A-Z]{3})?\s*([\d.,]+)/i);
  return {
    subtipo: 'TRANSFERENCIA_LOCAL',
    referencia: texto.match(/Nro\.?\s*de Referencia:?\s*(\d+)/i)?.[1] ?? null,
    fecha: fechaDMY(texto.match(/Fecha de finalizaci[oó]n:?\s*([\d/]+)/i)?.[1] || texto.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] || null),
    moneda: mMonto?.[1]?.toUpperCase() || (/USD|d[oó]lar/i.test(texto) ? 'USD' : 'UYU'),
    importe: mMonto ? parseNum(mMonto[2]) : null,
    banco: texto.match(/\b(SANTANDER|ITAU|ITA[UÚ]|BROU|BBVA|SCOTIABANK)\b/i)?.[1] ?? null,
    beneficiario: texto.match(/Cuenta corriente\s+([A-ZÑ][A-Za-zÑ .]+)/i)?.[1]?.trim()
      || texto.match(/\b(KIXOLER|CIELOSUR)\b/i)?.[1] || null,
    detalle: texto.match(/Detalle de la transferencia\s*(?:Fecha valor)?\s*([^\n]+)/i)?.[1]?.trim()
      || texto.match(/AWB[^\n]+/i)?.[0]?.trim() || null,
    conceptos: [],
  };
}

// ── Recibo (CFE de cobranza / recibo oficial) ─────────────────────────────────
export interface ReciboParsed {
  emisor: string | null; rutEmisor: string | null; serie: string | null; numero: string | null;
  fecha: string | null; moneda: string; total: number | null; concepto: string | null;
  carpeta: string | null; banco: string | null;
}

export function parseRecibo(texto: string): ReciboParsed {
  const rutEmisor = rutDigitos(texto.match(/\b\d{2}\.?\d{6}\.?\d{4}\b/)?.[0] || texto.match(/RUT:?\s*(\d{11,12})/i)?.[1] || null);
  const mSerie = texto.match(/\b([A-Z])\s*-?\s*0*(\d{4,8})\b/);
  const total = (() => { const v = texto.match(/\bTOTAL:?\s*([\d.,]+)/i)?.[1] || texto.match(/([\d.]+,\d{2})\s*\n\s*TOTAL/i)?.[1]; return v ? parseNum(v) : null; })();
  return {
    emisor: (rutEmisor && EMISORES_UY[rutEmisor]) || texto.match(/^([A-ZÑ][A-Za-zÑ .]+S\.?A\.?)\b/m)?.[1]?.trim() || null,
    rutEmisor,
    serie: mSerie ? mSerie[1] : null,
    numero: mSerie ? mSerie[2] : null,
    fecha: fechaDMY(texto.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] || null),
    moneda: /pesos/i.test(texto) ? 'UYU' : (/d[oó]lar/i.test(texto) ? 'USD' : 'UYU'),
    total,
    concepto: texto.match(/D E S C R I P C I [ÓO] N\s+IMPORTE\s*\n\s*[\d.,]+\s*\n\s*([^\n]+)/i)?.[1]?.trim()
      || texto.match(/\bcobro\s+\w+/i)?.[0]?.trim() || null,
    carpeta: texto.match(/(\d{5,6}\/\d{4})/)?.[1] ?? null,
    banco: texto.match(/\b(SANTANDER|ITAU|ITA[UÚ]|BROU|BBVA|SCOTIABANK)\b/i)?.[1] ?? null,
  };
}

// ── Certificado de origen digital (ALADI / MERCOSUR) ──────────────────────────
export interface CertificadoOrigenParsed {
  numero: string | null; acuerdo: string | null; formulario: string | null;
  exportador: string | null; importador: string | null; paisOrigen: string | null;
  puertoEmbarque: string | null; facturaNro: string | null; facturaFecha: string | null;
}

export function parseCertificadoOrigen(texto: string): CertificadoOrigenParsed {
  const b = (re: RegExp): string | null => { const m = texto.match(re); return m ? m[1].trim() : null; };
  return {
    numero: b(/\b([A-Z]{2}\d{3}[A-Z]\d{2}\d{10,})\b/),
    acuerdo: b(/(AAP[^\n]*?MERCOSUR[^\n]*)/i),
    formulario: b(/Formulario:?\s*([A-Z]\d+)/i),
    exportador: b(/\b([A-ZÑ][A-Za-zÑ .]+?(?:SRL|SPA|LTDA|S\.A\.))\b/),
    importador: b(/(?:SRL|SPA|LTDA|S\.A\.)\s+([A-ZÑ][A-Za-zÑ ]+?SAS?)\b/) || b(/([A-ZÑ][A-Za-zÑ ]+?SAS?)\s*-\s*\d{12}/),
    paisOrigen: b(/\b(Argentina|Brasil|Brazil|Paraguay)\b/i),
    puertoEmbarque: b(/Puerto o Lugar de\s*\n?\s*([A-ZÁÉÍÓÚ]{3,})/i) || b(/embarque\s*\n?\s*([A-ZÁÉÍÓÚ]{3,})/i),
    facturaNro: b(/N[°º] de Factura[\s\S]*?(\d{5}-\d{8})/i) || b(/(\d{5}-\d{8})/),
    facturaFecha: fechaDMY(b(/(\d{1,2}\/\d{1,2}\/\d{4})/)),
  };
}
