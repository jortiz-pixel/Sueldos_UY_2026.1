/**
 * MOTOR DE COSTEO de importaciones, dirigido por los DOCUMENTOS OFICIALES y con
 * validaciones estrictas. Es puro y auditable (no toca la base ni la red): recibe
 * los datos ya extraídos (DUA, factura, e-facturas de servicios, pago SPE) y una
 * cotización contable YA obtenida, y devuelve el costeo + los asientos separados.
 *
 * Reglas (válidas para TODAS las importaciones):
 *  1. CIF = FOB + flete + seguro (en la moneda de la factura).
 *  2. Valor en Aduana en pesos = valor USD × TC aduanero (lo informa el DUA). Es
 *     una cifra FISCAL: solo base de los tributos; NO es el costo.
 *  3. Costo de inventario = Adquisición (CIF de la factura convertido al TC
 *     CONTABLE) + gastos directamente atribuibles + tributos no recuperables.
 *     El TC aduanero NO se usa para la contabilidad. Si falta la cotización
 *     contable, el costo queda PENDIENTE y NO se distribuye ni se asientan los
 *     definitivos.
 *  4. IVA compras deducible = IVA importación + IVA de servicios. El anticipo de
 *     IVA/IRAE NO integra el crédito: es pago a cuenta y va en asiento aparte.
 *  5. Costo unitario_i = (adquisición_i + gastos asignados_i) / cantidad_i; la
 *     suma de los ítems cuadra EXACTO con el costo total del inventario.
 */
import { TributoImportacionTipo, GastoImportacionConcepto } from '@prisma/client';

// ── Validación estricta del tipo de cambio ───────────────────────────────────
export const TC_MIN = 0.01;   // ninguna moneda vale menos de 0,01 peso
export const TC_MAX = 2000;   // ni más de 2.000 pesos (atrapa años, montos, etc.)

export interface TcValidado { valido: boolean; valor: number | null; motivo?: string }

/** Nunca permite que un año, fecha, texto, vacío o importe mal interpretado se
 *  use como tipo de cambio. Devuelve el valor solo si es un TC plausible. */
export function validarTipoCambio(v: unknown): TcValidado {
  if (v === null || v === undefined || v === '') return { valido: false, valor: null, motivo: 'vacío' };
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return { valido: false, valor: null, motivo: 'no numérico' };
  if (n <= 0) return { valido: false, valor: null, motivo: 'no positivo' };
  if (Number.isInteger(n) && n >= 1900 && n <= 2100) return { valido: false, valor: null, motivo: `parece un año (${n})` };
  if (n < TC_MIN || n > TC_MAX) return { valido: false, valor: null, motivo: `fuera de rango plausible (${n})` };
  return { valido: true, valor: n };
}

// ── Sanitización de identificadores (proveedor, expediente, etc.) ─────────────
// Palabras que son rótulos/encabezados de formulario y NUNCA forman parte de un
// identificador real (razón social, carpeta, etc.) → se rechaza todo el valor.
const BASURA_ROTULO = /destinatario|remitente|afectadas|observaciones|descripci[oó]n|raz[oó]n social|c[oó]digo y n|nombre o raz/i;

/** Rechaza fragmentos de rótulo/encabezado que no son identificadores reales
 *  (p. ej. "/Destinatario", "Proveedor/Destinatario", "s Afectadas:", ":",
 *  líneas que empiezan con puntuación o terminan en ":"). */
export function sanitizarIdentificador(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2) return null;
  if (/^[/\\:·.,;–-]/.test(t)) return null;      // empieza con puntuación/rótulo cortado
  if (/:\s*$/.test(t)) return null;              // termina en ":" → es un rótulo
  if (!/[A-Za-zÁÉÍÓÚÑ0-9]/.test(t)) return null; // sin caracteres útiles
  if (BASURA_ROTULO.test(t)) return null;        // contiene una palabra-rótulo
  return t;
}

