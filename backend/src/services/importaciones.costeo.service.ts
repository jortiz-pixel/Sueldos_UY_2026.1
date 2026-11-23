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
  // clasificacion: MERCADERIA (inventario) o BIEN_DE_USO (activo fijo). Default
  // MERCADERIA. Rige el ruteo del costo del artículo (Mercaderías vs Bienes de Uso).
  articulos: Array<{ descripcion: string; codigo: string | null; cantidad: number; total: bigint; clasificacion?: string }>;
}
export interface ServicioCosteo {
  rutComprador: string | null; rutEmisor?: string | null; moneda: string | null; serie: string | null; numero: string | null; emisor: string | null;
  honorarios: number | null; gastosOperativos: number | null; iva: number | null; total: number | null;
  noFacturable?: number | null; concepto?: string | null;
  // Moneda del CFE marcada como AMBIGUA/contradictoria por el parser: el costeo se
  // bloquea (no se convierte a ciegas) hasta verificar la moneda del comprobante.
  monedaAmbigua?: boolean; monedaMotivo?: string | null;
  // Tributos del DUA / pagos a cuenta re-facturados por el despachante (IVA
  // importación, anticipo IVA, tasas): NO se capitalizan ni crean un segundo crédito;
  // ya están en el DUA. Se descuentan del importe capitalizable de la factura.
  tributosPorCuenta?: number | null;
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
export interface ItemCosteo { descripcion: string; ncm: string | null; cantidad: number; fobTotal: bigint; costo: bigint; clasificacion: string }

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
  costoMercaderia: bigint | null; // parte inventario (null si PENDIENTE)
  costoBienesDeUso: bigint | null; // parte activo fijo (null si PENDIENTE)
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
      items.push({ descripcion: a.descripcion, ncm: null, cantidad: a.cantidad, fobTotal: fobTotalP, costo, clasificacion: a.clasificacion === 'BIEN_DE_USO' ? 'BIEN_DE_USO' : 'MERCADERIA' });
    }
  }
  const costoBienesDeUsoDoc = (items ?? []).filter((it) => it.clasificacion === 'BIEN_DE_USO').reduce((s, it) => s + it.costo, 0n);
  const costoMercaderiaDoc = costoInventario != null ? costoInventario - costoBienesDeUsoDoc : null;

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
    costoInventario, costoMercaderia: costoMercaderiaDoc, costoBienesDeUso: costoBienesDeUsoDoc,
    items,
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
  // Parte del costo que es bien de uso (activo fijo). Se reclasifica de Mercaderías
  // a Bienes de Uso. Default 0 (todo inventario).
  costoBienesDeUso?: bigint | null;
}

