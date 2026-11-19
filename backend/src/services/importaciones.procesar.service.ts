/**
 * Procesa los documentos de un expediente: lee cada archivo, lo clasifica,
 * extrae con los parsers deterministas y GUARDA el resultado estructurado
 * (factura + artículos, liquidación + conceptos, transferencias con dedup),
 * enlazado a su documento de origen. Idempotente: reprocesar reemplaza la
 * extracción previa del expediente. Ver docs/importaciones-diseno.md (Etapa 1 sub-3).
 */
import { TipoDocumentoImportacion, EstadoProcesamientoDoc, ImportacionRegimen } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { storageService } from './storage.service';
import { textoPorPagina } from './importaciones.pdf-extract.service';
import { GastoImportacionConcepto } from '@prisma/client';
import { construirCosteoHistorico, sanitizarIdentificador, validarTipoCambio, CosteoDocInput } from './importaciones.costeo.service';
import { construirCostoFiscalAdquisicion, CostoFiscalInput } from './importaciones.fiscal.service';
import { cotizacionBcu } from './cotizaciones.service';
import {
  clasificarDocumento, parseFacturaComercial, parseLiquidacionDespachante,
  parsePagoExterior, consolidarPagos, TipoDoc, PagoParsed,
  parseDUA, parseFacturaServiciosUY, parseFacturasServiciosUY, parsePackingList, parsePagoLocal,
  parseRecibo, parseCertificadoOrigen,
} from './importaciones.parsers.service';

const C = (n: number | null | undefined): bigint => BigInt(Math.round((n ?? 0) * 100));
const fecha = (s: string | null | undefined): Date | null => (s ? new Date(`${s}T00:00:00Z`) : null);

const TIPO_PRISMA: Record<TipoDoc, TipoDocumentoImportacion> = {
  FACTURA_COMERCIAL: TipoDocumentoImportacion.FACTURA_COMERCIAL,
  FACTURA_EXPORTACION: TipoDocumentoImportacion.OTRO, // la VENTA (no es costo); se usa para el valor de exportación
  LIQUIDACION_DESPACHANTE: TipoDocumentoImportacion.LIQUIDACION_DESPACHANTE,
  SWIFT: TipoDocumentoImportacion.SWIFT,
  DEBITO_BANCARIO: TipoDocumentoImportacion.DEBITO_BANCARIO,
  DUA: TipoDocumentoImportacion.DUA,
  PACKING_LIST: TipoDocumentoImportacion.PACKING_LIST,
  FACTURA_SERVICIOS_UY: TipoDocumentoImportacion.FACTURA_SERVICIOS_DESPACHANTE,
  PAGO_TRIBUTOS: TipoDocumentoImportacion.PAGO_TRIBUTOS,
  PAGO_SERVICIOS_LOCAL: TipoDocumentoImportacion.DEBITO_BANCARIO,
  RECIBO: TipoDocumentoImportacion.OTRO,
  CERTIFICADO_ORIGEN: TipoDocumentoImportacion.OTRO,
  AUTORIZACION: TipoDocumentoImportacion.OTRO,
  DOC_TRANSPORTE: TipoDocumentoImportacion.DOC_TRANSPORTE,
  OTRO: TipoDocumentoImportacion.OTRO,
};

export interface ProcesarResultado {
  docsProcesados: number;
  facturas: number;
  liquidaciones: number;
  transferencias: number;
  dua: number;
  facturasServicios: number;
  pagosLocales: number;
  otros: number; // packing, recibos, certificado, autorización
  costeoActualizado: boolean; // true si se recalculó el costeo desde el DUA/factura
  faltantes: string[];
  advertencias: string[];
}

/**
 * Cotización FISCAL del DÍA DE LA OPERACIÓN para valuar la adquisición. Prioridad:
 *   1. Cotización cargada a mano para la fecha (override del operador).
 *   2. El tipo de cambio que informa el DUA: es la cotización oficial que la
 *      Aduana aplicó el día de la operación (cotización fiscal del día).
 *   3. BCU para la fecha exacta (fuente oficial y verificable), y se guarda.
 * Si no se consigue ninguna, devuelve null → el costo queda PENDIENTE.
 */
async function obtenerTcFiscalOperacion(moneda: string, fecha: Date | null, tcDua: number | null): Promise<{ valor: number | null; fuente: string | null }> {
  const fechaStr = fecha ? fecha.toISOString().slice(0, 10) : null;
  // 1) Cotización CONTABLE de ESA fecha (o del último día hábil inmediato, ventana
  //    de 4 días para cubrir fines de semana/feriados). NUNCA una cotización vieja
  //    de otro período: la ventana acotada evita reutilizar, p. ej., junio para agosto.
  if (fecha) {
    const desde = new Date(fecha); desde.setUTCDate(desde.getUTCDate() - 4);
    const guardada = await prisma.cotizacion.findFirst({
      where: { monedaOrigen: moneda, tipo: 'CONTABLE', fecha: { gte: desde, lte: fecha } },
      orderBy: { fecha: 'desc' },
    });
    if (guardada && validarTipoCambio(guardada.valor).valido) {
      const fg = guardada.fecha.toISOString().slice(0, 10);
      return { valor: guardada.valor, fuente: `${guardada.fuente || 'cotización cargada'} ${fg}${fg !== fechaStr ? ` (último día hábil para ${fechaStr})` : ''}` };
    }
  }
  // 2) La cotización fiscal del día que informa el DUA (validada estrictamente).
  const vDua = validarTipoCambio(tcDua);
  if (vDua.valido && vDua.valor != null) return { valor: vDua.valor, fuente: 'DUA (cotización oficial del día de la operación)' };
  // 3) BCU: la cotización de ESA fecha; si no hay (fin de semana/feriado) se toma
  //    el último día hábil inmediato (hasta 4 días atrás), nunca más lejos.
  if (fecha && fechaStr) {
    for (let atras = 0; atras <= 4; atras++) {
      try {
        const f = new Date(fecha); f.setUTCDate(f.getUTCDate() - atras);
        const fStr = f.toISOString().slice(0, 10);
        const bcu = await cotizacionBcu(moneda, fStr);
        const v = validarTipoCambio(bcu?.venta);
        if (bcu && v.valido && v.valor != null) {
          await prisma.cotizacion.upsert({
            where: { fecha_monedaOrigen_monedaDestino_tipo: { fecha: f, monedaOrigen: moneda, monedaDestino: 'UYU', tipo: 'CONTABLE' } },
            create: { fecha: f, monedaOrigen: moneda, monedaDestino: 'UYU', tipo: 'CONTABLE', valor: v.valor, compra: bcu.compra, venta: bcu.venta, fuente: 'BCU' },
            update: { valor: v.valor, compra: bcu.compra, venta: bcu.venta, fuente: 'BCU' },
          });
          return { valor: v.valor, fuente: `BCU ${fStr} (venta)${atras ? ` — último día hábil para ${fechaStr}` : ''}` };
        }
      } catch { /* probar el día anterior */ }
    }
  }
  return { valor: null, fuente: null };
}