// ── Tipos de entrada/salida del motor ────────────────────────────────────────
export interface DuaTributo { codigo: string; nombre?: string; monto: number } // pesos enteros
export interface DuaCosteo {
  nroDua: string | null; tipoCambio: unknown; valorAduanaPesos: number | null;
  importadorRut: string | null; importeFacturas: number | null; moneda: string | null;
  tributos: DuaTributo[];
}
export interface FacturaCosteo {
  fob: bigint; flete: bigint; seguro: bigint; total: bigint; moneda: string;
  articulos: Array<{ descripcion: string; codigo: string | null; cantidad: number; total: bigint }>;
}
export interface ServicioCosteo {
  rutComprador: string | null; moneda: string | null; serie: string | null; numero: string | null; emisor: string | null;
  honorarios: number | null; gastosOperativos: number | null; iva: number | null; total: number | null;
}

export interface CosteoDocInput {
  dua: DuaCosteo | null;
  factura: FacturaCosteo | null;
  servicios: ServicioCosteo[];
  pagoSpeCtms: bigint | null;  // total pagado por SPE (centésimos pesos), para conciliar
  tcContable: number | null;   // cotización CONTABLE ya obtenida de fuente válida; null => pendiente
}

export interface TributoCosteo { tipo: TributoImportacionTipo; monto: bigint; recuperable: boolean; codigo: string }
export interface GastoCosteo { concepto: GastoImportacionConcepto; descripcion: string; monto: bigint; gravadoIva: boolean; ivaGasto: bigint }
export interface ItemCosteo { descripcion: string; ncm: string | null; cantidad: number; fobTotal: bigint; costo: bigint }

export interface CosteoDocResultado {
  estado: 'OK' | 'PENDIENTE';
  motivos: string[];
  tcContable: number | null; tcAduanero: number | null; tcAduaneroMotivo?: string;
  adquisicionPesos: bigint; fletePesos: bigint; seguroPesos: bigint; cifContable: bigint;
  valorAduaneroPesos: bigint;
  tributos: TributoCosteo[]; totalTributos: bigint; tributosNoRecuperables: bigint;
  ivaImportacion: bigint; anticipos: bigint;
  gastos: GastoCosteo[]; totalGastos: bigint; ivaGastos: bigint;
  creditoFiscalIva: bigint;
  costoInventario: bigint | null; // null si PENDIENTE
  items: ItemCosteo[] | null;     // null si PENDIENTE (no se distribuye con datos incompletos)
  conciliacion: { duaVsSpe: { ok: boolean; dua: bigint; spe: bigint; dif: bigint } | null };
}

const DUA_TRIB_TIPO: Record<string, TributoImportacionTipo> = {
  '15': TributoImportacionTipo.IVA_IMPORTACION,
  '16': TributoImportacionTipo.ANTICIPO_IVA,
  '06': TributoImportacionTipo.TASA_SERVICIOS,
  '36': TributoImportacionTipo.TASA_SERVICIOS,
  '05': TributoImportacionTipo.TASA_SERVICIOS,
  '26': TributoImportacionTipo.OTRO,
  '27': TributoImportacionTipo.OTRO,
  '32': TributoImportacionTipo.OTRO,
  '33': TributoImportacionTipo.OTRO,
  '01': TributoImportacionTipo.RECARGO,
  '02': TributoImportacionTipo.ARANCEL_TEC,
};

export function esTributoRecuperableTipo(tipo: TributoImportacionTipo): boolean {
  return tipo === TributoImportacionTipo.IVA_IMPORTACION
    || tipo === TributoImportacionTipo.ANTICIPO_IVA
    || tipo === TributoImportacionTipo.ANTICIPO_IRAE;
}

const P = (pesos: number | null | undefined): bigint => BigInt(Math.round((pesos ?? 0) * 100));
const conv = (ctmsME: bigint, tc: number): bigint => BigInt(Math.round(Number(ctmsME) * tc));

