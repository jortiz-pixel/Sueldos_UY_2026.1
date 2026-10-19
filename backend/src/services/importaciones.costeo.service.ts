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
  importadorRut: string | null; declaranteRut?: string | null; unidadesComerciales?: number | null;
  importeFacturas: number | null; moneda: string | null;
  tributos: DuaTributo[];
}
export interface FacturaCosteo {
  fob: bigint; flete: bigint; seguro: bigint; total: bigint; moneda: string;
  articulos: Array<{ descripcion: string; codigo: string | null; cantidad: number; total: bigint }>;
}
export interface ServicioCosteo {
  rutComprador: string | null; rutEmisor?: string | null; moneda: string | null; serie: string | null; numero: string | null; emisor: string | null;
  honorarios: number | null; gastosOperativos: number | null; iva: number | null; total: number | null;
  noFacturable?: number | null; concepto?: string | null;
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
    if (esUsd && !tcContable) { motivos.push(`Falta la cotización fiscal del día para convertir un gasto en ${s.moneda}.`); }
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
  if (!tcContable) motivos.push('Falta la cotización fiscal del día de la operación (no se pudo obtener del DUA ni del BCU).');
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

// ═════════════════════════════════════════════════════════════════════════════
// COSTEO HISTÓRICO (v2) — dirigido por los PAGOS reales. La mercadería pagada por
// adelantado es una partida NO MONETARIA: su costo se fija al tipo de cambio de
// CADA anticipo (NIC 21). No se usa el TC aduanero del DUA para la adquisición.
// Produce: adquisición histórica, gastos desglosados (con dedup por cuenta de
// terceros), asientos CRONOLÓGICOS con referencias (documento/página/regla) y en
// pesos + moneda original, y las conciliaciones. Si falta alguna cotización, el
// costo es PROVISIONAL y se bloquea la aprobación definitiva.
// ═════════════════════════════════════════════════════════════════════════════
export interface AnticipoProveedor {
  fecha: string | null;      // YYYY-MM-DD (fecha valor del pago)
  referencia: string | null; // nº de operación / SWIFT
  moneda: string;
  monto: number;             // ME al proveedor
  comision: number;          // ME comisión bancaria
  cotizacion: number | null; // cotización fiscal del día del pago (null → provisional)
  fuente?: string | null;    // fuente verificable de la cotización (ej. "BCU 2026-06-09")
}
export interface ServicioFechado extends ServicioCosteo { fecha?: string | null; cotizacion?: number | null; fuenteCotizacion?: string | null }

export interface AsientoRef { documento: string; pagina?: string | null; regla: string }
export interface LineaAsientoHist { cuenta: string; monedaOrig?: string | null; montoOrig?: number | null; debe: bigint; haber: bigint }
export interface AsientoHist { fecha: string | null; glosa: string; definitivo: boolean; balanceado: boolean; lineas: LineaAsientoHist[]; referencias: AsientoRef[] }

export interface GastoDesglosado {
  documento: string; emisor: string | null; rutEmisor: string | null; concepto: string; moneda: string;
  fecha?: string | null; fuenteCotizacion?: string | null;
  montoME: number; cotizacion: number; montoUYU: bigint; ivaUYU: bigint;
  gravado: boolean; porCuentaDeTerceros: boolean; incluidoEnCosto: boolean; esDelDespachante: boolean; tratamiento: string;
  // true si la cotización del gasto en ME no tiene respaldo verificable (p. ej. quedó
  // con el TC del DUA): el importe no es definitivo.
  provisional?: boolean;
  // true si el comprobante es SOLO IVA de plaza (p. ej. "IVA sobre flete"): crédito
  // fiscal, no integra el costo, pero SÍ integra la cuenta de la agencia de carga.
  esIvaPlaza?: boolean;
}

export interface CosteoHistorico {
  estado: 'OK' | 'PROVISIONAL';
  motivos: string[];
  anticipos: Array<AnticipoProveedor & { montoUYU: bigint; comisionUYU: bigint; provisional: boolean; tcUsado: number | null }>;
  adquisicionUYU: bigint;               // costo de la MERCADERÍA (CIF), sin el exceso pagado
  anticiposPagadosUYU: bigint;          // total efectivamente girado al proveedor (anticipos)
  excesoPagado: { me: number; uyu: bigint } | null; // pagado de más sobre el CIF (crédito, NO capitalizado)
  saldoNoAnticipado: { me: number; uyu: bigint } | null;
  comisionesBancariasUYU: bigint;
  tributos: TributoCosteo[]; totalTributos: bigint; tributosNoRecuperables: bigint; ivaImportacion: bigint; anticiposFiscales: bigint;
  gastos: GastoDesglosado[]; totalGastosUYU: bigint; ivaGastosUYU: bigint; creditoFiscalIva: bigint;
  costoInventario: bigint | null;
  items: Array<{ codigo: string | null; descripcion: string; cantidad: number; fobME: bigint; costo: bigint }> | null;
  // Cuenta corriente del despachante UNIFICADA (misma que usan asientos y conciliación).
  // Diferencia el saldo documentado (cargos), los pagos CONFIRMADOS (con egreso bancario)
  // y los pagos PENDIENTES de confirmación (solo recibo de cobranza).
  cuentaDespachante: {
    cargosUYU: bigint; pagosUYU: bigint;
    pagosConfirmadosUYU: bigint; pagosPendientesUYU: bigint;
    // saldoUYU = saldo PROYECTADO (neto de todos los movimientos, incluido el pago sin
    // confirmar). saldoConfirmadoUYU = solo movimientos CONFIRMADOS (asientos definitivos):
    // el saldo real mientras el pago no se acredite. saldoProyectadoUYU = con el pago.
    saldoUYU: bigint; saldoConfirmadoUYU: bigint; saldoProyectadoUYU: bigint;
    pagoConfirmado: boolean;
  } | null;
  asientos: AsientoHist[];
  // Verificación automática de consistencia (PASO 6): todas las igualdades deben dar 0.
  consistencia: {
    costoInventario: bigint | null;
    sumaCostoArticulos: bigint;          // Σ costo de los ítems
    movimientosMercaderia: bigint;       // Σ (debe − haber) en la cuenta Mercaderías de los asientos
    adquisicionContable: bigint;         // adquisición usada para el costeo
    adquisicionAsiento: bigint;          // adquisición usada en el asiento de incorporación
    difArticulos: bigint; difAsientos: bigint; difAdquisicion: bigint; ok: boolean;
  };
  conciliacion: {
    despachante: { cargos: Array<{ concepto: string; monto: bigint }>; totalCargos: bigint; pagos: Array<{ concepto: string; monto: bigint }>; totalPagos: bigint; saldo: bigint; nota: string } | null;
    tributos: { dua: bigint; spe: bigint; ok: boolean; detalle: Array<{ codigo: string; nombre: string; monto: bigint }> } | null;
    unidades: {
      dua: number | null; factura: number;
      packing: number | null; packingBultos: number | null; packingBultosDeclarados: number | null;
      ok: boolean; parseIncompleto: boolean; nota: string;
    };
    anticiposVsCif: { anticiposME: number; cifME: number; difME: number; nota: string } | null;
    // Cuenta de la AGENCIA de carga: lo facturado por la agencia (servicios + IVA de
    // plaza) vs lo pagado por el recibo. Si no coinciden, señala un comprobante sin
    // registrar (p. ej. un IVA sobre flete faltante).
    agencia: { facturadoME: number; pagadoME: number; difME: number; deudaUYU: string; nota: string } | null;
    // Liquidación preliminar del despachante vs tributos liquidados del DUA. Explica,
    // sin eliminarla, la diferencia (p. ej. la Tasa Escáner y los redondeos entre el
    // estimado y el liquidado).
    liquidacionPreliminar: {
      total: bigint | null; sumaConceptos: bigint; difTotalConceptos: bigint;
      sumaTributos: bigint; tributosDua: bigint; difVsDua: bigint;
      detalle: Array<{ concepto: string; monto: bigint }>; nota: string;
    } | null;
  };
}

export interface CosteoHistoricoInput {
  dua: DuaCosteo | null;
  factura: FacturaCosteo | null;
  servicios: ServicioFechado[];
  anticipos: AnticipoProveedor[];
  pagoSpeCtms: bigint | null;
  pagoDespachanteCtms: bigint | null;
  fechaPagoDespachante?: string | null;    // fecha del recibo del despachante
  pagoDespachanteConfirmado?: boolean;      // true solo con comprobante de egreso bancario (si no, sujeto a confirmación)
  pagoAgencia?: { fecha: string | null; moneda: string; montoME: number } | null; // evidencia de la transferencia a la agencia (fecha + ME)
  fechaReconocimiento: string | null;      // DUA / nacionalización
  cotizacionReconocimiento: number | null; // para el saldo no anticipado
  tcProvisional: number | null;            // fallback marcado provisional (ej. TC del DUA)
  unidadesPacking: number | null;
  // Packing list: bultos efectivamente parseados y bultos declarados en el documento
  // (para detectar parseos incompletos y conciliar cantidades contra factura/DUA).
  packingBultos?: number | null;
  packingBultosDeclarados?: number | null;
  // Liquidación preliminar del despachante (hoja "Gastos del Embarque"): total y
  // conceptos declarados, para conciliar contra los tributos liquidados del DUA.
  liquidacionPreliminar?: { total: bigint | null; conceptos: Array<{ clave: string; monto: bigint }> } | null;
  etiqueta: (clave: string) => string;
}

const cents = (me: number, tc: number): bigint => BigInt(Math.round(me * tc * 100));

/**
 * FÓRMULA ÚNICA del costo de la mercadería importada — la misma para TODAS las
 * importaciones (manual o documental):
 *
 *   Costo total = Adquisición + Tributos NO recuperables + Gastos atribuibles
 *
 * Datos: Adquisición (factura del proveedor / pagos al proveedor), Tributos no
 * recuperables (DUA), Gastos atribuibles (factura del despachante). NO integran el
 * costo los anticipos de impuestos (IVA/IRAE) ni el IVA que la empresa recupera
 * (crédito fiscal). Centralizada acá para que ningún cálculo diverja.
 */
export function costoMercaderiaImportada(adquisicionUYU: bigint, tributosNoRecuperablesUYU: bigint, gastosAtribuiblesUYU: bigint): bigint {
  return adquisicionUYU + tributosNoRecuperablesUYU + gastosAtribuiblesUYU;
}

/** Una cotización es DEFINITIVA solo si su fuente es verificable: BCU, carga manual
 *  o una cotización contable cargada. El tipo de cambio ADUANERO del DUA NO respalda
 *  el criterio contable/fiscal: si una partida en ME quedó valuada con una fuente así
 *  (o sin fuente), se mantiene PROVISIONAL, no definitiva. */
export function cotizacionRespaldada(fuente?: string | null): boolean {
  const f = (fuente ?? '').trim();
  if (!f) return false;
  if (/\bDUA\b|aduaner/i.test(f)) return false;                 // el TC del DUA no respalda
  if (/provisional/i.test(f)) return false;
  return /^(BCU|MANUAL|cotizaci[oó]n cargada|cargada|operaci[oó]n en pesos)/i.test(f);
}

export function construirCosteoHistorico(input: CosteoHistoricoInput): CosteoHistorico {
  const { dua, factura, servicios, anticipos, pagoSpeCtms, pagoDespachanteCtms, fechaPagoDespachante, pagoDespachanteConfirmado, pagoAgencia, fechaReconocimiento, cotizacionReconocimiento, tcProvisional, unidadesPacking, packingBultos, packingBultosDeclarados, liquidacionPreliminar, etiqueta } = input;
  const motivos: string[] = [];
  const et = etiqueta;

  // ── Tributos (del DUA, en pesos) ──
  const tributos: TributoCosteo[] = (dua?.tributos ?? []).map((t) => {
    const tipo = DUA_TRIB_TIPO[t.codigo] ?? TributoImportacionTipo.OTRO;
    return { tipo, monto: P(t.monto), recuperable: esTributoRecuperableTipo(tipo), codigo: t.codigo };
  });
  const totalTributos = tributos.reduce((s, t) => s + t.monto, 0n);
  const ivaImportacion = tributos.filter((t) => t.tipo === TributoImportacionTipo.IVA_IMPORTACION).reduce((s, t) => s + t.monto, 0n);
  const anticiposFiscales = tributos.filter((t) => t.tipo === TributoImportacionTipo.ANTICIPO_IVA || t.tipo === TributoImportacionTipo.ANTICIPO_IRAE).reduce((s, t) => s + t.monto, 0n);
  const tributosNoRecuperables = tributos.filter((t) => !t.recuperable).reduce((s, t) => s + t.monto, 0n);

  // ── Adquisición histórica (anticipos a su cotización de fecha de pago) ──
  let provisionalCosto = false;
  const anticiposCalc = anticipos.map((a) => {
    const tcReal = validarTipoCambio(a.cotizacion);
    const tc = tcReal.valido ? tcReal.valor! : (validarTipoCambio(tcProvisional).valor);
    const provisional = !tcReal.valido;
    if (provisional) { provisionalCosto = true; motivos.push(`Falta la cotización fiscal del ${a.fecha ?? 's/f'} para el anticipo ${a.referencia ?? ''} (costo provisional).`); }
    const tcUsado = tc ?? null;
    const fuente = a.fuente ?? (provisional ? `provisional (TC del DUA ${tc ?? '—'})` : (a.fecha ? `BCU ${a.fecha}` : 'cotización cargada'));
    return { ...a, tcUsado, provisional, fuente, montoUYU: tc ? cents(a.monto, tc) : 0n, comisionUYU: tc ? cents(a.comision, tc) : 0n };
  });
  const anticiposPagadosUYU = anticiposCalc.reduce((s, a) => s + a.montoUYU, 0n); // total girado al proveedor
  const comisionesBancariasUYU = anticiposCalc.reduce((s, a) => s + a.comisionUYU, 0n);

  // La MERCADERÍA se reconoce por el CIF de la factura (no por lo pagado): el
  // exceso pagado sobre el CIF NO se capitaliza (queda como crédito con el
  // proveedor). Si los anticipos no cubren el CIF, el saldo va al TC de
  // reconocimiento. Sin diferencias ocultas: la mercadería cubierta por anticipos
  // = pagado − exceso (el exceso es la cola del último anticipo).
  const cifME = factura ? Number(factura.total) / 100 : 0;
  const anticiposME = anticipos.reduce((s, a) => s + a.monto, 0);
  const difME = Math.round((anticiposME - cifME) * 100) / 100;
  let excesoPagado: { me: number; uyu: bigint } | null = null;
  let saldoNoAnticipado: { me: number; uyu: bigint } | null = null;
  let mercaderiaAnticiposUYU = anticiposPagadosUYU;
  if (anticiposME - cifME > 0.005 && anticiposCalc.length) {
    const excesoMe = Math.round((anticiposME - cifME) * 100) / 100;
    const ultTc = anticiposCalc[anticiposCalc.length - 1].tcUsado ?? 0;
    const excUYU = cents(excesoMe, ultTc);
    excesoPagado = { me: excesoMe, uyu: excUYU };
    mercaderiaAnticiposUYU = anticiposPagadosUYU - excUYU; // CIF cubierto por anticipos
  } else if (cifME - anticiposME > 0.005) {
    const saldoMe = Math.round((cifME - anticiposME) * 100) / 100;
    const tcR = validarTipoCambio(cotizacionReconocimiento).valor ?? validarTipoCambio(tcProvisional).valor;
    if (!validarTipoCambio(cotizacionReconocimiento).valido) { provisionalCosto = true; motivos.push('Falta la cotización fiscal de la fecha de reconocimiento para el saldo no anticipado (provisional).'); }
    saldoNoAnticipado = { me: saldoMe, uyu: tcR ? cents(saldoMe, tcR) : 0n };
  }
  const adquisicionUYU = mercaderiaAnticiposUYU + (saldoNoAnticipado?.uyu ?? 0n);

  // ── Gastos de plaza (desglosados, con dedup por cuenta de terceros) ──
  const importadorRut = dua?.importadorRut ?? null;
  const rutDespachante = dua?.declaranteRut ?? null;
  const gastos: GastoDesglosado[] = [];
  // Cada gasto de la iteración se marca provisional si su cotización en ME no es
  // definitiva (sin respaldo BCU/manual, p. ej. quedó con el TC del DUA).
  let gastoProvisional = false;
  const pushG = (g: GastoDesglosado) => gastos.push({ ...g, provisional: g.provisional ?? gastoProvisional });
  for (const s of servicios) {
    const esUsd = (s.moneda ?? '').toUpperCase() === 'USD';
    const cotOk = validarTipoCambio(s.cotizacion).valido;
    const respaldada = !esUsd || cotizacionRespaldada(s.fuenteCotizacion);
    const tcS = esUsd ? (validarTipoCambio(s.cotizacion).valor ?? validarTipoCambio(tcProvisional).valor) : 1;
    gastoProvisional = esUsd && (!cotOk || !respaldada);
    if (esUsd && !cotOk) { provisionalCosto = true; motivos.push(`Falta la cotización del servicio ${s.emisor ?? ''} (${s.serie ?? ''}${s.numero ?? ''}) para convertir ${s.moneda} (provisional).`); }
    else if (esUsd && !respaldada) { provisionalCosto = true; motivos.push(`La cotización del servicio ${s.emisor ?? ''} (${s.serie ?? ''}${s.numero ?? ''}) no tiene respaldo verificable (fuente: ${s.fuenteCotizacion ?? 'sin fuente'}): se mantiene PROVISIONAL, no se considera definitiva.`); }
    const doc = `${s.emisor ?? 'Servicio'} ${s.serie ?? ''}${s.numero ?? ''}`.trim();
    const facturadoATercero = !!(importadorRut && s.rutComprador && s.rutComprador !== importadorRut);
    const hon = Number(s.honorarios) || 0;
    const gop = Number(s.gastosOperativos) || 0;
    if (facturadoATercero) {
      // No es costo del importador: lo re-cobra el despachante (evita duplicar).
      pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: 'Servicio facturado al despachante', moneda: s.moneda ?? 'UYU', montoME: Number(s.total) || 0, cotizacion: tcS ?? 1, montoUYU: 0n, ivaUYU: 0n, gravado: false, porCuentaDeTerceros: true, incluidoEnCosto: false, tratamiento: 'Facturado a un tercero (el despachante); se evita duplicar — el costo entra por su re-facturación.' });
      continue;
    }
    if (hon || gop) {
      if (hon) pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: 'Honorarios del despachante', moneda: s.moneda ?? 'UYU', montoME: hon, cotizacion: tcS ?? 1, montoUYU: cents(hon, tcS ?? 1), ivaUYU: cents(Math.round(hon * 0.22 * 100) / 100, tcS ?? 1), gravado: true, porCuentaDeTerceros: false, incluidoEnCosto: true, tratamiento: 'Gasto directamente atribuible (gravado 22%, IVA crédito).' });
      if (gop) pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: 'Gastos operativos', moneda: s.moneda ?? 'UYU', montoME: gop, cotizacion: tcS ?? 1, montoUYU: cents(gop, tcS ?? 1), ivaUYU: cents(Math.round(gop * 0.22 * 100) / 100, tcS ?? 1), gravado: true, porCuentaDeTerceros: false, incluidoEnCosto: true, tratamiento: 'Gasto directamente atribuible (gravado 22%, IVA crédito).' });
      // El "no facturable" de la e-factura del despachante = tributos del DUA (NO es gasto).
      const noFac = Number(s.noFacturable) || 0;
      if (noFac) pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: 'Pagos por cuenta del importador (tributos / tasas oficiales)', moneda: s.moneda ?? 'UYU', montoME: noFac, cotizacion: 1, montoUYU: 0n, ivaUYU: 0n, gravado: false, porCuentaDeTerceros: false, incluidoEnCosto: false, tratamiento: 'No es gasto: son los tributos del DUA pagados por cuenta; ya se cuentan en la liquidación aduanera.' });
    } else {
      const total = Number(s.total) || 0;
      if (total > 0) {
        const concStr = `${s.concepto ?? ''} ${doc}`;
        // Comprobante que es SOLO IVA de plaza (p. ej. "IVA sobre flete", emitido aparte
        // por la agencia de carga): es CRÉDITO FISCAL, no integra el costo, pero SÍ
        // integra la cuenta de la agencia (así el pasivo iguala al recibo).
        const esIvaPlaza = /^\s*i\.?\s*v\.?\s*a\.?\b/i.test(String(s.concepto ?? '').trim()) || /\biva\b\s*(sobre|por|s\/|de)?\s*(flete|transporte|carga|embarque|plaza)/i.test(concStr);
        if (esIvaPlaza) {
          pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: 'IVA sobre flete / plaza (crédito fiscal)', moneda: s.moneda ?? 'UYU', montoME: total, cotizacion: tcS ?? 1, montoUYU: 0n, ivaUYU: cents(total, tcS ?? 1), gravado: false, porCuentaDeTerceros: false, incluidoEnCosto: false, esIvaPlaza: true, tratamiento: 'Comprobante de IVA (p. ej. IVA sobre flete): crédito fiscal, no integra el costo; integra la cuenta de la agencia para que el pasivo iguale al recibo.' });
        } else {
          const esReembolso = /terceros|terminal/i.test(doc) || /terceros|terminal/i.test(String(s.concepto ?? ''));
          pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: esReembolso ? 'Reembolso de gasto de terminal (por cuenta de terceros)' : 'Servicio de plaza', moneda: s.moneda ?? 'UYU', montoME: total, cotizacion: tcS ?? 1, montoUYU: cents(total, tcS ?? 1), ivaUYU: 0n, gravado: (Number(s.iva) || 0) > 0, porCuentaDeTerceros: esReembolso, incluidoEnCosto: true, tratamiento: esReembolso ? 'Costo del importador (reembolso del gasto de terminal que el despachante pagó por su cuenta).' : 'Gasto directamente atribuible.' });
        }
      }
    }
  }
  const totalGastosUYU = gastos.filter((g) => g.incluidoEnCosto).reduce((s, g) => s + g.montoUYU, 0n);
  const ivaGastosUYU = gastos.reduce((s, g) => s + g.ivaUYU, 0n);
  const creditoFiscalIva = ivaImportacion + ivaGastosUYU;

  // ── Costo de inventario y distribución por artículo ──
  if (!factura) motivos.push('Falta la factura comercial del proveedor.');
  if (!dua) motivos.push('Falta el DUA oficial.');
  if (!anticipos.length && !saldoNoAnticipado) motivos.push('No hay pagos al proveedor para valuar la adquisición.');

  const estado: 'OK' | 'PROVISIONAL' = (provisionalCosto || !factura || !dua || adquisicionUYU === 0n) ? 'PROVISIONAL' : 'OK';

  let costoInventario: bigint | null = null;
  let items: CosteoHistorico['items'] = null;
  if (adquisicionUYU > 0n && factura) {
    costoInventario = costoMercaderiaImportada(adquisicionUYU, tributosNoRecuperables, totalGastosUYU);
    const arts = factura.articulos;
    const sumaFob = arts.reduce((s, a) => s + a.total, 0n);
    items = [];
    let acum = 0n;
    for (let i = 0; i < arts.length; i++) {
      const a = arts[i];
      let costo: bigint;
      if (sumaFob > 0n && i < arts.length - 1) { costo = (costoInventario * a.total) / sumaFob; acum += costo; }
      else costo = costoInventario - acum;
      items.push({ codigo: a.codigo ?? null, descripcion: a.descripcion, cantidad: a.cantidad, fobME: a.total, costo });
    }
  }

  // ── Asientos CRONOLÓGICOS con referencias y moneda original ──
  const asientos: AsientoHist[] = [];
  const mk = (fecha: string | null, glosa: string, lineas: LineaAsientoHist[], referencias: AsientoRef[], definitivo: boolean) => {
    const ls = lineas.filter((l) => l.debe !== 0n || l.haber !== 0n);
    if (!ls.length) return;
    const d = ls.reduce((s, l) => s + l.debe, 0n), h = ls.reduce((s, l) => s + l.haber, 0n);
    asientos.push({ fecha, glosa, definitivo, balanceado: d === h, lineas: ls, referencias });
  };
  // 1-N) Anticipos y comisiones, cada uno a su fecha.
  for (const a of anticiposCalc) {
    mk(a.fecha, `Anticipo al proveedor del exterior${a.referencia ? ` (op. ${a.referencia})` : ''}`, [
      { cuenta: et('anticiposProveedores'), monedaOrig: a.moneda, montoOrig: a.monto, debe: a.montoUYU, haber: 0n },
      { cuenta: et('gastosBancarios'), monedaOrig: a.moneda, montoOrig: a.comision, debe: a.comisionUYU, haber: 0n },
      { cuenta: et('bancoMe'), monedaOrig: a.moneda, montoOrig: a.monto + a.comision, debe: 0n, haber: a.montoUYU + a.comisionUYU },
    ], [{ documento: `SWIFT/Itaú op. ${a.referencia ?? ''}`, regla: `Anticipo no monetario (NIC 21): se valúa al TC fiscal del día de pago (${a.tcUsado ?? '—'})${a.provisional ? ' — PROVISIONAL' : ''}.` }], !a.provisional);
  }
  // Reconocimiento de la mercadería (aplica anticipos; sin dividir proveedor).
  if (costoInventario != null) {
    const lineasRec: LineaAsientoHist[] = [
      { cuenta: et('mercaderiasImportadas'), debe: adquisicionUYU, haber: 0n },
      { cuenta: et('anticiposProveedores'), debe: 0n, haber: mercaderiaAnticiposUYU },
    ];
    if (saldoNoAnticipado) lineasRec.push({ cuenta: et('proveedoresExterior'), monedaOrig: factura?.moneda, montoOrig: saldoNoAnticipado.me, debe: 0n, haber: saldoNoAnticipado.uyu });
    mk(fechaReconocimiento, 'Reconocimiento de la mercadería (incorporación al inventario y aplicación de anticipos)', lineasRec,
      [{ documento: `Factura comercial`, regla: 'Inventario al CIF de la factura valuado por los anticipos (TC de cada pago); el exceso pagado NO se capitaliza (crédito con el proveedor); el saldo no anticipado al TC de reconocimiento. No se divide el importe del proveedor del exterior.' }], estado === 'OK');
  }
  // Flujos de fondos reconstruidos de los comprobantes, SIN duplicar bancos:
  // si la e-factura del despachante trae los tributos como "no facturable", los
  // pagó el despachante (SPE por cuenta) y el importador los reintegra en el
  // recibo → la contrapartida es DESPACHANTES, no Banco (el pago único es el
  // recibo). Si no, los pagó el importador directo por SPE → contrapartida Banco.
  const noFacDespachante = servicios.reduce((s, x) => s + (Number(x.noFacturable) || 0), 0);
  const difNoFac = P(noFacDespachante) - totalTributos;
  const tributosPorDespachante = noFacDespachante > 0 && (difNoFac < 0n ? -difNoFac : difNoFac) <= 200n;

  // Gastos divididos por prestador: despachante (cuenta corriente) vs agencia/plaza.
  // La cuenta de la agencia incluye TODOS sus comprobantes: los servicios que integran
  // el costo Y el IVA de plaza puro (p. ej. "IVA sobre flete"), que es crédito fiscal
  // pero igual integra el pasivo con la agencia (así el pasivo iguala al recibo).
  const gDesp = gastos.filter((g) => g.incluidoEnCosto && g.esDelDespachante);
  const gAgencia = gastos.filter((g) => (g.incluidoEnCosto || g.esIvaPlaza) && !g.esDelDespachante);
  const montoDesp = gDesp.reduce((s, g) => s + g.montoUYU, 0n); const ivaDesp = gDesp.reduce((s, g) => s + g.ivaUYU, 0n);
  const montoAg = gAgencia.reduce((s, g) => s + g.montoUYU, 0n); const ivaAg = gAgencia.reduce((s, g) => s + g.ivaUYU, 0n);
  const fechaDesp = gDesp.find((g) => g.fecha)?.fecha ?? fechaReconocimiento;
  const fechaAg = gAgencia.find((g) => g.fecha)?.fecha ?? fechaReconocimiento;

  // Tributos del DUA (28/08): contrapartida según quién los pagó (sin doble banco).
  if (totalTributos > 0n) {
    mk(fechaReconocimiento, 'Tributos aduaneros y anticipos fiscales del DUA', [
      { cuenta: et('ivaComprasImportacion'), debe: ivaImportacion, haber: 0n },
      { cuenta: et('mercaderiasImportadas'), debe: tributosNoRecuperables, haber: 0n },
      { cuenta: et('anticipoIvaImportacion'), debe: anticiposFiscales, haber: 0n },
      { cuenta: et(tributosPorDespachante ? 'despachantes' : 'bancoPesos'), debe: 0n, haber: totalTributos },
    ], [{ documento: `DUA ${dua?.nroDua ?? ''}`, pagina: 'pág. 1 (tributos)', regla: 'Tributos liquidados en el DUA; IVA importación = crédito fiscal; anticipo IVA = pago a cuenta (no integra costo); no recuperables al inventario.' }, { documento: 'Pago SPE/Sistarbanc (cód. autorización)', regla: tributosPorDespachante ? 'Los pagó el despachante por cuenta del importador (constan como "no facturable" en su e-factura y se reintegran en el recibo); contrapartida Despachantes, NO Banco (el único egreso bancario es el recibo).' : 'Pagados directamente por el importador por SPE; contrapartida Banco.' }], true);
  }
  // Gastos y honorarios del DESPACHANTE (cuenta corriente del despachante).
  if (montoDesp > 0n || ivaDesp > 0n) {
    mk(fechaDesp, 'Gastos y honorarios del despachante de aduana', [
      { cuenta: et('mercaderiasImportadas'), debe: montoDesp, haber: 0n },
      { cuenta: et('ivaComprasPlaza'), debe: ivaDesp, haber: 0n },
      { cuenta: et('despachantes'), debe: 0n, haber: montoDesp + ivaDesp },
    ], [{ documento: gDesp.map((g) => g.documento).filter((v, i, a) => a.indexOf(v) === i).join(', '), regla: 'Gastos directamente atribuibles al inventario (honorarios, operativos y reembolso de terminal); IVA de servicios = crédito fiscal. El reembolso de terceros se cuenta una sola vez.' }], estado === 'OK');
  }
  // Gastos de la AGENCIA de carga / plaza (prestador distinto del despachante).
  if (montoAg > 0n || ivaAg > 0n) {
    mk(fechaAg, 'Gastos de la agencia de carga / plaza', [
      { cuenta: et('mercaderiasImportadas'), debe: montoAg, haber: 0n },
      { cuenta: et('ivaComprasPlaza'), debe: ivaAg, haber: 0n },
      { cuenta: et('proveedoresLocales'), monedaOrig: gAgencia[0]?.moneda, montoOrig: gAgencia.reduce((s, g) => s + g.montoME, 0), debe: 0n, haber: montoAg + ivaAg },
    ], [{ documento: gAgencia.map((g) => g.documento).filter((v, i, a) => a.indexOf(v) === i).join(', '), regla: 'Servicio de un prestador distinto del despachante (agencia de carga); se paga por separado, no integra la cuenta del despachante.' }], estado === 'OK');
  }
  // Pago al despachante (recibo) — ÚNICO egreso bancario que cubre tributos + gastos.
  // SUJETO A CONFIRMACIÓN del pago bancario mientras solo se cuente con el recibo.
  if (pagoDespachanteCtms && pagoDespachanteCtms > 0n) {
    mk(fechaPagoDespachante ?? fechaReconocimiento, `Pago al despachante de aduana (recibo)${pagoDespachanteConfirmado ? '' : ' — sujeto a confirmación'}`, [
      { cuenta: et('despachantes'), debe: pagoDespachanteCtms, haber: 0n },
      { cuenta: et('bancoPesos'), debe: 0n, haber: pagoDespachanteCtms },
    ], [{ documento: 'Recibo del despachante (cobranza)', regla: `Cancela la cuenta del despachante (tributos reintegrados + gastos + honorarios). ${pagoDespachanteConfirmado ? 'Pago confirmado por comprobante bancario.' : 'SUJETO A CONFIRMACIÓN del egreso bancario (solo consta el recibo de cobranza).'}` }], !!pagoDespachanteConfirmado);
  }
  // Pago a la agencia de carga (transferencia en plaza): cancela su cuenta por el
  // valor contabilizado del servicio (la ME pagada se muestra como referencia).
  const deudaAgencia = montoAg + ivaAg;
  if (pagoAgencia && deudaAgencia > 0n) {
    mk(pagoAgencia.fecha ?? fechaAg, 'Pago a la agencia de carga (transferencia)', [
      { cuenta: et('proveedoresLocales'), monedaOrig: pagoAgencia.moneda, montoOrig: pagoAgencia.montoME, debe: deudaAgencia, haber: 0n },
      { cuenta: et(pagoAgencia.moneda && pagoAgencia.moneda !== 'UYU' ? 'bancoMe' : 'bancoPesos'), monedaOrig: pagoAgencia.moneda, montoOrig: pagoAgencia.montoME, debe: 0n, haber: deudaAgencia },
    ], [{ documento: `Transferencia en plaza${pagoAgencia.fecha ? ` ${pagoAgencia.fecha}` : ''}`, regla: 'Cancelación del servicio de la agencia de carga (comprobante de transferencia); cuenta separada del despachante.' }], true);
  }
  asientos.sort((a, b) => (a.fecha ?? '9999').localeCompare(b.fecha ?? '9999'));

  // Cuenta corriente del despachante UNIFICADA = movimientos a Despachantes en los
  // asientos (misma base que la conciliación y el resumen).
  const movDespachante = asientos.reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === 'despachantes').reduce((ss, l) => ss + l.debe - l.haber, 0n), 0n);
  const cargosDespachante = asientos.reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === 'despachantes').reduce((ss, l) => ss + l.haber, 0n), 0n);
  const pagosDespachanteAs = asientos.reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === 'despachantes').reduce((ss, l) => ss + l.debe, 0n), 0n);
  // Pagos CONFIRMADOS = debe a Despachantes en asientos definitivos (egreso bancario
  // verificado); PENDIENTES = debe a Despachantes en asientos provisorios (solo recibo
  // de cobranza, sin comprobante de egreso).
  const pagosConfirmadosDesp = asientos.filter((a) => a.definitivo).reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === 'despachantes').reduce((ss, l) => ss + l.debe, 0n), 0n);
  const pagosPendientesDesp = asientos.filter((a) => !a.definitivo).reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === 'despachantes').reduce((ss, l) => ss + l.debe, 0n), 0n);
  // Saldo CONFIRMADO = neto de los movimientos de asientos DEFINITIVOS (el pago sin
  // confirmar no cuenta). Saldo PROYECTADO = neto de todos (como si el pago se acreditara).
  const saldoConfirmadoDesp = asientos.filter((a) => a.definitivo).reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === 'despachantes').reduce((ss, l) => ss + l.debe - l.haber, 0n), 0n);
  const cuentaDespachante = (cargosDespachante > 0n || pagosDespachanteAs > 0n)
    ? { cargosUYU: cargosDespachante, pagosUYU: pagosDespachanteAs, pagosConfirmadosUYU: pagosConfirmadosDesp, pagosPendientesUYU: pagosPendientesDesp, saldoUYU: movDespachante, saldoConfirmadoUYU: saldoConfirmadoDesp, saldoProyectadoUYU: movDespachante, pagoConfirmado: !!pagoDespachanteConfirmado }
    : null;

  // ── Conciliaciones ──
  // La cuenta del despachante se toma de los MISMOS asientos (cuentaDespachante),
  // así el resumen, la conciliación y los asientos muestran una ÚNICA cuenta.
  const conc: CosteoHistorico['conciliacion'] = {
    despachante: cuentaDespachante ? (() => {
      const cargos: Array<{ concepto: string; monto: bigint }> = [];
      if (tributosPorDespachante) cargos.push({ concepto: 'Tributos del DUA (pagados por el despachante por cuenta)', monto: totalTributos });
      for (const g of gDesp) cargos.push({ concepto: `${g.documento}: ${g.concepto}`, monto: g.montoUYU });
      if (ivaDesp > 0n) cargos.push({ concepto: 'IVA de servicios del despachante', monto: ivaDesp });
      const saldo = cuentaDespachante.saldoUYU; // debe − haber: >0 = a favor del importador (pagó de más)
      const conf = cuentaDespachante.pagoConfirmado ? '' : ' Pago SUJETO A CONFIRMACIÓN (solo consta el recibo de cobranza, falta el comprobante de egreso bancario).';
      // Pagos diferenciados: confirmados (egreso verificado) vs pendientes de confirmación.
      const pagos: Array<{ concepto: string; monto: bigint }> = [];
      if (cuentaDespachante.pagosConfirmadosUYU > 0n) pagos.push({ concepto: 'Pagos confirmados (egreso bancario verificado)', monto: cuentaDespachante.pagosConfirmadosUYU });
      if (cuentaDespachante.pagosPendientesUYU > 0n) pagos.push({ concepto: 'Pagos pendientes de confirmación (solo recibo de cobranza)', monto: cuentaDespachante.pagosPendientesUYU });
      if (!pagos.length) pagos.push({ concepto: 'Sin pagos registrados', monto: 0n });
      const sC = cuentaDespachante.saldoConfirmadoUYU; // saldo real mientras el pago no se acredita
      const sP = cuentaDespachante.saldoProyectadoUYU; // saldo si el pago se acredita
      const fmtSaldo = (v: bigint) => (v > 0n ? `$ ${(Number(v) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2 })} a favor del importador` : (v < 0n ? `$ ${(Number(-v) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2 })} a pagar al despachante` : 'saldada'));
      // Diferencia explícita entre el saldo CONFIRMADO y el PROYECTADO (si hay pagos sin confirmar).
      const nota = cuentaDespachante.pagosPendientesUYU > 0n
        ? `Saldo CONFIRMADO: ${fmtSaldo(sC)} (el pago de $ ${(Number(cuentaDespachante.pagosPendientesUYU) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2 })} aún NO está acreditado). Saldo PROYECTADO si se acredita ese pago: ${fmtSaldo(sP)}.${conf}`
        : (saldo > 0n ? `Saldo a favor del importador de $ ${(Number(saldo) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2 })} (entrega a cuenta mayor; documentado en el recibo y la adenda).` : (saldo < 0n ? `Saldo pendiente con el despachante de $ ${(Number(-saldo) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2 })}.` : 'Cuenta saldada.')) + conf;
      return { cargos, totalCargos: cuentaDespachante.cargosUYU, pagos, totalPagos: cuentaDespachante.pagosUYU, saldo, nota };
    })() : null,
    tributos: (dua && pagoSpeCtms != null) ? { dua: totalTributos, spe: pagoSpeCtms, ok: (totalTributos - pagoSpeCtms < 0n ? pagoSpeCtms - totalTributos : totalTributos - pagoSpeCtms) <= 100n, detalle: tributos.map((t) => ({ codigo: t.codigo, nombre: (dua.tributos.find((x) => x.codigo === t.codigo)?.nombre) ?? t.codigo, monto: t.monto })) } : null,
    unidades: { dua: dua ? null : null, factura: factura ? factura.articulos.reduce((s, a) => s + (a.cantidad || 0), 0) : 0, packing: unidadesPacking, packingBultos: packingBultos ?? null, packingBultosDeclarados: packingBultosDeclarados ?? null, ok: false, parseIncompleto: false, nota: '' },
    anticiposVsCif: factura ? { anticiposME, cifME, difME, nota: difME > 0 ? `Pagado de más ${difME.toFixed(2)} ${factura.moneda} sobre el CIF: NO se capitaliza (queda como crédito con el proveedor).` : (difME < 0 ? `Falta anticipar ${(-difME).toFixed(2)} ${factura.moneda}: el saldo se valúa al TC de reconocimiento.` : `Los anticipos cubren exactamente el CIF (${cifME.toFixed(2)} ${factura.moneda}).`) } : null,
    agencia: (pagoAgencia || gAgencia.length) ? (() => {
      const facturadoME = Math.round(gAgencia.reduce((s, g) => s + g.montoME, 0) * 100) / 100;
      const pagadoME = Math.round((pagoAgencia?.montoME ?? 0) * 100) / 100;
      const dif = Math.round((facturadoME - pagadoME) * 100) / 100;
      const mon = gAgencia[0]?.moneda ?? pagoAgencia?.moneda ?? 'USD';
      const nota = dif === 0
        ? `La agencia facturó ${facturadoME.toFixed(2)} ${mon} (servicios + IVA de plaza) y el recibo pagó ${pagadoME.toFixed(2)} ${mon}: coincide.`
        : (dif < 0
            ? `El recibo (${pagadoME.toFixed(2)} ${mon}) supera lo facturado registrado (${facturadoME.toFixed(2)} ${mon}) en ${(-dif).toFixed(2)} ${mon}: falta registrar un comprobante de la agencia (p. ej. IVA sobre flete). El pasivo NO iguala al recibo hasta cargarlo.`
            : `Lo facturado por la agencia (${facturadoME.toFixed(2)} ${mon}) supera el recibo (${pagadoME.toFixed(2)} ${mon}) en ${dif.toFixed(2)} ${mon}: revisar el pago.`);
      return { facturadoME, pagadoME, difME: dif, deudaUYU: (montoAg + ivaAg).toString(), nota };
    })() : null,
    liquidacionPreliminar: null,
  };
  // Unidades DUA (viene como número en el DUA).
  const duaUnidades = (dua as unknown as { unidadesComerciales?: number })?.unidadesComerciales ?? null;
  conc.unidades.dua = duaUnidades;
  conc.unidades.ok = duaUnidades != null ? duaUnidades === conc.unidades.factura : false;
  // Conciliación de cantidades con el packing list. El packing puede traer menos
  // unidades por un PARSEO INCOMPLETO (bultos con formato degradado en el PDF): se
  // DETECTA (bultos parseados < bultos declarados, o unidades del packing < factura/DUA)
  // y se SEÑALA honestamente, sin forzar ninguna cifra.
  const refUnidades = duaUnidades ?? conc.unidades.factura; // referencia oficial (DUA; si no, factura)
  const pk = conc.unidades.packing;
  const pkBultos = conc.unidades.packingBultos;
  const pkBultosDecl = conc.unidades.packingBultosDeclarados;
  const parseIncompleto = (pkBultos != null && pkBultosDecl != null && pkBultos < pkBultosDecl)
    || (pk != null && refUnidades > 0 && pk < refUnidades);
  conc.unidades.parseIncompleto = parseIncompleto;
  const notaDuaFac = duaUnidades != null
    ? (conc.unidades.ok ? `DUA ${duaUnidades} = factura ${conc.unidades.factura} unidades.` : `DUA ${duaUnidades} vs factura ${conc.unidades.factura}: revisar.`)
    : `Factura: ${conc.unidades.factura} unidades.`;
  const notaPacking = pk != null
    ? (parseIncompleto
        ? `Packing list: ${pk} unidades en ${pkBultos ?? '—'} bulto(s) parseado(s)${pkBultosDecl != null ? ` de ${pkBultosDecl} declarado(s)` : ''}; NO coincide con ${refUnidades} (parseo incompleto — bultos con formato degradado en el PDF). La cantidad oficial es la del DUA/factura; el packing no capitaliza costo.`
        : `Packing list: ${pk} unidades en ${pkBultos ?? '—'} bulto(s), consistente con ${refUnidades}.`)
    : 'Sin packing list parseado (las cantidades oficiales son las del DUA/factura).';
  conc.unidades.nota = `${notaDuaFac} ${notaPacking}`;

  // ── Conciliación: liquidación preliminar del despachante vs tributos del DUA ──
  // La hoja "Gastos del Embarque" (preliminar) estima los tributos antes de la
  // liquidación aduanera. La diferencia contra el DUA (p. ej. la Tasa Escáner y los
  // redondeos entre el % estimado y el importe liquidado) se EXPLICA, no se elimina.
  if (liquidacionPreliminar && (liquidacionPreliminar.total != null || liquidacionPreliminar.conceptos.length)) {
    // Conceptos de la liquidación preliminar que son TRIBUTOS del DUA (el resto —
    // honorarios, gastos operativos, IVA de gastos, TCU exento — no se compara contra
    // los tributos aduaneros). Las claves siguen el parser de la liquidación.
    const CLAVES_TRIBUTO = new Set(['imaduni', 'recargo', 'tasaConsular', 'tsa', 'extraordinario', 'ivaImportacion', 'ivaAnticipado', 'guiaTransito', 'timbre', 'vuce', 'escaner']);
    const sumaConceptos = liquidacionPreliminar.conceptos.reduce((s, c) => s + c.monto, 0n);
    const sumaTributos = liquidacionPreliminar.conceptos.filter((c) => CLAVES_TRIBUTO.has(c.clave)).reduce((s, c) => s + c.monto, 0n);
    const totalLiq = liquidacionPreliminar.total;
    const difTotalConceptos = totalLiq != null ? totalLiq - sumaConceptos : 0n;
    const difVsDua = sumaTributos - totalTributos; // tributos preliminares − liquidados del DUA
    const absDua = difVsDua < 0n ? -difVsDua : difVsDua;
    // Tasa Escáner del DUA (código 36 → TASA_SERVICIOS) a modo de referencia explícita.
    const escaner = (dua?.tributos ?? []).filter((t) => t.codigo === '36').reduce((s, t) => s + P(t.monto), 0n);
    const escanerLiq = liquidacionPreliminar.conceptos.find((c) => c.clave === 'escaner')?.monto ?? 0n;
    const fmt = (v: bigint) => `$ ${(Number(v < 0n ? -v : v) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2 })}`;
    const notas: string[] = [];
    if (sumaTributos > 0n) notas.push(`Tributos de la liquidación preliminar ${fmt(sumaTributos)} vs tributos liquidados del DUA ${fmt(totalTributos)}.`);
    if (escaner > 0n) notas.push(`La Tasa Escáner ${fmt(escaner)} integra ambos (${escanerLiq > 0n ? 'presente en la preliminar' : 'ausente en la preliminar'}); las fichas de costeo preliminares que la omiten difieren justamente en ese importe.`);
    if (absDua > 0n) notas.push(`Diferencia ${fmt(absDua)} entre el estimado y el liquidado: se MANTIENE el importe liquidado del DUA; no se elimina ni se fuerza la conciliación.`);
    else notas.push('Coincide con los tributos liquidados del DUA.');
    if (difTotalConceptos !== 0n) notas.push(`El total declarado de la liquidación difiere de la suma de sus conceptos en ${fmt(difTotalConceptos)} (revisar lectura del documento).`);
    conc.liquidacionPreliminar = {
      total: totalLiq, sumaConceptos, difTotalConceptos,
      sumaTributos, tributosDua: totalTributos, difVsDua,
      detalle: liquidacionPreliminar.conceptos.map((c) => ({ concepto: c.clave, monto: c.monto })),
      nota: notas.join(' '),
    };
  }

  // ── Verificación automática de consistencia (PASO 6) ──
  // Todas las cifras salen de ESTE motor (única fuente): costo de inventario,
  // costos por artículo y asientos. Se comprueban las tres igualdades SUMANDO los
  // asientos realmente generados (no se asume: se verifica).
  const CLAVE_MERC = 'mercaderiasImportadas';
  const movimientosMercaderia = asientos.reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === CLAVE_MERC).reduce((ss, l) => ss + l.debe - l.haber, 0n), 0n);
  const sumaCostoArticulos = (items ?? []).reduce((s, i) => s + i.costo, 0n);
  const recAsiento = asientos.find((a) => /Reconocimiento/.test(a.glosa));
  const adquisicionAsiento = recAsiento ? recAsiento.lineas.filter((l) => l.cuenta === CLAVE_MERC).reduce((s, l) => s + l.debe - l.haber, 0n) : 0n;
  const ci = costoInventario ?? 0n;
  const difArticulos = ci - sumaCostoArticulos;
  const difAsientos = ci - movimientosMercaderia;
  const difAdquisicion = adquisicionUYU - adquisicionAsiento;
  const consistencia = {
    costoInventario, sumaCostoArticulos, movimientosMercaderia, adquisicionContable: adquisicionUYU,
    adquisicionAsiento, difArticulos, difAsientos, difAdquisicion,
    ok: costoInventario != null && difArticulos === 0n && difAsientos === 0n && difAdquisicion === 0n,
  };
  if (costoInventario != null && !consistencia.ok) {
    motivos.push(`Inconsistencia interna: costo de inventario $${(Number(ci) / 100).toLocaleString('es-UY')} vs artículos (dif ${Number(difArticulos) / 100}) / asientos (dif ${Number(difAsientos) / 100}) / adquisición (dif ${Number(difAdquisicion) / 100}).`);
  }

  return {
    estado: (costoInventario != null && !consistencia.ok) ? 'PROVISIONAL' : estado,
    motivos: [...new Set(motivos)],
    anticipos: anticiposCalc, adquisicionUYU, anticiposPagadosUYU, excesoPagado, saldoNoAnticipado, comisionesBancariasUYU,
    tributos, totalTributos, tributosNoRecuperables, ivaImportacion, anticiposFiscales,
    gastos, totalGastosUYU, ivaGastosUYU, creditoFiscalIva,
    costoInventario, items, cuentaDespachante, asientos, consistencia, conciliacion: conc,
  };
}