/** Cotización fiscal del día (cargada → BCU), SIN usar el TC del DUA. Para valuar
 *  anticipos y servicios en ME a la FECHA CONTABLE real de cada uno. */
async function tcFiscalDia(moneda: string, fecha: Date | null): Promise<{ valor: number | null; fuente: string | null }> {
  return obtenerTcFiscalOperacion(moneda, fecha, null);
}

/**
 * Cotización FISCAL para IRAE (Art. 74 Dec. 150/007): interbancaria tipo COMPRADOR
 * billete (TCC) del cierre del DÍA ANTERIOR a la operación; si no hay (fin de
 * semana/feriado), el último día hábil anterior. Es un criterio distinto del
 * contable (venta del día de pago) y del aduanero (TC del DUA). Se guarda como
 * Cotizacion tipo FISCAL. Devuelve null si no se consigue (→ costo fiscal PENDIENTE).
 */
async function tcFiscalArt74(moneda: string, fechaOperacion: Date | null): Promise<{ valor: number; fuente: string } | null> {
  if (!fechaOperacion) return null;
  for (let atras = 1; atras <= 7; atras++) { // desde el día ANTERIOR, hasta 7 días atrás
    const f = new Date(fechaOperacion); f.setUTCDate(f.getUTCDate() - atras);
    const fStr = f.toISOString().slice(0, 10);
    const guardada = await prisma.cotizacion.findFirst({ where: { monedaOrigen: moneda, monedaDestino: 'UYU', tipo: 'FISCAL', fecha: f } });
    const gv = guardada ? validarTipoCambio(guardada.compra ?? guardada.valor) : { valido: false, valor: null as number | null };
    if (guardada && gv.valido && gv.valor != null) return { valor: gv.valor, fuente: `${guardada.fuente || 'cotización fiscal'} ${fStr} (comprador billete, Art. 74)` };
    try {
      const bcu = await cotizacionBcu(moneda, fStr);
      const v = validarTipoCambio(bcu?.compra); // comprador billete (TCC)
      if (bcu && v.valido && v.valor != null) {
        await prisma.cotizacion.upsert({
          where: { fecha_monedaOrigen_monedaDestino_tipo: { fecha: f, monedaOrigen: moneda, monedaDestino: 'UYU', tipo: 'FISCAL' } },
          create: { fecha: f, monedaOrigen: moneda, monedaDestino: 'UYU', tipo: 'FISCAL', valor: v.valor, compra: bcu.compra, venta: bcu.venta, fuente: 'BCU interbancario comprador billete (Art. 74 Dec. 150/007)' },
          update: { valor: v.valor, compra: bcu.compra, venta: bcu.venta, fuente: 'BCU interbancario comprador billete (Art. 74 Dec. 150/007)' },
        });
        return { valor: v.valor, fuente: `BCU ${fStr} comprador billete (Art. 74 Dec. 150/007)${atras > 1 ? ` — último día hábil anterior` : ''}` };
      }
    } catch { /* probar el día anterior */ }
  }
  return null;
}

const bigintReplacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/**
 * Recalcula el COSTEO HISTÓRICO del expediente (construirCosteoHistorico):
 * adquisición valuada por los ANTICIPOS a la cotización fiscal de CADA fecha de
 * pago (partida no monetaria, NIC 21), tributos del DUA, gastos de plaza
 * desglosados con dedup por cuenta de terceros, asientos cronológicos con
 * referencias, y conciliaciones. Si falta una cotización → PROVISIONAL (se usa
 * el TC del DUA solo como estimación provisional y se bloquea la aprobación).
 * Guarda el detalle completo en costeoDetalle. Requiere DUA presente.
 */