/** Motor principal: arma el costeo documental con estado OK/PENDIENTE. */
export function construirCosteoDocumental(input: CosteoDocInput): CosteoDocResultado {
  const { dua, factura, servicios, pagoSpeCtms, tcContable } = input;
  const motivos: string[] = [];

  // Tipo de cambio aduanero (solo fiscal, validado estrictamente).
  const tcAd = validarTipoCambio(dua?.tipoCambio);
  const tcAduanero = tcAd.valor;

  // Tributos: SIEMPRE desde el DUA (están en pesos; no dependen del TC).
  const tributos: TributoCosteo[] = (dua?.tributos ?? []).map((t) => {
    const tipo = DUA_TRIB_TIPO[t.codigo] ?? TributoImportacionTipo.OTRO;
    return { tipo, monto: P(t.monto), recuperable: esTributoRecuperableTipo(tipo), codigo: t.codigo };
  });
  const totalTributos = tributos.reduce((s, t) => s + t.monto, 0n);
  const ivaImportacion = tributos.filter((t) => t.tipo === TributoImportacionTipo.IVA_IMPORTACION).reduce((s, t) => s + t.monto, 0n);
  const anticipos = tributos.filter((t) => t.tipo === TributoImportacionTipo.ANTICIPO_IVA || t.tipo === TributoImportacionTipo.ANTICIPO_IRAE).reduce((s, t) => s + t.monto, 0n);
  const tributosNoRecuperables = tributos.filter((t) => !t.recuperable).reduce((s, t) => s + t.monto, 0n);

  // Gastos de plaza: solo los facturados AL IMPORTADOR (no se duplica lo que el
  // despachante re-cobra por cuenta de terceros, que viene facturado a él).
  const importadorRut = dua?.importadorRut ?? null;
  const gastos: GastoCosteo[] = [];
  for (const s of servicios) {
    if (importadorRut && s.rutComprador && s.rutComprador !== importadorRut) continue;
    const esUsd = (s.moneda ?? '').toUpperCase() === 'USD';
    const factor = esUsd ? (tcContable ?? 0) : 1; // los gastos en ME solo se convierten con TC contable válido
    if (esUsd && !tcContable) { motivos.push(`Falta cotización contable para convertir un gasto en ${s.moneda}.`); }
    const hon = Number(s.honorarios) || 0;
    const gop = Number(s.gastosOperativos) || 0;
    if (hon || gop) {
      gastos.push({ concepto: GastoImportacionConcepto.HONORARIOS_DESPACHANTE, descripcion: `Honorarios y gastos del despachante${s.serie ? ` (${s.serie}${s.numero ?? ''})` : ''}`, monto: P((hon + gop) * factor || (hon + gop)), gravadoIva: true, ivaGasto: P((Number(s.iva) || 0) * (esUsd ? factor : 1)) });
    } else {
      const total = Number(s.total) || 0;
      if (total > 0) gastos.push({ concepto: GastoImportacionConcepto.OTRO, descripcion: `${s.emisor ?? 'Servicio de plaza'}${s.serie ? ` (${s.serie}${s.numero ?? ''})` : ''}`, monto: P(esUsd ? total * factor : total), gravadoIva: (Number(s.iva) || 0) > 0, ivaGasto: P((Number(s.iva) || 0) * (esUsd ? factor : 1)) });
    }
  }
  const totalGastos = gastos.reduce((s, g) => s + g.monto, 0n);
  const ivaGastos = gastos.reduce((s, g) => s + g.ivaGasto, 0n);
  const creditoFiscalIva = ivaImportacion + ivaGastos;

  // Valor en Aduana (fiscal) en pesos, del DUA.
  const valorAduaneroPesos = P(dua?.valorAduanaPesos);

  // Adquisición (costo) = CIF de la factura × TC CONTABLE. Sin TC contable o sin
  // factura válida, NO se calcula el costo (queda pendiente).
  if (!tcContable) motivos.push('Falta la cotización contable de la fecha de reconocimiento (no se usa el TC aduanero para el costo).');
  if (!factura) motivos.push('Falta la factura comercial del proveedor.');
  else if (factura.fob <= 0n) motivos.push('El FOB de la factura es inválido o incompleto.');
  if (!dua) motivos.push('Falta el DUA oficial.');

  let adquisicionPesos = 0n, fletePesos = 0n, seguroPesos = 0n, cifContable = 0n;
  if (tcContable && factura && factura.fob > 0n) {
    adquisicionPesos = conv(factura.fob, tcContable);
    fletePesos = conv(factura.flete, tcContable);
    seguroPesos = conv(factura.seguro, tcContable);
    cifContable = adquisicionPesos + fletePesos + seguroPesos;
  }

  const estado: 'OK' | 'PENDIENTE' = motivos.length === 0 ? 'OK' : 'PENDIENTE';

  // Costo de inventario e ítems: SOLO si el costeo está OK (no se distribuye con
  // una adquisición incompleta o una conversión inválida).
  let costoInventario: bigint | null = null;
  let items: ItemCosteo[] | null = null;
  if (estado === 'OK') {
    costoInventario = cifContable + tributosNoRecuperables + totalGastos;
    const arts = factura!.articulos;
    const sumaFob = arts.reduce((s, a) => s + a.total, 0n);
    items = [];
    let acum = 0n;
    for (let i = 0; i < arts.length; i++) {
      const a = arts[i];
      const fobTotalP = conv(a.total, tcContable!);
      let costo: bigint;
      if (sumaFob > 0n && i < arts.length - 1) { costo = (costoInventario * a.total) / sumaFob; acum += costo; }
      else costo = costoInventario - acum; // el último absorbe el redondeo → la suma cuadra exacto
      items.push({ descripcion: a.descripcion, ncm: null, cantidad: a.cantidad, fobTotal: fobTotalP, costo });
    }
  }

  // Conciliación: tributos del DUA vs pago por SPE.
  let duaVsSpe: CosteoDocResultado['conciliacion']['duaVsSpe'] = null;
  if (dua && pagoSpeCtms != null) {
    const dif = totalTributos - pagoSpeCtms;
    duaVsSpe = { ok: (dif < 0n ? -dif : dif) <= 100n, dua: totalTributos, spe: pagoSpeCtms, dif };
    if (!duaVsSpe.ok) motivos.push('Los tributos del DUA no concilian con el pago por SPE.');
  }

  return {
    estado, motivos,
    tcContable, tcAduanero, tcAduaneroMotivo: tcAd.valido ? undefined : tcAd.motivo,
    adquisicionPesos, fletePesos, seguroPesos, cifContable, valorAduaneroPesos,
    tributos, totalTributos, tributosNoRecuperables, ivaImportacion, anticipos,
    gastos, totalGastos, ivaGastos, creditoFiscalIva,
    costoInventario, items,
    conciliacion: { duaVsSpe },
  };
}