/** Arma el AsientoInput desde una importación persistida (sus tributos/gastos). */
export function asientoInputDesdeImportacion(imp: {
  costeoEstado?: string | null; fob: bigint; flete: bigint; seguro: bigint; anticipos: bigint; totalTributos: bigint; totalGastos: bigint;
  tributos: { tipo: TributoImportacionTipo; monto: bigint; recuperable: boolean }[];
  gastos: { ivaGasto: bigint }[];
  items?: { clasificacion?: string; costoProrrateado: bigint }[];
}): AsientoInput {
  const ivaImportacion = imp.tributos.filter((t) => t.tipo === TributoImportacionTipo.IVA_IMPORTACION).reduce((s, t) => s + t.monto, 0n);
  const tributosNoRecuperables = imp.tributos.filter((t) => !t.recuperable).reduce((s, t) => s + t.monto, 0n);
  const ivaGastos = imp.gastos.reduce((s, g) => s + g.ivaGasto, 0n);
  const costoBienesDeUso = (imp.items ?? []).filter((i) => i.clasificacion === 'BIEN_DE_USO').reduce((s, i) => s + i.costoProrrateado, 0n);
  return {
    estado: imp.costeoEstado === 'PENDIENTE' ? 'PENDIENTE' : 'OK',
    adquisicionPesos: imp.fob, fletePesos: imp.flete, seguroPesos: imp.seguro,
    anticipos: imp.anticipos, totalTributos: imp.totalTributos, ivaImportacion, tributosNoRecuperables,
    totalGastos: imp.totalGastos, ivaGastos, costoBienesDeUso,
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

  // 2) Tributos del DUA (IVA importación como crédito; no recuperables al costo,
  // que se acumula en Importaciones en trámite hasta el alta en stock).
  if (r.totalTributos - r.anticipos > 0n) {
    mk(fechas.dua, 'Tributos del DUA (IVA importación y tributos no recuperables)', [
      { cuenta: etiqueta('ivaComprasImportacion'), debe: r.ivaImportacion, haber: 0n },
      { cuenta: etiqueta('mercaderiaTransito'), debe: r.tributosNoRecuperables, haber: 0n },
      { cuenta: etiqueta('bancoPesos'), debe: 0n, haber: r.ivaImportacion + r.tributosNoRecuperables },
    ], r.estado === 'OK');
  }

  // 3) Reconocimiento de la compra (a Importaciones en trámite) — DEFINITIVO si OK.
  if (r.estado === 'OK' && r.adquisicionPesos > 0n) {
    mk(fechas.factura, 'Reconocimiento de la compra (importaciones en trámite al CIF contable)', [
      { cuenta: etiqueta('mercaderiaTransito'), debe: r.adquisicionPesos + r.fletePesos + r.seguroPesos, haber: 0n },
      { cuenta: etiqueta('proveedoresExterior'), debe: 0n, haber: r.adquisicionPesos },
      { cuenta: etiqueta('proveedoresLocales'), debe: 0n, haber: r.fletePesos + r.seguroPesos },
    ], true);
  }

  // 4) Gastos del despachante / plaza (al costo en trámite + su IVA crédito).
  if (r.totalGastos > 0n || r.ivaGastos > 0n) {
    mk(fechas.pagoDespachante ?? fechas.dua, 'Gastos de la operación facturados por el despachante y la plaza', [
      { cuenta: etiqueta('mercaderiaTransito'), debe: r.totalGastos, haber: 0n },
      { cuenta: etiqueta('ivaComprasPlaza'), debe: r.ivaGastos, haber: 0n },
      { cuenta: etiqueta('despachantes'), debe: 0n, haber: r.totalGastos + r.ivaGastos },
    ], r.estado === 'OK');
  }

  // 4b) ALTA EN STOCK (nacionalización): pasa el costo acumulado en Importaciones
  // en trámite a Mercaderías (inventario) y Bienes de Uso (activo fijo). Deja la
  // cuenta de tránsito saldada. Mismo prorrateo por FOB.
  if (r.estado === 'OK') {
    const costoInv = r.adquisicionPesos + r.fletePesos + r.seguroPesos + r.tributosNoRecuperables + r.totalGastos;
    const bduAlta = r.costoBienesDeUso ?? 0n;
    const mercAlta = costoInv - bduAlta;
    if (costoInv > 0n) {
      mk(fechas.dua, 'Alta en stock — pase de Importaciones en trámite a inventario / bienes de uso', [
        { cuenta: etiqueta('mercaderiasImportadas'), debe: mercAlta, haber: 0n },
        { cuenta: etiqueta('bienesDeUso'), debe: bduAlta, haber: 0n },
        { cuenta: etiqueta('mercaderiaTransito'), debe: 0n, haber: costoInv },
      ], true);
    }
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
  // Costo capitalizado como MERCADERÍA (inventario) y como BIEN DE USO (activo
  // fijo), según la clasificación de cada artículo. Suman costoInventario.
  costoMercaderia: bigint | null;
  costoBienesDeUso: bigint | null;
  // ── §3 NIC 21/2 — diferencia de cambio separada del costo ──
  // Reconocimiento de la adquisición: a la fecha/cotización de transferencia de control
  // (BL a bordo) si se informó; si no, por el TC de los pagos (criterio anticipos).
  // diferenciaCambioUYU = resultado financiero por pagos a un TC distinto al de
  // reconocimiento (no integra el costo). costoAlPagoProvisional = true cuando falta la
  // cotización del día de control y el costo quedó valuado al TC de pago (a confirmar).
  reconocimiento: {
    base: 'CONTROL' | 'PAGO';
    origen: string;                       // de dónde sale la fecha (BL / factura comercial / …)
    fecha: string | null; cotizacion: number | null;
    adquisicionReconocidaUYU: bigint;     // costo al TC de reconocimiento
    diferenciaCambioUYU: bigint;          // + ganancia / − pérdida de cambio (resultado)
    costoAlPagoProvisional: boolean;      // true si falta la cotización del control
    nota: string;
  };
  // ── §7 — venta de exportación / CMV (tránsito) ──
  // Cuando se imputa el costo a CMV contra la venta de exportación: la cuenta de
  // tránsito queda saldada (no permanece en «Importaciones en trámite»). null si no
  // hay venta cargada o la carpeta no es de tránsito.
  ventaExportacion: {
    montoME: number; moneda: string; fecha: string | null; tc: number | null;
    ventaUYU: bigint; cmvUYU: bigint; resultadoBrutoUYU: bigint; nota: string;
  } | null;
  // true si ya se emitió el alta en stock (nacionalizada/cerrada); false si el
  // costo sigue acumulado en Importaciones en trámite (borrador / en trámite).
  altaEnStock: boolean;
  // true si la carpeta es de TRÁNSITO/depósito (régimen suspensivo): la mercadería
  // NO se nacionaliza, los tributos de importación quedan SUSPENDIDOS (no integran
  // el costo ni dan crédito fiscal) y NO se da alta en stock — el costo (CIF +
  // gastos) queda acumulado en Importaciones en trámite. false = Nacionalización
  // (importación definitiva): criterio completo (tributos al costo, IVA crédito, alta).
  esTransito: boolean;
  // Aviso de incoherencia entre el RÉGIMEN elegido y lo que muestra el DUA: si está
  // marcada como Nacionalización pero el DUA no liquida impuestos de nacionalización
  // (IVA importación / anticipos) parece tránsito; o a la inversa. null = sin aviso.
  avisoRegimen: string | null;
  // Por artículo: desglose del costo prorrateado por componente (Adquisición CIF +
  // Tributos no recuperables + Gastos de plaza = costo), todos por participación en FOB.
  items: Array<{ codigo: string | null; descripcion: string; cantidad: number; fobME: bigint; adquisicion: bigint; tributos: bigint; gastos: bigint; costo: bigint; clasificacion: string }> | null;
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
    movimientosMercaderia: bigint;       // Σ (debe − haber) en Mercaderías + Bienes de Uso (stock final)
    movimientosTransito: bigint;         // Σ (debe − haber) en Importaciones en trámite (debe quedar 0)
    movimientosCMV: bigint;              // Σ (debe − haber) en Costo de Mercadería Vendida (cost final por venta)
    adquisicionContable: bigint;         // adquisición usada para el costeo
    adquisicionAsiento: bigint;          // adquisición usada en el asiento de incorporación
    difArticulos: bigint; difAsientos: bigint; difAdquisicion: bigint; difTransito: bigint; ok: boolean;
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
  pagoDespachanteCtms: bigint | null;       // importe del recibo YA EN PESOS (convertido si el recibo es en ME)
  fechaPagoDespachante?: string | null;    // fecha del recibo del despachante
  pagoDespachanteConfirmado?: boolean;      // true solo con comprobante de egreso bancario (si no, sujeto a confirmación)
  // Moneda ORIGINAL del recibo y su valor en esa moneda (para el asiento: moneda
  // original + importe convertido). Si el recibo es en pesos, moneda 'UYU' y tc 1.
  pagoDespachanteMonedaOrig?: string | null;
  pagoDespachanteMontoOrig?: number | null; // importe en la moneda original del recibo
  pagoDespachanteTc?: number | null;        // TC contable aplicado (1 si ya está en pesos)
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
  // Estado de la importación. El ALTA EN STOCK (pase de Importaciones en trámite a
  // Mercaderías / Bienes de uso) se emite SOLO cuando está NACIONALIZADA o CERRADA;
  // en BORRADOR / EN_TRAMITE el costo queda acumulado en tránsito (sin alta). Si no
  // se informa (undefined), se emite igual (compatibilidad / cálculo puro).
  estadoImportacion?: string | null;
  // Régimen de la carpeta: true = TRÁNSITO / depósito / admisión temporaria / zona
  // franca (régimen suspensivo); false o undefined = Nacionalización (importación
  // DEFINITIVA). En tránsito los tributos de importación quedan SUSPENDIDOS (no
  // integran costo ni crédito fiscal) y NO se da alta en stock: el costo (CIF +
  // gastos atribuibles) queda en Importaciones en trámite hasta que se nacionalice.
  esTransito?: boolean;
  // IVA de los servicios de plaza (despachante/agencia): true o undefined = CRÉDITO
  // recuperable (criterio correcto cuando la venta es exportación — art. 14 Tít. 10).
  // false = NO recuperable (operación no comprendida/exenta sin derecho a crédito) →
  // se capitaliza al costo. No debe asumirse irrecuperable automáticamente en tránsito.
  ivaServiciosRecuperable?: boolean;
  // ── §3 NIC 21/2 — reconocimiento al control (transferencia de control) ──
  // Fecha y cotización de la TRANSFERENCIA DE CONTROL (en una importación marítima:
  // fecha "a bordo" del BL). Es el momento en que se reconoce la adquisición. Si se
  // informa la cotización, la mercadería se valúa a ESE TC y la diferencia contra el
  // TC de los pagos (cuando el pago es POSTERIOR al reconocimiento) se reconoce como
  // DIFERENCIA DE CAMBIO (resultado financiero), NO se capitaliza al costo. Sin la
  // cotización, se mantiene el criterio por TC de pago (anticipos no monetarios) y se
  // marca que falta la cotización del día de control para separar la dif. de cambio.
  fechaControlTransferencia?: string | null;
  cotizacionControlTransferencia?: number | null;
  // Texto que describe DE DÓNDE sale la fecha de reconocimiento (p. ej. "fecha de
  // embarque (a bordo del BL)" o "fecha de la factura comercial (proxy…)"). Solo
  // afecta la redacción del asiento y la nota; si falta se usa "transferencia de control".
  origenReconocimiento?: string | null;
  // ── §7 — venta de exportación (re-exportación en tránsito) ──
  // Cuando la carpeta es de TRÁNSITO y la mercadería se re-exporta, el costo acumulado
  // en «Importaciones en trámite» se imputa a Costo de Mercadería Vendida contra la
  // venta de exportación (no queda eternamente en trámite). montoME en la moneda de la
  // venta; tc convierte a pesos (sin tc, se usa el de reconocimiento/provisional).
  ventaExportacion?: { montoME: number; moneda: string; fecha: string | null; tc: number | null } | null;
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
  const { dua, factura, servicios, anticipos, pagoSpeCtms, pagoDespachanteCtms, fechaPagoDespachante, pagoDespachanteConfirmado, pagoAgencia, fechaReconocimiento, cotizacionReconocimiento, tcProvisional, unidadesPacking, packingBultos, packingBultosDeclarados, liquidacionPreliminar, estadoImportacion, etiqueta } = input;
  // RÉGIMEN: nacionalización (definitiva) vs tránsito/depósito (suspensivo). En
  // tránsito los tributos de importación están SUSPENDIDOS → no integran el costo ni
  // dan crédito fiscal; y NUNCA se da alta en stock (la mercadería queda en tránsito).
  const esTransito = !!input.esTransito;
  // IVA de servicios de plaza: por defecto RECUPERABLE (venta exportación → crédito,
  // no costo). Solo se capitaliza si se marca explícitamente no recuperable.
  const ivaServiciosRecuperable = input.ivaServiciosRecuperable !== false;
  const capitalizarIvaServicios = esTransito && !ivaServiciosRecuperable;
  // El alta en stock se emite solo al nacionalizar (o cerrar), y JAMÁS en tránsito.
  // En trámite/borrador el costo queda acumulado en Importaciones en trámite. Sin
  // estado y en régimen definitivo → se emite (compatibilidad / cálculo puro).
  const altaEnStock = !esTransito && (estadoImportacion == null || ['NACIONALIZADA', 'CERRADA'].includes(estadoImportacion));
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
  // adquisición VALUADA POR LOS PAGOS (TC de cada anticipo + saldo a TC de reconoc.).
  const adquisicionPagoUYU = mercaderiaAnticiposUYU + (saldoNoAnticipado?.uyu ?? 0n);

  // ── §3 NIC 21/2 — reconocimiento al CONTROL (BL a bordo) + diferencia de cambio ──
  // Si se informa la cotización del día de transferencia de control, la mercadería se
  // valúa a ESE TC (costo) y la diferencia contra lo pagado (TC de pago) se reconoce
  // como DIFERENCIA DE CAMBIO (resultado), que NO integra el costo. Sin esa cotización
  // se mantiene el criterio por TC de pago y se marca que falta para separar la dif.
  const fechaControlTransferencia = input.fechaControlTransferencia ?? null;
  const origenReconocimiento = (input.origenReconocimiento && input.origenReconocimiento.trim()) || 'transferencia de control';
  const controlCot = validarTipoCambio(input.cotizacionControlTransferencia);
  const hayFechaControl = !!fechaControlTransferencia;
  let adquisicionUYU: bigint;          // costo de la mercadería que SE CAPITALIZA
  let diferenciaCambioUYU = 0n;        // + pérdida (debe) / − ganancia (haber) de cambio
  let reconocimientoBase: 'CONTROL' | 'PAGO';
  let costoAlPagoProvisional = false;
  if (controlCot.valido && cifME > 0) {
    adquisicionUYU = cents(cifME, controlCot.valor!);       // CIF × TC control = costo
    diferenciaCambioUYU = adquisicionPagoUYU - adquisicionUYU; // lo pagado − el costo
    reconocimientoBase = 'CONTROL';
  } else {
    adquisicionUYU = adquisicionPagoUYU;                    // criterio por TC de pago
    reconocimientoBase = 'PAGO';
    // Flag sólo cuando nos dieron la FECHA de control pero no su cotización: ahí sí
    // falta el dato para separar la diferencia de cambio (no es ruido general).
    costoAlPagoProvisional = hayFechaControl && !controlCot.valido;
    if (costoAlPagoProvisional) { provisionalCosto = true; motivos.push(`Falta la cotización del día de transferencia de control (${input.fechaControlTransferencia}) para separar la diferencia de cambio (NIC 21): el costo quedó valuado al TC de pago (provisional).`); }
  }

  // ── Gastos de plaza (desglosados, con dedup por cuenta de terceros) ──
  const importadorRut = dua?.importadorRut ?? null;
  const rutDespachante = dua?.declaranteRut ?? null;
  const gastos: GastoDesglosado[] = [];
  // Cada gasto de la iteración se marca provisional si su cotización en ME no es
  // definitiva (sin respaldo BCU/manual, p. ej. quedó con el TC del DUA).
  let gastoProvisional = false;
  const pushG = (g: GastoDesglosado) => gastos.push({ ...g, provisional: g.provisional ?? gastoProvisional });
  for (const s of servicios) {
    // Moneda AMBIGUA/contradictoria (p. ej. un CFE que menciona dólares de referencia
    // y pesos sin un campo claro): NO se convierte a ciegas → se bloquea el costeo y
    // se pide verificar la moneda del comprobante (regla de identificación de moneda).
    if (s.monedaAmbigua) {
      provisionalCosto = true;
      motivos.push(`Moneda ambigua en el comprobante ${s.emisor ?? ''} ${s.serie ?? ''}${s.numero ?? ''}: ${s.monedaMotivo ?? 'no se pudo determinar con certeza la moneda'}. El costeo queda BLOQUEADO hasta confirmar la moneda (no se convierte a pesos un importe de moneda no confirmada).`);
    }
    // Solo se convierte con TC un importe efectivamente en MONEDA EXTRANJERA y con la
    // moneda CONFIRMADA. Un importe en pesos (o de moneda ambigua) nunca se multiplica
    // por el TC: se mantiene en pesos (bug DUA 001-2025-230183: UYU tratado como USD).
    const esUsd = (s.moneda ?? '').toUpperCase() === 'USD' && !s.monedaAmbigua;
    const cotOk = validarTipoCambio(s.cotizacion).valido;
    const respaldada = !esUsd || cotizacionRespaldada(s.fuenteCotizacion);
    const tcS = esUsd ? (validarTipoCambio(s.cotizacion).valor ?? validarTipoCambio(tcProvisional).valor) : 1;
    gastoProvisional = s.monedaAmbigua || (esUsd && (!cotOk || !respaldada));
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
    // TRIBUTOS del DUA / pagos a cuenta que el despachante re-factura (IVA importación,
    // anticipo IVA, tasas): NO se capitalizan ni crean un segundo crédito —ya están en
    // el DUA— y se descuentan del importe facturado. "NO FACTURABLE" (si viene) y la
    // suma de líneas de tributos describen lo mismo: se toma el mayor para no partir el
    // importe, sin sumarlos dos veces.
    const noFac = Number(s.noFacturable) || 0;
    const tribFactura = Number(s.tributosPorCuenta) || 0;
    const pagosPorCuenta = Math.max(noFac, tribFactura);
    const pushPagosPorCuenta = () => {
      if (pagosPorCuenta <= 0) return;
      pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: 'Pagos por cuenta del importador (tributos / tasas oficiales)', moneda: s.moneda ?? 'UYU', montoME: pagosPorCuenta, cotizacion: 1, montoUYU: 0n, ivaUYU: 0n, gravado: false, porCuentaDeTerceros: false, incluidoEnCosto: false, tratamiento: 'Tributos del DUA (IVA importación, anticipo IVA, tasas) pagados por cuenta y re-facturados: NO integran el costo ni dan un segundo crédito; ya están reconocidos en el DUA. Integran solo la cuenta del despachante.' });
    };
    if (hon || gop) {
      if (hon) pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: 'Honorarios del despachante', moneda: s.moneda ?? 'UYU', montoME: hon, cotizacion: tcS ?? 1, montoUYU: cents(hon, tcS ?? 1), ivaUYU: cents(Math.round(hon * 0.22 * 100) / 100, tcS ?? 1), gravado: true, porCuentaDeTerceros: false, incluidoEnCosto: true, tratamiento: 'Gasto directamente atribuible (gravado 22%, IVA crédito).' });
      if (gop) pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: 'Gastos operativos', moneda: s.moneda ?? 'UYU', montoME: gop, cotizacion: tcS ?? 1, montoUYU: cents(gop, tcS ?? 1), ivaUYU: cents(Math.round(gop * 0.22 * 100) / 100, tcS ?? 1), gravado: true, porCuentaDeTerceros: false, incluidoEnCosto: true, tratamiento: 'Gasto directamente atribuible (gravado 22%, IVA crédito).' });
      pushPagosPorCuenta();
    } else if (pagosPorCuenta > 0) {
      // Factura que es (mayormente) TRIBUTOS re-facturados: no se capitaliza el tributo;
      // solo el remanente de SERVICIO del despachante (total − tributos − su IVA) es
      // gasto atribuible. Así $422.531 de tributos no entran al costo (DUA 001-2025-230183).
      pushPagosPorCuenta();
      const total = Number(s.total) || 0;
      const ivaFactura = Number(s.iva) || 0;
      const servicioResidual = Math.round((total - pagosPorCuenta - ivaFactura) * 100) / 100;
      if (servicioResidual > 0.009) {
        pushG({ documento: doc, emisor: s.emisor, rutEmisor: s.rutEmisor ?? null, fecha: s.fecha ?? null, fuenteCotizacion: s.fuenteCotizacion ?? null, esDelDespachante: rutDespachante ? (s.rutEmisor === rutDespachante) : false, concepto: 'Servicio del despachante', moneda: s.moneda ?? 'UYU', montoME: servicioResidual, cotizacion: tcS ?? 1, montoUYU: cents(servicioResidual, tcS ?? 1), ivaUYU: cents(ivaFactura, tcS ?? 1), gravado: ivaFactura > 0, porCuentaDeTerceros: false, incluidoEnCosto: true, tratamiento: 'Remanente de servicio del despachante (total de la factura menos los tributos del DUA re-facturados y su IVA): gasto atribuible al costo.' });
      }
    } else {
      const total = Number(s.total) || 0;
      if (total > 0) {
        const concStr = `${s.concepto ?? ''} ${doc}`;
        // Comprobante que es SOLO IVA de plaza (p. ej. "IVA sobre flete", emitido aparte
        // por la agencia de carga): es CRÉDITO FISCAL, no integra el costo, pero SÍ
        // integra la cuenta de la agencia (así el pasivo iguala al recibo).
        const esIvaPlaza = /^\s*i\.?\s*v\.?\s*a\.?\b/i.test(String(s.concepto ?? '').trim())
          || /sobre\s*flete|s\/\s*flete/i.test(concStr)
          || /\b(iva|lva)\b\s*(sobre|por|s\/|de)?\s*(flete|transporte|carga|embarque|plaza)/i.test(concStr);
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
  // RÉGIMEN y ACTIVIDAD mandan el tratamiento del IVA:
  // • NACIONALIZACIÓN: tributos no recuperables al costo; IVA importación + IVA de
  //   gastos de plaza = CRÉDITO fiscal (no integran el costo).
  // • TRÁNSITO: los tributos de importación quedan SUSPENDIDOS (no integran costo ni
  //   crédito). El IVA de los servicios de plaza (despachante/agencia) es CRÉDITO
  //   RECUPERABLE cuando la venta es EXPORTACIÓN (art. 14 Tít. 10) — NO se capitaliza
  //   automáticamente. Solo se capitaliza si la operación es NO comprendida/exenta sin
  //   derecho a crédito (ivaServiciosRecuperable=false).
  const tributosNoRecuperablesCosto = esTransito ? 0n : tributosNoRecuperables;
  const ivaImportacionCredito = esTransito ? 0n : ivaImportacion;
  // IVA de gastos de plaza que se capitaliza al costo (solo si NO es recuperable).
  const ivaGastosAlCosto = capitalizarIvaServicios ? ivaGastosUYU : 0n;
  // Gastos que integran el costo (netos + IVA capitalizado solo si no recuperable).
  const gastosCostoUYU = totalGastosUYU + ivaGastosAlCosto;
  // Crédito fiscal: IVA importación (0 en tránsito) + IVA de gastos de plaza, salvo que
  // ese IVA se haya capitalizado (operación no comprendida) → entonces no es crédito.
  const creditoFiscalIva = ivaImportacionCredito + (capitalizarIvaServicios ? 0n : ivaGastosUYU);

  // ── Costo de inventario y distribución por artículo ──
  if (!factura) motivos.push('Falta la factura comercial del proveedor.');
  if (!dua) motivos.push('Falta el DUA oficial.');
  if (!anticipos.length && !saldoNoAnticipado) motivos.push('No hay pagos al proveedor para valuar la adquisición.');

  const estado: 'OK' | 'PROVISIONAL' = (provisionalCosto || !factura || !dua || adquisicionUYU === 0n) ? 'PROVISIONAL' : 'OK';

  let costoInventario: bigint | null = null;
  let items: CosteoHistorico['items'] = null;
  if (adquisicionUYU > 0n && factura) {
    costoInventario = costoMercaderiaImportada(adquisicionUYU, tributosNoRecuperablesCosto, gastosCostoUYU);
    const arts = factura.articulos;
    const sumaFob = arts.reduce((s, a) => s + a.total, 0n);
    items = [];
    // Prorrateo POR COMPONENTE (participación en el FOB): cada artículo recibe su
    // parte de la Adquisición (CIF), de los Tributos no recuperables y de los
    // Gastos de plaza. El costo del artículo = la suma de esos tres. El último
    // artículo absorbe el redondeo de CADA componente, así cada columna cuadra
    // exacto con su total y la suma de costos cierra con el costo de inventario.
    let acAdq = 0n, acTrib = 0n, acGas = 0n;
    const ultimo = arts.length - 1;
    for (let i = 0; i < arts.length; i++) {
      const a = arts[i];
      let adquisicion: bigint, tributos: bigint, gastos: bigint;
      if (sumaFob > 0n && i < ultimo) {
        adquisicion = (adquisicionUYU * a.total) / sumaFob; acAdq += adquisicion;
        tributos = (tributosNoRecuperablesCosto * a.total) / sumaFob; acTrib += tributos;
        gastos = (gastosCostoUYU * a.total) / sumaFob; acGas += gastos;
      } else {
        adquisicion = adquisicionUYU - acAdq;
        tributos = tributosNoRecuperablesCosto - acTrib;
        gastos = gastosCostoUYU - acGas;
      }
      const costo = adquisicion + tributos + gastos;
      items.push({ codigo: a.codigo ?? null, descripcion: a.descripcion, cantidad: a.cantidad, fobME: a.total, adquisicion, tributos, gastos, costo, clasificacion: a.clasificacion === 'BIEN_DE_USO' ? 'BIEN_DE_USO' : 'MERCADERIA' });
    }
  }

  // Reparto del costo entre inventario (MERCADERÍA) y activo fijo (BIEN_DE_USO)
  // según la clasificación de cada artículo. Mismo costo total; solo cambia la
  // cuenta de destino. Con todo mercadería, costoBienesDeUso = 0 (sin cambios).
  const costoBienesDeUso = (items ?? []).filter((i) => i.clasificacion === 'BIEN_DE_USO').reduce((s, i) => s + i.costo, 0n);
  const costoMercaderiaCap = costoInventario != null ? costoInventario - costoBienesDeUso : null;

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
  // Reconocimiento de la compra: el costo se acumula en IMPORTACIONES EN TRÁMITE
  // (mercadería en tránsito), no directo a stock. Al nacionalizar se pasa a Stock
  // (ver asiento "Alta en stock"). Aplica los anticipos; sin dividir el proveedor.
  if (costoInventario != null) {
    const lineasRec: LineaAsientoHist[] = [
      { cuenta: et('mercaderiaTransito'), debe: adquisicionUYU, haber: 0n },
      { cuenta: et('anticiposProveedores'), debe: 0n, haber: mercaderiaAnticiposUYU },
    ];
    if (saldoNoAnticipado) lineasRec.push({ cuenta: et('proveedoresExterior'), monedaOrig: factura?.moneda, montoOrig: saldoNoAnticipado.me, debe: 0n, haber: saldoNoAnticipado.uyu });
    // §3 NIC 21: si la mercadería se reconoce al TC de control (BL a bordo) y los pagos
    // fueron a otro TC, la diferencia es RESULTADO FINANCIERO (no costo): balancea el
    // asiento por Diferencias de cambio (debe = pérdida; haber = ganancia).
    if (diferenciaCambioUYU !== 0n) {
      lineasRec.push(diferenciaCambioUYU > 0n
        ? { cuenta: et('diferenciasCambio'), debe: diferenciaCambioUYU, haber: 0n }
        : { cuenta: et('diferenciasCambio'), debe: 0n, haber: -diferenciaCambioUYU });
    }
    mk(fechaControlTransferencia ?? fechaReconocimiento, 'Reconocimiento de la compra (importaciones en trámite / mercadería en tránsito)', lineasRec,
      [{ documento: `Factura comercial`, regla: reconocimientoBase === 'CONTROL'
        ? `Adquisición reconocida a la ${origenReconocimiento}${fechaControlTransferencia ? ` ${fechaControlTransferencia}` : ''}, valuada al TC de ese día (NIC 21/2). La diferencia contra el TC de los pagos es diferencia de cambio (resultado), no integra el costo. El exceso pagado no se capitaliza; el saldo no anticipado al TC de reconocimiento.`
        : 'Adquisición al CIF de la factura valuado por los anticipos (TC de cada pago); se acumula en Importaciones en trámite. El exceso pagado NO se capitaliza (crédito con el proveedor); el saldo no anticipado al TC de reconocimiento. No se divide el importe del proveedor del exterior.' }], estado === 'OK');
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

  // Tributos del DUA: contrapartida según quién los pagó (sin doble banco). En
  // TRÁNSITO los tributos de importación están SUSPENDIDOS (no se liquidan hasta la
  // eventual nacionalización): no se asientan ni integran costo/crédito.
  if (totalTributos > 0n && !esTransito) {
    mk(fechaReconocimiento, 'Tributos aduaneros y anticipos fiscales del DUA', [
      { cuenta: et('ivaComprasImportacion'), debe: ivaImportacion, haber: 0n },
      { cuenta: et('mercaderiaTransito'), debe: tributosNoRecuperables, haber: 0n },
      { cuenta: et('anticipoIvaImportacion'), debe: anticiposFiscales, haber: 0n },
      { cuenta: et(tributosPorDespachante ? 'despachantes' : 'bancoPesos'), debe: 0n, haber: totalTributos },
    ], [{ documento: `DUA ${dua?.nroDua ?? ''}`, pagina: 'pág. 1 (tributos)', regla: 'Tributos liquidados en el DUA; IVA importación = crédito fiscal; anticipo IVA = pago a cuenta (no integra costo); no recuperables al inventario.' }, { documento: 'Pago SPE/Sistarbanc (cód. autorización)', regla: tributosPorDespachante ? 'Los pagó el despachante por cuenta del importador (constan como "no facturable" en su e-factura y se reintegran en el recibo); contrapartida Despachantes, NO Banco (el único egreso bancario es el recibo).' : 'Pagados directamente por el importador por SPE; contrapartida Banco.' }], true);
  }
  // Gastos y honorarios del DESPACHANTE (cuenta corriente del despachante). El IVA es
  // CRÉDITO (va a IVA compras), salvo operación no comprendida → se capitaliza al costo.
  if (montoDesp > 0n || ivaDesp > 0n) {
    mk(fechaDesp, 'Gastos y honorarios del despachante de aduana', [
      { cuenta: et('mercaderiaTransito'), debe: montoDesp + (capitalizarIvaServicios ? ivaDesp : 0n), haber: 0n },
      { cuenta: et('ivaComprasPlaza'), debe: capitalizarIvaServicios ? 0n : ivaDesp, haber: 0n },
      { cuenta: et('despachantes'), debe: 0n, haber: montoDesp + ivaDesp },
    ], [{ documento: gDesp.map((g) => g.documento).filter((v, i, a) => a.indexOf(v) === i).join(', '), regla: capitalizarIvaServicios ? 'Gastos atribuibles a la mercadería (honorarios, operativos); operación NO comprendida → el IVA no se recupera y se capitaliza al costo.' : 'Gastos directamente atribuibles (honorarios, operativos); IVA de servicios = CRÉDITO fiscal (venta de exportación). El reembolso de terceros se cuenta una sola vez.' }], estado === 'OK');
  }
  // Gastos de la AGENCIA de carga / plaza (prestador distinto del despachante). El IVA
  // es crédito, salvo operación no comprendida → se capitaliza igual que el despachante.
  if (montoAg > 0n || ivaAg > 0n) {
    mk(fechaAg, 'Gastos de la agencia de carga / plaza', [
      { cuenta: et('mercaderiaTransito'), debe: montoAg + (capitalizarIvaServicios ? ivaAg : 0n), haber: 0n },
      { cuenta: et('ivaComprasPlaza'), debe: capitalizarIvaServicios ? 0n : ivaAg, haber: 0n },
      { cuenta: et('proveedoresLocales'), monedaOrig: gAgencia[0]?.moneda, montoOrig: gAgencia.reduce((s, g) => s + g.montoME, 0), debe: 0n, haber: montoAg + ivaAg },
    ], [{ documento: gAgencia.map((g) => g.documento).filter((v, i, a) => a.indexOf(v) === i).join(', '), regla: 'Servicio de un prestador distinto del despachante (agencia de carga); se paga por separado, no integra la cuenta del despachante.' }], estado === 'OK');
  }
  // Pago al despachante (recibo) — ÚNICO egreso bancario que cubre tributos + gastos.
  // SUJETO A CONFIRMACIÓN del pago bancario mientras solo se cuente con el recibo.
  if (pagoDespachanteCtms && pagoDespachanteCtms > 0n) {
    // Moneda ORIGINAL del recibo: si es en ME (p. ej. USD 7.900,88), el asiento en
    // pesos muestra la moneda original y el importe YA CONVERTIDO al TC contable
    // (pagoDespachanteCtms viene convertido). Si es en pesos, moneda UYU y TC 1.
    const recMonedaOrig = input.pagoDespachanteMonedaOrig ?? null;
    const recMontoOrig = input.pagoDespachanteMontoOrig ?? null;
    const recEsME = !!recMonedaOrig && recMonedaOrig.toUpperCase() !== 'UYU';
    const recTc = input.pagoDespachanteTc ?? null;
    const cuentaBanco = recEsME ? 'bancoMe' : 'bancoPesos';
    mk(fechaPagoDespachante ?? fechaReconocimiento, `Pago al despachante de aduana (recibo)${pagoDespachanteConfirmado ? '' : ' — sujeto a confirmación'}`, [
      { cuenta: et('despachantes'), monedaOrig: recEsME ? recMonedaOrig : undefined, montoOrig: recEsME ? (recMontoOrig ?? undefined) : undefined, debe: pagoDespachanteCtms, haber: 0n },
      { cuenta: et(cuentaBanco), monedaOrig: recEsME ? recMonedaOrig : undefined, montoOrig: recEsME ? (recMontoOrig ?? undefined) : undefined, debe: 0n, haber: pagoDespachanteCtms },
    ], [{ documento: 'Recibo del despachante (cobranza)', regla: `Cancela la cuenta del despachante (tributos reintegrados + gastos + honorarios).${recEsME ? ` Recibo en ${recMonedaOrig} ${(recMontoOrig ?? 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })} convertido a pesos al TC contable ${recTc ?? '—'}.` : ''} ${pagoDespachanteConfirmado ? 'Pago confirmado por comprobante bancario.' : 'SUJETO A CONFIRMACIÓN del egreso bancario (solo consta el recibo de cobranza).'}` }], !!pagoDespachanteConfirmado);
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
  // ALTA EN STOCK: se pasa el costo acumulado en Importaciones en trámite a las
  // cuentas de destino —Mercaderías (inventario) y Bienes de Uso (activo fijo),
  // según la clasificación de cada artículo—. Es el momento en que el producto
  // entra al stock con su costo ya prorrateado por artículo (FOB), y la cuenta de
  // tránsito queda saldada. SOLO se emite al NACIONALIZAR/CERRAR; en trámite el
  // costo queda en tránsito. Se fecha en la ÚLTIMA fecha de costo (reconocimiento,
  // gastos del despachante o de la agencia) para que el tránsito se cargue del todo
  // antes de vaciarse y no quede en negativo ningún día.
  const fechaAlta = [fechaReconocimiento, fechaDesp, fechaAg].filter((f): f is string => !!f).sort().slice(-1)[0] ?? fechaReconocimiento;
  if (altaEnStock && costoInventario != null && costoInventario > 0n) {
    mk(fechaAlta, 'Alta en stock — pase de Importaciones en trámite a inventario / bienes de uso', [
      { cuenta: et('mercaderiasImportadas'), debe: costoMercaderiaCap ?? 0n, haber: 0n },
      { cuenta: et('bienesDeUso'), debe: costoBienesDeUso, haber: 0n },
      { cuenta: et('mercaderiaTransito'), debe: 0n, haber: costoInventario },
    ], [{ documento: 'Nacionalización / clasificación de artículos', regla: 'Al nacionalizar, el costo acumulado en Importaciones en trámite se incorpora al stock: Mercaderías por los artículos de inventario y Bienes de Uso por los de activo fijo (mismo prorrateo por FOB). La cuenta de tránsito queda saldada.' }], estado === 'OK');
  }
  // ── §7 VENTA DE EXPORTACIÓN + CMV (tránsito / trading) ──
  // La mercadería del exterior se re-exporta: su costo NO se nacionaliza ni queda
  // eternamente en «Importaciones en trámite». Se reconoce la venta de exportación y
  // se imputa el costo acumulado a Costo de Mercadería Vendida, saldando el tránsito.
  let ventaExportacionOut: CosteoHistorico['ventaExportacion'] = null;
  const ve = input.ventaExportacion;
  if (esTransito && costoInventario != null && costoInventario > 0n && ve && ve.montoME > 0) {
    const tcVenta = validarTipoCambio(ve.tc).valor
      ?? (ve.moneda && ve.moneda.toUpperCase() !== 'UYU'
        ? (validarTipoCambio(cotizacionReconocimiento).valor ?? validarTipoCambio(tcProvisional).valor ?? null)
        : 1);
    const ventaUYU = tcVenta ? cents(ve.montoME, tcVenta) : 0n;
    const fechaVenta = ve.fecha ?? fechaAlta;
    const esME = !!ve.moneda && ve.moneda.toUpperCase() !== 'UYU';
    // Venta: Deudores por exportación / Ventas de exportación.
    mk(fechaVenta, 'Venta de exportación (re-exportación de la mercadería en tránsito)', [
      { cuenta: et('deudoresExportacion'), monedaOrig: esME ? ve.moneda : undefined, montoOrig: esME ? ve.montoME : undefined, debe: ventaUYU, haber: 0n },
      { cuenta: et('ventasExportacion'), monedaOrig: esME ? ve.moneda : undefined, montoOrig: esME ? ve.montoME : undefined, debe: 0n, haber: ventaUYU },
    ], [{ documento: 'Factura(s) de exportación', regla: 'Ingreso por la re-exportación de la mercadería que transitó el territorio. La exportación está gravada a tasa cero en IVA (art. 14 Tít. 10); el encuadre de IRAE se evalúa aparte (exoneración art. 66 lit. I → ficto 51/997 → general).' }], estado === 'OK');
    // CMV: Costo de mercadería vendida / Importaciones en trámite (salda el tránsito).
    mk(fechaVenta, 'Costo de mercadería vendida — imputación del costo en tránsito contra la venta', [
      { cuenta: et('costoVentas'), debe: costoInventario, haber: 0n },
      { cuenta: et('mercaderiaTransito'), debe: 0n, haber: costoInventario },
    ], [{ documento: 'Factura(s) de exportación', regla: 'El costo acumulado en Importaciones en trámite (CIF + gastos de tránsito) se imputa a Costo de Mercadería Vendida contra la venta de exportación. La cuenta de tránsito queda saldada: la mercadería vendida no permanece en existencias.' }], estado === 'OK');
    ventaExportacionOut = {
      montoME: ve.montoME, moneda: ve.moneda, fecha: fechaVenta, tc: tcVenta,
      ventaUYU, cmvUYU: costoInventario, resultadoBrutoUYU: ventaUYU - costoInventario,
      nota: 'Venta de exportación reconocida y costo imputado a CMV; el tránsito queda saldado (no permanece en «Importaciones en trámite»). El resultado bruto es venta − costo de la mercadería vendida.',
    };
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
  const CLAVE_BDU = 'bienesDeUso';
  const CLAVE_TRANSITO = 'mercaderiaTransito';
  const CUENTAS_COSTO = [CLAVE_MERC, CLAVE_BDU, CLAVE_TRANSITO];
  // El costo circula por las cuentas de COSTO: entra a Importaciones en trámite y,
  // al dar el alta, pasa a Mercaderías / Bienes de Uso. La suma NETA de las tres
  // cuentas debe igualar el costo total SIEMPRE: en trámite todo está en tránsito;
  // nacionalizada, todo en stock y el tránsito saldado. Así la verificación cierra
  // en ambos estados.
  const movimientosMercaderia = asientos.reduce((s, a) => s + a.lineas.filter((l) => CUENTAS_COSTO.includes(l.cuenta)).reduce((ss, l) => ss + l.debe - l.haber, 0n), 0n);
  const movimientosTransito = asientos.reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === CLAVE_TRANSITO).reduce((ss, l) => ss + l.debe - l.haber, 0n), 0n);
  // §7: el costo también puede salir del circuito a Costo de Mercadería Vendida (venta
  // de exportación en tránsito). Ese egreso es un destino FINAL del costo, igual que el
  // alta en stock, por eso entra en la igualdad de asientos.
  const movimientosCMV = asientos.reduce((s, a) => s + a.lineas.filter((l) => l.cuenta === 'costoVentas').reduce((ss, l) => ss + l.debe - l.haber, 0n), 0n);
  const sumaCostoArticulos = (items ?? []).reduce((s, i) => s + i.costo, 0n);
  const recAsiento = asientos.find((a) => /Reconocimiento/.test(a.glosa));
  // La adquisición entra por Importaciones en trámite (la cuenta de tránsito).
  const adquisicionAsiento = recAsiento ? recAsiento.lineas.filter((l) => l.cuenta === CLAVE_TRANSITO).reduce((s, l) => s + l.debe - l.haber, 0n) : 0n;
  const ci = costoInventario ?? 0n;
  const difArticulos = ci - sumaCostoArticulos;
  // Igualdad de asientos: el costo termina en STOCK (merc + bdu), en TRÁNSITO (todavía
  // sin alta) o en CMV (vendido en exportación). La suma de los tres = costo total.
  const difAsientos = ci - (movimientosMercaderia + movimientosCMV);
  const difAdquisicion = adquisicionUYU - adquisicionAsiento;
  // Saldo que queda en Importaciones en trámite: 0 si ya se dio el alta
  // (nacionalizada) o si se imputó a CMV (vendida en exportación); = costo total si
  // sigue en trámite (pendiente de alta/venta). NO es un error: es el estado del
  // circuito, por eso no entra en la verificación de 'ok'.
  const difTransito = movimientosTransito;
  const consistencia = {
    costoInventario, sumaCostoArticulos, movimientosMercaderia, movimientosTransito, movimientosCMV, adquisicionContable: adquisicionUYU,
    adquisicionAsiento, difArticulos, difAsientos, difAdquisicion, difTransito,
    ok: costoInventario != null && difArticulos === 0n && difAsientos === 0n && difAdquisicion === 0n,
  };
  if (costoInventario != null && !consistencia.ok) {
    motivos.push(`Inconsistencia interna: costo de inventario $${(Number(ci) / 100).toLocaleString('es-UY')} vs artículos (dif ${Number(difArticulos) / 100}) / asientos (dif ${Number(difAsientos) / 100}) / adquisición (dif ${Number(difAdquisicion) / 100}).`);
  }

  // ── Detección de régimen por el DUA ──────────────────────────────────────────
  // Una NACIONALIZACIÓN (definitiva) SIEMPRE liquida impuestos de nacionalización
  // (IVA importación y, normalmente, anticipos de IVA/IRAE). Un DUA de TRÁNSITO no
  // los trae. Si el régimen elegido no coincide con lo que muestra el DUA, se avisa
  // (no bloquea: es una alerta para que el operador corrija el régimen si corresponde).
  const sinImpuestosNacionalizacion = ivaImportacion === 0n && anticiposFiscales === 0n;
  let avisoRegimen: string | null = null;
  if (dua != null && !esTransito && sinImpuestosNacionalizacion) {
    avisoRegimen = 'La importación está marcada como NACIONALIZACIÓN, pero el DUA no liquida impuestos de nacionalización (sin IVA importación ni anticipos de IVA/IRAE). Esto corresponde a una operación de TRÁNSITO. Si es así, cambiá el régimen a Tránsito; si debía nacionalizarse, revisá el DUA.';
  } else if (esTransito && !sinImpuestosNacionalizacion) {
    avisoRegimen = 'La importación está marcada como TRÁNSITO, pero el DUA liquida impuestos de nacionalización (IVA importación / anticipos). Esto corresponde a una NACIONALIZACIÓN. Si es así, cambiá el régimen a Nacionalización.';
  }

  return {
    estado: (costoInventario != null && !consistencia.ok) ? 'PROVISIONAL' : estado,
    motivos: [...new Set(motivos)],
    avisoRegimen,
    anticipos: anticiposCalc, adquisicionUYU, anticiposPagadosUYU, excesoPagado, saldoNoAnticipado, comisionesBancariasUYU,
    // En TRÁNSITO los tributos de importación (incluidos anticipos de IVA/IRAE) están
    // SUSPENDIDOS: no hay tributo liquidado, ni crédito, ni pago a cuenta. Se reportan
    // en 0 para que el informe nunca muestre IVA importación/anticipos en una carpeta
    // de tránsito (el DUA de tránsito no los trae; esto además blinda ante datos sueltos).
    tributos: esTransito ? [] : tributos,
    totalTributos: esTransito ? 0n : totalTributos,
    tributosNoRecuperables: tributosNoRecuperablesCosto,
    ivaImportacion: ivaImportacionCredito,
    anticiposFiscales: esTransito ? 0n : anticiposFiscales,
    gastos, totalGastosUYU, ivaGastosUYU, creditoFiscalIva,
    costoInventario, costoMercaderia: costoMercaderiaCap, costoBienesDeUso, altaEnStock, esTransito,
    reconocimiento: {
      base: reconocimientoBase,
      fecha: reconocimientoBase === 'CONTROL' ? fechaControlTransferencia : fechaReconocimiento,
      cotizacion: reconocimientoBase === 'CONTROL' ? (controlCot.valor ?? null) : null,
      adquisicionReconocidaUYU: adquisicionUYU,
      diferenciaCambioUYU,
      costoAlPagoProvisional,
      origen: origenReconocimiento,
      nota: reconocimientoBase === 'CONTROL'
        ? `Adquisición reconocida a la ${origenReconocimiento}${fechaControlTransferencia ? ` ${fechaControlTransferencia}` : ''} y valuada al TC de ese día (NIC 21/2). La diferencia contra el TC de los pagos (${(Number(diferenciaCambioUYU) / 100).toLocaleString('es-UY')}) se reconoce como diferencia de cambio (resultado) y NO integra el costo.`
        : (costoAlPagoProvisional
          ? `Se informó la fecha de reconocimiento (${fechaControlTransferencia}) pero falta la cotización de ese día: el costo quedó valuado al TC de pago (provisional). Cargá la cotización de ese día para separar la diferencia de cambio (NIC 21).`
          : 'Adquisición valuada al TC de los pagos (anticipos no monetarios, NIC 21). Sin diferencia de cambio a separar mientras los pagos no sean posteriores a la transferencia de control a otro TC.'),
    },
    ventaExportacion: ventaExportacionOut,
    items, cuentaDespachante, asientos, consistencia, conciliacion: conc,
  };
}