export async function reconstruirCosteoDesdeExtraccion(importacionId: string): Promise<{ ok: boolean; estado?: string; motivo?: string; regimenAuto?: string | null }> {
  const imp = await prisma.importacion.findUnique({ where: { id: importacionId } });
  if (!imp || imp.estado === 'ANULADA') return { ok: false };
  const [duaEx, serviciosEx, facturasAll, pagoTrib, transferencias, recibos, packingEx] = await Promise.all([
    prisma.importacionDocExtraccion.findFirst({ where: { importacionId, tipo: 'DUA' } }),
    prisma.importacionDocExtraccion.findMany({ where: { importacionId, tipo: 'FACTURA_SERVICIOS_UY' } }),
    prisma.importacionFactura.findMany({ where: { importacionId }, include: { articulos: { orderBy: { nro: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
    prisma.importacionDocExtraccion.findFirst({ where: { importacionId, tipo: 'PAGO_TRIBUTOS' } }),
    prisma.importacionTransferencia.findMany({ where: { importacionId }, orderBy: { fecha: 'asc' } }),
    prisma.importacionDocExtraccion.findMany({ where: { importacionId, tipo: 'RECIBO' } }),
    prisma.importacionDocExtraccion.findFirst({ where: { importacionId, tipo: 'PACKING_LIST' } }),
  ]);
  // El DUA formal (DNA) puede NO estar: en operaciones de TRÁNSITO los números de DUA
  // vienen dentro de las e-facturas del despachante y no hay un PDF de DUA aparte. En
  // ese caso se costea igual desde la factura + servicios (sin tributos de importación).
  // Sin DUA y sin factura no hay nada que costear.
  if (!duaEx && facturasAll.length === 0) return { ok: false };
  // Una importación puede traer VARIAS facturas comerciales del proveedor (p. ej. dos
  // embarques, YZ…D-1 y YZ…D-2). Se CONSOLIDAN en una sola: se suman FOB/flete/seguro/
  // total y se unifican los artículos por código (suma de cantidades e importes), para
  // que el costeo tome TODO el FOB y no solo la primera factura.
  const factura = facturasAll.length === 0 ? null : facturasAll.length === 1 ? facturasAll[0] : (() => {
    const suma = (f: (x: typeof facturasAll[number]) => bigint) => facturasAll.reduce((s, x) => s + f(x), 0n);
    const artMap = new Map<string, { nro: number; codigo: string | null; descripcion: string; cantidad: number; precioUnit: number; total: bigint; clasificacion: string }>();
    for (const f of facturasAll) for (const a of f.articulos) {
      const k = (a.codigo ?? a.descripcion ?? '').trim().toUpperCase();
      const ex = artMap.get(k);
      if (ex) { ex.cantidad += a.cantidad; ex.total += a.total; }
      else artMap.set(k, { nro: artMap.size + 1, codigo: a.codigo, descripcion: a.descripcion, cantidad: a.cantidad, precioUnit: a.precioUnit, total: a.total, clasificacion: a.clasificacion });
    }
    return { ...facturasAll[0], fob: suma((x) => x.fob), flete: suma((x) => x.flete), seguro: suma((x) => x.seguro), cif: suma((x) => x.cif), total: suma((x) => x.total), articulos: [...artMap.values()] };
  })();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = duaEx?.datos ?? {};
  const moneda: string = imp.monedaOrigen || d.moneda || 'USD';
  const tcAdVal = validarTipoCambio(d.tipoCambio);
  const duaDate = d.fechaPago ? new Date(`${d.fechaPago}T00:00:00Z`) : (factura?.fecha ?? null);
  const iso = (dd: Date | null) => (dd ? dd.toISOString().slice(0, 10) : null);

  // Anticipos al proveedor: cada transferencia a su cotización fiscal del día de pago.
  const anticipos = await Promise.all(transferencias.map(async (t) => {
    const cot = await tcFiscalDia(t.moneda, t.fecha);
    return { fecha: iso(t.fecha), referencia: t.referencia, moneda: t.moneda, monto: Number(t.importe) / 100, comision: Number(t.comision) / 100, cotizacion: cot.valor, fuente: cot.fuente };
  }));
  // Servicios con su FECHA CONTABLE (fecha de la e-factura) y, si están en ME, su
  // cotización de esa fecha (fuente verificable).
  const servicios = await Promise.all(serviciosEx.map(async (s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sd: any = s.datos ?? {};
    const esUsd = (sd.moneda ?? '').toUpperCase() === 'USD';
    const cot = esUsd ? await tcFiscalDia(sd.moneda, s.fecha) : { valor: null, fuente: null };
    const primeraLinea = sd.concepto ?? (Array.isArray(sd.lineas) && sd.lineas[0] ? String(sd.lineas[0].descripcion ?? '') : '');
    return { rutComprador: sd.rutComprador ?? null, rutEmisor: sd.rutEmisor ?? s.rutEmisor ?? null, moneda: sd.moneda ?? null, serie: sd.serie ?? null, numero: sd.numero ?? null, emisor: s.emisor, honorarios: sd.honorarios ?? null, gastosOperativos: sd.gastosOperativos ?? null, iva: sd.iva ?? null, total: sd.total ?? null, noFacturable: sd.noFacturable ?? null, concepto: primeraLinea, fecha: iso(s.fecha), cotizacion: esUsd ? cot.valor : null, fuenteCotizacion: esUsd ? cot.fuente : 'operación en pesos' };
  }));
  // Pago al despachante: recibo emitido por el despachante (RUT declarante).
  const reciboDesp = recibos.find((rc) => rc.rutEmisor && d.declaranteRut && rc.rutEmisor === d.declaranteRut) ?? recibos[0] ?? null;
  // Pago a la agencia de carga: transferencia en plaza (PAGO_SERVICIOS_LOCAL).
  const pagoAgenciaEx = await prisma.importacionDocExtraccion.findFirst({ where: { importacionId, tipo: 'PAGO_SERVICIOS_LOCAL' } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pagoAgData: any = pagoAgenciaEx?.datos ?? null;
  const pagoAgencia = pagoAgenciaEx ? { fecha: pagoAgenciaEx.fecha ? iso(pagoAgenciaEx.fecha) : (pagoAgData?.fecha ?? null), moneda: pagoAgenciaEx.moneda ?? pagoAgData?.moneda ?? 'UYU', montoME: Number(pagoAgenciaEx.total) / 100 } : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const packingDatos: any = packingEx?.datos ?? null;
  const unidadesPacking: number | null = packingDatos?.cantidadTotal ?? null;
  // Bultos parseados del packing vs bultos declarados (DUA): detecta parseos incompletos.
  const packingBultos: number | null = packingDatos?.totalBultos ?? null;
  const packingBultosDeclarados: number | null = d.totalBultos ?? null;
  // Liquidación preliminar del despachante ("Gastos del Embarque"): total + conceptos,
  // para conciliar contra los tributos liquidados del DUA (p. ej. la Tasa Escáner).
  const liqDesp = await prisma.importacionLiquidacion.findFirst({ where: { importacionId }, include: { conceptos: true }, orderBy: { createdAt: 'asc' } });
  const liquidacionPreliminar = liqDesp ? { total: liqDesp.total ?? null, conceptos: liqDesp.conceptos.map((c) => ({ clave: c.clave, monto: c.monto })) } : null;
  // Cotización fiscal de la fecha de reconocimiento (día de la operación) por BCU
  // (NUNCA el TC aduanero del DUA: ese criterio es solo para el Valor en Aduana).
  const cotReconoc = await tcFiscalDia(moneda, duaDate);

  // ── AUTO-DETECCIÓN DEL RÉGIMEN desde los documentos ───────────────────────────
  // Para que al cargar la información el sistema aplique el tratamiento correcto sin
  // intervención. Señales de TRÁNSITO / trading: (a) el despachante declara "TIPO
  // OPERACION: TRANSITO/DEPOSITO/…" en su e-factura; (b) el DUA no liquida IVA
  // importación (cód. 15) ni adelanto de IVA (cód. 16) → materialmente no nacionaliza.
  // Solo se auto-cambia desde el default DEFINITIVA (no pisa un régimen ya elegido).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const duaTrib: Array<any> = Array.isArray(d.tributos) ? d.tributos : [];
  const duaSinImpuestosNacionalizacion = !duaTrib.some((t) => t?.codigo === '15' || t?.codigo === '16');
  const despachanteDeclaraTransito = serviciosEx.some((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = String(((s.datos as any) ?? {}).tipoOperacion ?? '');
    return /TR[AÁ]NSITO|TRANSBORDO|DEP[OÓ]SITO|ADMISI[OÓ]N|ZONA\s*FRANCA/i.test(op);
  });
  // Señal segura: el despachante declara tránsito (explícito), o el DUA FUE leído con
  // tributos pero NINGUNO es IVA importación/anticipo (tránsito real: solo tasas). No
  // se gatilla con la lista de tributos vacía (podría ser un parseo incompleto).
  const pareceTransito = despachanteDeclaraTransito || (duaSinImpuestosNacionalizacion && duaTrib.length > 0);
  // Auto-cambio solo desde el default DEFINITIVA (no pisa un régimen ya elegido). Se
  // persiste junto con el resto del costeo en la actualización transaccional de abajo.
  const regimenEfectivo = (pareceTransito && imp.regimen === ImportacionRegimen.DEFINITIVA)
    ? ImportacionRegimen.TRANSITO
    : imp.regimen;

  const r = construirCosteoHistorico({
    dua: {
      nroDua: d.nroDua ?? null, tipoCambio: d.tipoCambio, valorAduanaPesos: d.valorAduanaPesos ?? null,
      importadorRut: d.importadorRut ?? null, declaranteRut: d.declaranteRut ?? null, unidadesComerciales: d.unidadesComerciales ?? null,
      importeFacturas: d.importeFacturas ?? null, moneda: d.moneda ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tributos: (d.tributos ?? []).map((t: any) => ({ codigo: t.codigo, nombre: t.nombre, monto: t.monto })),
    } as CosteoDocInput['dua'],
    factura: factura ? {
      fob: factura.fob, flete: factura.flete, seguro: factura.seguro, total: factura.total, moneda: factura.moneda,
      articulos: factura.articulos.map((a) => ({ descripcion: a.descripcion || a.codigo || 'Ítem', codigo: a.codigo, cantidad: a.cantidad || 1, total: a.total, clasificacion: a.clasificacion })),
    } : null,
    servicios, anticipos,
    pagoSpeCtms: pagoTrib ? pagoTrib.total : null,
    pagoDespachanteCtms: reciboDesp ? reciboDesp.total : null,
    fechaPagoDespachante: reciboDesp?.fecha ? iso(reciboDesp.fecha) : null,
    pagoAgencia,
    fechaReconocimiento: iso(duaDate), cotizacionReconocimiento: cotReconoc.valor,
    // El TC aduanero del DUA NO se usa para valuar el COSTO (criterio contable): si
    // falta la cotización de alguna fecha, el asiento queda PROVISIONAL en lugar de
    // asumir el TC aduanero.
    tcProvisional: null,
    unidadesPacking, packingBultos, packingBultosDeclarados,
    liquidacionPreliminar,
    // El alta en stock se emite solo al nacionalizar/cerrar; en trámite el costo
    // queda acumulado en Importaciones en trámite.
    estadoImportacion: imp.estado,
    // RÉGIMEN: DEFINITIVA = Nacionalización (criterio completo); cualquier otro
    // (TRÁNSITO, DEPÓSITO, ADMISIÓN TEMPORARIA, ZONA FRANCA) = régimen suspensivo →
    // tributos de importación suspendidos (fuera de costo y crédito) y sin alta en stock.
    esTransito: regimenEfectivo !== ImportacionRegimen.DEFINITIVA,
    etiqueta: (k) => k, // en el informe/asiento se re-etiqueta con el plan de cuentas
  });
  const ncm: string | null = d.ncm ?? null;
  // TC CONTABLE del cabezal = la cotización de los anticipos (criterio contable, NIC 21).
  // Si hay UNA sola cotización, se guarda; si hay VARIAS fechas con cotizaciones distintas
  // (p. ej. 40,512 y 40,674), se guarda NULL y la portada muestra todas (no se colapsa a
  // una sola ni se usa el TC aduanero del DUA). El detalle por anticipo va en costeoDetalle.
  const tasasAnticipos = [...new Set(anticipos.map((a) => a.cotizacion).filter((v): v is number => v != null))];
  const tcRepresentativo = tasasAnticipos.length === 1 ? tasasAnticipos[0] : null;
  const costeoDetalle = JSON.parse(JSON.stringify(r, bigintReplacer));

  // ── COSTO FISCAL DE ADQUISICIÓN (IRAE) — separado, no altera lo contable ──
  // Se pre-cargan las cotizaciones fiscales (Art. 74) de las fechas de operación
  // relevantes; el motor es puro y las consume de un mapa. Sin config validada o sin
  // cotización → PENDIENTE (no se emite importe fiscal ni se usa el contable).
  const rf = await (async () => {
    try {
      const fiscalConfig = await prisma.importacionFiscalConfig.findUnique({ where: { companyId: imp.companyId } });
      const opDates = new Set<string>();
      if (iso(duaDate)) opDates.add(iso(duaDate)!);
      if (factura?.fecha) opDates.add(iso(factura.fecha)!);
      for (const a of anticipos) if (a.fecha) opDates.add(a.fecha);
      for (const g of r.gastos) if (g.incluidoEnCosto && (g.moneda ?? 'UYU').toUpperCase() !== 'UYU' && g.fecha) opDates.add(g.fecha);
      const fiscalCache = new Map<string, { valor: number; fuente: string }>();
      for (const dISO of opDates) {
        const c = await tcFiscalArt74(moneda, new Date(`${dISO}T00:00:00Z`));
        if (c) fiscalCache.set(dISO, c);
      }
      const fiscalInput: CostoFiscalInput = {
        contable: {
          adquisicionUYU: r.adquisicionUYU, tributosNoRecuperables: r.tributosNoRecuperables, totalGastosUYU: r.totalGastosUYU, costoInventario: r.costoInventario,
          ivaImportacion: r.ivaImportacion, ivaGastosUYU: r.ivaGastosUYU,
          anticipos: anticipos.map((a) => ({ fecha: a.fecha, montoME: a.monto })),
          excesoPagado: r.excesoPagado, saldoNoAnticipado: r.saldoNoAnticipado,
          gastos: r.gastos.map((g) => ({ documento: g.documento, concepto: g.concepto, moneda: g.moneda, fecha: g.fecha ?? null, montoME: g.montoME, montoUYU: g.montoUYU, incluidoEnCosto: g.incluidoEnCosto, esDelDespachante: g.esDelDespachante })),
          tributos: r.tributos.map((t) => ({ tipo: t.tipo, monto: t.monto, recuperable: t.recuperable, codigo: t.codigo })),
          items: (r.items ?? []).map((i) => ({ codigo: i.codigo, descripcion: i.descripcion, cantidad: i.cantidad, fobME: i.fobME, costo: i.costo })),
          cifME: factura ? Number(factura.total) / 100 : 0, monedaOrigen: moneda,
        },
        factura: factura ? { numero: factura.numero ?? null, fecha: iso(factura.fecha), articulos: factura.articulos.map((a) => ({ codigo: a.codigo, descripcion: a.descripcion || a.codigo || 'Ítem', cantidad: a.cantidad || 1, unidad: null, fobME: a.total })) } : null,
        fechas: { nacionalizacion: iso(duaDate), factura: iso(factura?.fecha ?? null) },
        duaNumero: sanitizarIdentificador(d.nroDua) ?? null,
        config: fiscalConfig ? { validado: fiscalConfig.validado, metodoValuacionInventario: fiscalConfig.metodoValuacionInventario, criterioMonedaExtranjera: fiscalConfig.criterioMonedaExtranjera, criterioFechaOperacion: fiscalConfig.criterioFechaOperacion, tratamientoIva: fiscalConfig.tratamientoIva, porcentajeIvaNoRecuperable: fiscalConfig.porcentajeIvaNoRecuperable, politicaDistribucion: null } : null,
        cotizacionFiscal: (f: string) => fiscalCache.get(f) ?? null,
      };
      return construirCostoFiscalAdquisicion(fiscalInput);
    } catch { return null; }
  })();
  const costeoFiscalDetalle = rf ? JSON.parse(JSON.stringify(rf, bigintReplacer)) : null;

  // Venta de EXPORTACIÓN (triangulación/tránsito): suma de las e-Facturas de
  // exportación del propio importador (fuente autoritativa para el encuadre de IRAE).
  // Se calcula acá para que el valor quede persistido siempre que se rehace el costeo.
  const exportEx = await prisma.importacionDocExtraccion.findMany({ where: { importacionId, tipo: 'FACTURA_EXPORTACION' }, select: { total: true } });
  const ventaExportacionCtms = exportEx.reduce((s, e) => s + (e.total ?? 0n), 0n);

  await prisma.$transaction([
    prisma.itemImportacion.deleteMany({ where: { importacionId } }),
    prisma.tributoImportacion.deleteMany({ where: { importacionId } }),
    prisma.gastoImportacion.deleteMany({ where: { importacionId } }),
    prisma.importacion.update({
      where: { id: importacionId },
      data: {
        regimen: regimenEfectivo, // auto-detectado desde los documentos (tránsito/definitiva)
        valorVentaExportacion: ventaExportacionCtms > 0n ? ventaExportacionCtms : imp.valorVentaExportacion,
        proveedorExterior: sanitizarIdentificador(d.proveedor) ?? factura?.proveedor ?? imp.proveedorExterior,
        // Incoterm limpio desde la factura (p. ej. "FOB"), pisa el autocompletado sucio.
        incoterm: factura?.incoterm ?? imp.incoterm,
        paisOrigen: d.paisOrigen ?? imp.paisOrigen,
        monedaOrigen: moneda,
        tipoCambio: tcRepresentativo ?? imp.tipoCambio,
        tcContable: tcRepresentativo,
        tcAduanero: tcAdVal.valor,
        duaNumero: sanitizarIdentificador(d.nroDua) ?? imp.duaNumero,
        duaFecha: duaDate ?? imp.duaFecha,
        aduana: d.aduana ?? imp.aduana,
        transporteDoc: d.awb ? `AWB ${d.awb}` : imp.transporteDoc,
        facturaComercialNro: factura?.numero ?? imp.facturaComercialNro,
        facturaComercialFecha: factura?.fecha ?? imp.facturaComercialFecha,
        // La adquisición (CIF histórico) ya incluye flete/seguro (están dentro del CIF).
        fob: r.adquisicionUYU, flete: 0n, seguro: 0n, cif: r.adquisicionUYU,
        totalTributos: r.totalTributos, totalGastos: r.totalGastosUYU,
        costoMercaderia: r.costoInventario ?? 0n, creditoFiscalIva: r.creditoFiscalIva, anticipos: r.anticiposFiscales,
        costeoEstado: r.estado,
        costeoMotivo: r.motivos.length ? r.motivos.join(' · ') : null,
        costeoDetalle,
        // Costo fiscal de adquisición (IRAE), separado del contable.
        costeoFiscalEstado: rf ? rf.estado : null,
        costeoFiscalMotivo: rf && rf.motivos.length ? rf.motivos.join(' · ') : null,
        costeoFiscalDetalle,
        items: { create: (r.items ?? []).map((i) => ({ codigo: i.codigo, descripcion: i.descripcion, ncm, cantidad: i.cantidad, fobUnitario: i.cantidad ? i.fobME / BigInt(Math.max(1, Math.round(i.cantidad))) : i.fobME, fobTotal: i.fobME, costoProrrateado: i.costo, clasificacion: i.clasificacion })) },
        tributos: { create: r.tributos.map((t) => ({ tipo: t.tipo, baseImponible: 0n, tasa: 0, monto: t.monto, recuperable: t.recuperable })) },
        gastos: { create: r.gastos.filter((g) => g.incluidoEnCosto).map((g) => ({ concepto: /honorario/i.test(g.concepto) ? GastoImportacionConcepto.HONORARIOS_DESPACHANTE : GastoImportacionConcepto.OTRO, descripcion: `${g.documento}: ${g.concepto}`, monto: g.montoUYU, gravadoIva: g.gravado, ivaGasto: g.ivaUYU })) },
      },
    }),
  ]);
  const regimenAuto = regimenEfectivo !== imp.regimen ? regimenEfectivo : null;
  return { ok: true, estado: r.estado, motivo: r.motivos.join(' · '), regimenAuto };
}

export async function procesarExpediente(importacionId: string): Promise<ProcesarResultado> {
  const docs = await prisma.importacionDocumento.findMany({ where: { importacionId } });
  const advertencias: string[] = [];

  // Preservar la CLASIFICACIÓN (bien de uso) que el usuario haya marcado en los
  // artículos: el reproceso vuelve a leer la factura, pero no debe perder esa
  // marca. Se guarda por código (o descripción) y se reaplica al recrear.
  const prevClasif = new Map<string, string>();
  const prevFacturas = await prisma.importacionFactura.findMany({ where: { importacionId }, include: { articulos: true } });
  for (const pf of prevFacturas) {
    for (const pa of pf.articulos) {
      if (pa.clasificacion && pa.clasificacion !== 'MERCADERIA') {
        prevClasif.set((pa.codigo ?? pa.descripcion ?? '').trim().toUpperCase(), pa.clasificacion);
      }
    }
  }
  const clasifDe = (codigo?: string | null, descripcion?: string | null): string =>
    prevClasif.get((codigo ?? descripcion ?? '').trim().toUpperCase()) ?? 'MERCADERIA';

  // Reproceso idempotente: borrar la extracción previa del expediente.
  await prisma.importacionFactura.deleteMany({ where: { importacionId } });
  await prisma.importacionLiquidacion.deleteMany({ where: { importacionId } });
  await prisma.importacionTransferencia.deleteMany({ where: { importacionId } });
  await prisma.importacionDocExtraccion.deleteMany({ where: { importacionId } });

  let facturas = 0, liquidaciones = 0, docsProcesados = 0;
  let dua = 0, facturasServicios = 0, pagosLocales = 0, otros = 0;
  // VENTA de exportación (triangulación/tránsito): suma de las e-Facturas de
  // exportación del propio importador. No es costo; alimenta valorVentaExportacion.
  let exportaciones = 0; let ventaExportacionCtms = 0n;
  const pagos: Array<PagoParsed & { tipos: TipoDoc }> = [];
  const tiposVistos = new Set<TipoDoc>();

  // Alta de una extracción genérica (DUA, servicios UY, packing, pagos, recibos…).
  const guardarExtraccion = (
    docId: string, tipo: string, confianza: number,
    f: { emisor?: string | null; rutEmisor?: string | null; serie?: string | null; numero?: string | null; fecha?: string | null; moneda?: string | null; total?: number | null; resumen: string; datos: unknown },
  ) => prisma.importacionDocExtraccion.create({
    data: {
      importacionId, documentoId: docId, tipo, confianza,
      emisor: f.emisor ?? null, rutEmisor: f.rutEmisor ?? null, serie: f.serie ?? null, numero: f.numero ?? null,
      fecha: fecha(f.fecha), moneda: f.moneda ?? null, total: C(f.total), resumen: f.resumen,
      datos: (f.datos ?? {}) as object,
    },
  });

  // Separa un PDF que trae VARIOS documentos (el set completo del expediente: factura
  // + packing + DUA + e-facturas + SWIFT…) en segmentos, clasificando CADA página.
  // Agrupa páginas consecutivas del mismo tipo (p. ej. una póliza de 6 hojas), salvo
  // los tipos "uno por página" (facturas, recibos, pagos), que se separan por página
  // para no perder ninguno. Las páginas escaneadas/vacías se adjuntan al segmento previo.
  const UNO_POR_PAGINA = new Set<TipoDoc>(['FACTURA_COMERCIAL', 'FACTURA_EXPORTACION', 'FACTURA_SERVICIOS_UY', 'RECIBO', 'SWIFT', 'PAGO_TRIBUTOS', 'PAGO_SERVICIOS_LOCAL']);
  const segmentar = (paginas: string[]): Array<{ tipo: TipoDoc; confianza: number; texto: string }> => {
    const segs: Array<{ tipo: TipoDoc; confianza: number; texto: string }> = [];
    for (const pag of paginas) {
      if (pag.trim().length < 40) { if (segs.length) segs[segs.length - 1].texto += `\n${pag}`; continue; }
      const { tipo, confianza } = clasificarDocumento(pag);
      const prev = segs[segs.length - 1];
      if (prev && prev.tipo === tipo && !UNO_POR_PAGINA.has(tipo)) prev.texto += `\n${pag}`;
      else segs.push({ tipo, confianza, texto: pag });
    }
    return segs;
  };

  for (const doc of docs) {
    if (doc.mimeType !== 'application/pdf') {
      await prisma.importacionDocumento.update({ where: { id: doc.id }, data: { estadoProc: EstadoProcesamientoDoc.PENDIENTE, errorProc: 'Requiere OCR (no es PDF con texto) — próxima etapa' } });
      continue;
    }
    let paginas: string[] = [];
    try { paginas = await storageService.read(doc.storageKey).then((b) => textoPorPagina(b)); }
    catch { await prisma.importacionDocumento.update({ where: { id: doc.id }, data: { estadoProc: EstadoProcesamientoDoc.ERROR, errorProc: 'No se pudo leer el PDF' } }); continue; }

    // PDF escaneado sin capa de texto (p. ej. conocimiento aéreo): no se puede leer
    // sin OCR. Se deja PENDIENTE con aviso; el AWB ya se obtiene del DUA.
    if (paginas.join('').trim().length < 40) {
      await prisma.importacionDocumento.update({ where: { id: doc.id }, data: { estadoProc: EstadoProcesamientoDoc.PENDIENTE, errorProc: 'PDF escaneado sin texto — requiere OCR (el Nº de AWB ya se toma del DUA)' } });
      advertencias.push(`"${doc.fileName}" parece escaneado (sin texto): no se pudo leer automáticamente; se requeriría OCR.`);
      continue;
    }

    const segmentos = segmentar(paginas);
    const tipoArchivo = segmentos.length === 1 ? segmentos[0].tipo : 'OTRO';
    await prisma.importacionDocumento.update({ where: { id: doc.id }, data: { tipoDetectado: TIPO_PRISMA[tipoArchivo], confianzaTipo: segmentos[0]?.confianza ?? 0, estadoProc: EstadoProcesamientoDoc.PROCESADO, errorProc: segmentos.length > 1 ? `PDF combinado: ${segmentos.length} documentos detectados` : null } });
    docsProcesados += 1;

    for (const seg of segmentos) {
      const { texto, tipo, confianza } = seg;
      tiposVistos.add(tipo);
      if (tipo === 'FACTURA_COMERCIAL') {
      const f = parseFacturaComercial(texto);
      await prisma.importacionFactura.create({
        data: {
          importacionId, documentoId: doc.id,
          proveedor: f.proveedor, cuit: f.cuit, numero: f.numero, fecha: fecha(f.fecha),
          moneda: f.moneda, incoterm: f.incoterm,
          fob: C(f.fob), flete: C(f.flete), seguro: C(f.seguro), cif: C(f.cif), total: C(f.total),
          confianza,
          articulos: { create: f.articulos.map((a) => ({ nro: a.nro, codigo: a.codigo, descripcion: a.descripcion, cantidad: a.cantidad, precioUnit: a.precioUnit, total: C(a.total), clasificacion: clasifDe(a.codigo, a.descripcion) })) },
        },
      });
      facturas += 1;
    } else if (tipo === 'FACTURA_EXPORTACION') {
      // La VENTA (p. ej. STX → SteelDek, Brasil). Puede traer varias e-Facturas por PDF.
      // No integra el costo; se suma para el valor de exportación (encuadre de IRAE).
      const cfes = parseFacturasServiciosUY(texto);
      for (const s of cfes) {
        ventaExportacionCtms += C(s.total);
        await guardarExtraccion(doc.id, 'FACTURA_EXPORTACION', confianza, {
          emisor: s.emisor, rutEmisor: s.rutEmisor, serie: s.serie, numero: s.numero,
          fecha: s.fecha, moneda: s.moneda, total: s.total,
          resumen: `Venta de exportación · ${s.tipoDoc} ${s.serie ?? ''}${s.numero ?? ''} · ${s.moneda} ${(s.total ?? 0).toLocaleString('es-UY')}`,
          datos: s,
        });
        exportaciones += 1;
      }
    } else if (tipo === 'LIQUIDACION_DESPACHANTE') {
      const l = parseLiquidacionDespachante(texto);
      await prisma.importacionLiquidacion.create({
        data: {
          importacionId, documentoId: doc.id,
          despachante: l.despachante, carpeta: l.carpeta, fecha: fecha(l.fecha), aduana: l.aduana,
          origen: l.origen, transporte: l.transporte, cif: C(l.cif), tipoCambio: l.tipoCambio ?? null,
          moneda: l.moneda, kilosBrutos: l.kilosBrutos ?? null, kilosNetos: l.kilosNetos ?? null,
          total: C(l.total), gastosAgenciaExtra: l.gastosAgenciaExtra ?? null,
          conceptos: { create: Object.entries(l.conceptos).map(([clave, monto]) => ({ clave, monto: C(monto) })) },
        },
      });
      liquidaciones += 1;
    } else if (tipo === 'SWIFT' || tipo === 'DEBITO_BANCARIO') {
      pagos.push({ ...parsePagoExterior(texto), tipos: tipo });
    } else if (tipo === 'DUA') {
      const d = parseDUA(texto);
      await guardarExtraccion(doc.id, 'DUA', confianza, {
        numero: d.nroDua, fecha: d.fechaPago, moneda: 'UYU', total: d.totalTributos,
        resumen: `DUA ${d.nroDua ?? '(s/nº)'} · Canal ${d.canal ?? '—'} · ${d.regimen ?? ''} · NCM ${d.ncm ?? '—'} · tributos $${(d.totalTributos ?? 0).toLocaleString('es-UY')}`,
        datos: d,
      });
      dua += 1;
    } else if (tipo === 'FACTURA_SERVICIOS_UY') {
      // Un mismo PDF puede traer VARIAS e-Facturas (p. ej. servicio + IVA sobre flete):
      // se guarda UNA extracción por CFE para no perder ningún comprobante.
      const cfes = parseFacturasServiciosUY(texto);
      for (const s of cfes) {
        await guardarExtraccion(doc.id, 'FACTURA_SERVICIOS_UY', confianza, {
          emisor: s.emisor, rutEmisor: s.rutEmisor, serie: s.serie, numero: s.numero,
          fecha: s.fecha, moneda: s.moneda, total: s.total,
          resumen: `${s.emisor ?? 'Servicio UY'} · ${s.tipoDoc} ${s.serie ?? ''}${s.numero ?? ''} · ${s.moneda} ${(s.total ?? 0).toLocaleString('es-UY')}${s.concepto ? ` · ${s.concepto}` : ''}`,
          datos: s,
        });
      }
      facturasServicios += cfes.length;
    } else if (tipo === 'PACKING_LIST') {
      const p = parsePackingList(texto);
      await guardarExtraccion(doc.id, 'PACKING_LIST', confianza, {
        moneda: null, total: null,
        resumen: `Packing list · ${p.totalBultos} bultos · ${p.cantidadTotal ?? '—'} unidades · NCM ${p.ncm ?? '—'} · origen ${p.paisOrigen ?? '—'}`,
        datos: p,
      });
      otros += 1;
    } else if (tipo === 'PAGO_TRIBUTOS') {
      const g = parsePagoLocal(texto);
      await guardarExtraccion(doc.id, 'PAGO_TRIBUTOS', confianza, {
        numero: g.referencia, fecha: g.fecha, moneda: g.moneda, total: g.importe,
        emisor: g.banco,
        resumen: `Pago de tributos del DUA · ${g.banco ?? 'banco'} · ${g.moneda} ${(g.importe ?? 0).toLocaleString('es-UY')} · ref ${g.referencia ?? '—'}`,
        datos: g,
      });
      pagosLocales += 1;
    } else if (tipo === 'PAGO_SERVICIOS_LOCAL') {
      const g = parsePagoLocal(texto);
      await guardarExtraccion(doc.id, 'PAGO_SERVICIOS_LOCAL', confianza, {
        numero: g.referencia, fecha: g.fecha, moneda: g.moneda, total: g.importe,
        emisor: g.banco,
        resumen: `Transferencia local a ${g.beneficiario ?? 'agencia'} · ${g.moneda} ${(g.importe ?? 0).toLocaleString('es-UY')} · ref ${g.referencia ?? '—'}`,
        datos: g,
      });
      pagosLocales += 1;
    } else if (tipo === 'RECIBO') {
      const rc = parseRecibo(texto);
      await guardarExtraccion(doc.id, 'RECIBO', confianza, {
        emisor: rc.emisor, rutEmisor: rc.rutEmisor, serie: rc.serie, numero: rc.numero,
        fecha: rc.fecha, moneda: rc.moneda, total: rc.total,
        resumen: `Recibo ${rc.serie ?? ''}${rc.numero ?? ''} · ${rc.emisor ?? ''} · ${rc.moneda} ${(rc.total ?? 0).toLocaleString('es-UY')}`,
        datos: rc,
      });
      otros += 1;
    } else if (tipo === 'CERTIFICADO_ORIGEN') {
      const co = parseCertificadoOrigen(texto);
      await guardarExtraccion(doc.id, 'CERTIFICADO_ORIGEN', confianza, {
        numero: co.numero, moneda: null, total: null,
        resumen: `Certificado de origen ${co.numero ?? ''} · ${co.acuerdo ?? ''} · origen ${co.paisOrigen ?? '—'}`,
        datos: co,
      });
      otros += 1;
    } else if (tipo === 'AUTORIZACION') {
      await guardarExtraccion(doc.id, 'AUTORIZACION', confianza, {
        moneda: null, total: null,
        resumen: 'Autorización al despachante para actuar ante la Aduana (DNA)',
        datos: { nota: 'Autorización de representación ante la Dirección Nacional de Aduanas.' },
      });
      otros += 1;
    } else if (tipo === 'DOC_TRANSPORTE') {
      await guardarExtraccion(doc.id, 'DOC_TRANSPORTE', confianza, {
        moneda: null, total: null,
        resumen: 'Documento de transporte (conocimiento aéreo / AWB)',
        datos: { nota: 'Conocimiento de transporte. El Nº de AWB se toma del DUA.' },
      });
      otros += 1;
    }
    } // fin for segmentos
  }

  // Venta de exportación detectada (triangulación/tránsito): se persiste como el
  // valor de venta para el encuadre de IRAE. No integra el costo de la mercadería.
  if (exportaciones > 0 && ventaExportacionCtms > 0n) {
    await prisma.importacion.update({ where: { id: importacionId }, data: { valorVentaExportacion: ventaExportacionCtms } });
  }

  // Transferencias: dedup por referencia (SWIFT + comprobante = una sola).
  const consolidadas = consolidarPagos(pagos);
  for (const t of consolidadas) {
    await prisma.importacionTransferencia.create({
      data: {
        importacionId, referencia: t.ref, fecha: fecha(t.fecha), moneda: t.moneda,
        importe: C(t.importe), comision: C(t.comision), totalDebitado: C(t.totalDebitado),
        beneficiario: t.beneficiario, nroDocs: t.docs,
      },
    });
  }

  // Documentación faltante (aviso, no bloquea).
  const faltantes: string[] = [];
  if (facturas === 0) faltantes.push('Falta la factura comercial del proveedor.');
  if (liquidaciones === 0) faltantes.push('Falta la liquidación de gastos del despachante.');
  if (!tiposVistos.has('DUA')) faltantes.push('DUA definitivo pendiente (no se adjuntó el DUA oficial).');
  if (consolidadas.length === 0) faltantes.push('No hay comprobantes de pago/transferencias.');

  // Advertencia por SWIFT sin comprobante (o viceversa).
  for (const t of consolidadas) if (t.docs < 2) advertencias.push(`La transferencia ${t.ref ?? '(s/ref)'} tiene un solo respaldo (falta el SWIFT o el comprobante bancario).`);
  // Venta de exportación detectada (triangulación/tránsito).
  if (exportaciones > 0 && ventaExportacionCtms > 0n) advertencias.push(`Venta de exportación detectada: ${exportaciones} e-Factura(s) de exportación por ${(Number(ventaExportacionCtms) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2 })}. Se tomó como VALOR DE VENTA para el encuadre de IRAE (no integra el costo de la mercadería).`);

  // Recalcular el costeo desde los documentos oficiales (DUA + factura + CFE):
  // CIF, tributos y gastos pasan a reflejar lo realmente declarado/liquidado.
  let costeoActualizado = false;
  if (dua > 0 || facturas > 0) {
    try {
      const rc = await reconstruirCosteoDesdeExtraccion(importacionId);
      costeoActualizado = rc.ok;
      if (rc.regimenAuto === 'TRANSITO') advertencias.push('Régimen detectado automáticamente: TRÁNSITO / re-exportación (el DUA no liquida impuestos de nacionalización o el despachante declara operación de tránsito). Se aplicó el costeo de tránsito: sin tributos de importación ni crédito de IVA, IVA del despachante capitalizado al costo y sin alta en stock.');
      if (rc.ok && rc.estado === 'OK') advertencias.push('Costeo recalculado desde el DUA y la factura: CIF, tributos y gastos reflejan los documentos oficiales.');
      else if (rc.ok && rc.estado === 'PENDIENTE') advertencias.push(`Costeo PENDIENTE (los asientos definitivos quedan bloqueados): ${rc.motivo ?? 'faltan datos para completar el costo'}.`);
    } catch (e) { advertencias.push(`No se pudo recalcular el costeo desde el DUA: ${e instanceof Error ? e.message : 'error'}.`); }
  }

  return {
    docsProcesados, facturas, liquidaciones, transferencias: consolidadas.length,
    dua, facturasServicios, pagosLocales, otros, costeoActualizado, faltantes, advertencias,
  };
}