// ── Asientos contables SEPARADOS ─────────────────────────────────────────────
export interface LineaAsientoDoc { cuenta: string; debe: bigint; haber: bigint }
export interface AsientoDoc { fecha: string | null; glosa: string; lineas: LineaAsientoDoc[]; balanceado: boolean; definitivo: boolean }
export interface FechasAsiento { factura: string | null; dua: string | null; pagoProveedor: string | null; pagoDespachante: string | null }

/** Campos que necesita el generador de asientos (los expone CosteoDocResultado y
 *  también se arman desde una importación ya persistida). */
export interface AsientoInput {
  estado: 'OK' | 'PENDIENTE';
  adquisicionPesos: bigint; fletePesos: bigint; seguroPesos: bigint;
  anticipos: bigint; totalTributos: bigint; ivaImportacion: bigint; tributosNoRecuperables: bigint;
  totalGastos: bigint; ivaGastos: bigint;
}

/** Arma el AsientoInput desde una importación persistida (sus tributos/gastos). */
export function asientoInputDesdeImportacion(imp: {
  costeoEstado?: string | null; fob: bigint; flete: bigint; seguro: bigint; anticipos: bigint; totalTributos: bigint; totalGastos: bigint;
  tributos: { tipo: TributoImportacionTipo; monto: bigint; recuperable: boolean }[];
  gastos: { ivaGasto: bigint }[];
}): AsientoInput {
  const ivaImportacion = imp.tributos.filter((t) => t.tipo === TributoImportacionTipo.IVA_IMPORTACION).reduce((s, t) => s + t.monto, 0n);
  const tributosNoRecuperables = imp.tributos.filter((t) => !t.recuperable).reduce((s, t) => s + t.monto, 0n);
  const ivaGastos = imp.gastos.reduce((s, g) => s + g.ivaGasto, 0n);
  return {
    estado: imp.costeoEstado === 'PENDIENTE' ? 'PENDIENTE' : 'OK',
    adquisicionPesos: imp.fob, fletePesos: imp.flete, seguroPesos: imp.seguro,
    anticipos: imp.anticipos, totalTributos: imp.totalTributos, ivaImportacion, tributosNoRecuperables,
    totalGastos: imp.totalGastos, ivaGastos,
  };
}

/** Genera asientos SEPARADOS por hecho económico, con fecha y contrapartida
 *  correctas. El reconocimiento de la compra/mercadería es DEFINITIVO solo si el
 *  costeo está OK; si está PENDIENTE, se emiten únicamente los asientos que no
 *  dependen del costo (anticipos y, si hubo, pagos), y los definitivos se bloquean.
 */
export function armarAsientosImportacion(
  r: AsientoInput,
  fechas: FechasAsiento,
  etiqueta: (clave: string) => string,
  pagos?: { proveedor?: bigint; despachante?: bigint },
): AsientoDoc[] {
  const asientos: AsientoDoc[] = [];
  const mk = (fecha: string | null, glosa: string, lineas: LineaAsientoDoc[], definitivo: boolean): void => {
    const ls = lineas.filter((l) => l.debe !== 0n || l.haber !== 0n);
    if (!ls.length) return;
    const debe = ls.reduce((s, l) => s + l.debe, 0n);
    const haber = ls.reduce((s, l) => s + l.haber, 0n);
    asientos.push({ fecha, glosa, lineas: ls, balanceado: debe === haber, definitivo });
  };

  // 1) Anticipos de IVA/IRAE (pago a cuenta) — NO integran el costo.
  if (r.anticipos > 0n) {
    mk(fechas.dua, 'Anticipos de IVA/IRAE pagados en la importación (pago a cuenta)', [
      { cuenta: etiqueta('anticipoIvaImportacion'), debe: r.anticipos, haber: 0n },
      { cuenta: etiqueta('bancoPesos'), debe: 0n, haber: r.anticipos },
    ], true);
  }

  // 2) Tributos del DUA (IVA importación como crédito; no recuperables al costo).
  if (r.totalTributos - r.anticipos > 0n) {
    mk(fechas.dua, 'Tributos del DUA (IVA importación y tributos no recuperables)', [
      { cuenta: etiqueta('ivaComprasImportacion'), debe: r.ivaImportacion, haber: 0n },
      { cuenta: etiqueta('mercaderiasImportadas'), debe: r.tributosNoRecuperables, haber: 0n },
      { cuenta: etiqueta('bancoPesos'), debe: 0n, haber: r.ivaImportacion + r.tributosNoRecuperables },
    ], r.estado === 'OK');
  }

  // 3) Reconocimiento de la compra (mercadería por FOB) — DEFINITIVO solo si OK.
  if (r.estado === 'OK' && r.adquisicionPesos > 0n) {
    mk(fechas.factura, 'Reconocimiento de la compra (mercadería al CIF contable)', [
      { cuenta: etiqueta('mercaderiasImportadas'), debe: r.adquisicionPesos + r.fletePesos + r.seguroPesos, haber: 0n },
      { cuenta: etiqueta('proveedoresExterior'), debe: 0n, haber: r.adquisicionPesos },
      { cuenta: etiqueta('proveedoresLocales'), debe: 0n, haber: r.fletePesos + r.seguroPesos },
    ], true);
  }

  // 4) Gastos del despachante / plaza (gasto al costo + su IVA crédito).
  if (r.totalGastos > 0n || r.ivaGastos > 0n) {
    mk(fechas.pagoDespachante ?? fechas.dua, 'Gastos de la operación facturados por el despachante y la plaza', [
      { cuenta: etiqueta('mercaderiasImportadas'), debe: r.totalGastos, haber: 0n },
      { cuenta: etiqueta('ivaComprasPlaza'), debe: r.ivaGastos, haber: 0n },
      { cuenta: etiqueta('despachantes'), debe: 0n, haber: r.totalGastos + r.ivaGastos },
    ], r.estado === 'OK');
  }

  // 5) Pagos (cancelación de pasivos), si se informaron.
  if (pagos?.proveedor && pagos.proveedor > 0n) {
    mk(fechas.pagoProveedor, 'Pago al proveedor del exterior', [
      { cuenta: etiqueta('proveedoresExterior'), debe: pagos.proveedor, haber: 0n },
      { cuenta: etiqueta('bancoMe'), debe: 0n, haber: pagos.proveedor },
    ], true);
  }
  if (pagos?.despachante && pagos.despachante > 0n) {
    mk(fechas.pagoDespachante, 'Pago al despachante de aduana', [
      { cuenta: etiqueta('despachantes'), debe: pagos.despachante, haber: 0n },
      { cuenta: etiqueta('bancoPesos'), debe: 0n, haber: pagos.despachante },
    ], true);
  }

  return asientos;
}
