/**
 * Procesa los documentos de un expediente: lee cada archivo, lo clasifica,
 * extrae con los parsers deterministas y GUARDA el resultado estructurado
 * (factura + artículos, liquidación + conceptos, transferencias con dedup),
 * enlazado a su documento de origen. Idempotente: reprocesar reemplaza la
 * extracción previa del expediente. Ver docs/importaciones-diseno.md (Etapa 1 sub-3).
 */
import { TipoDocumentoImportacion, EstadoProcesamientoDoc } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { storageService } from './storage.service';
import { textoDelPdf } from './importaciones.pdf-extract.service';
import { GastoImportacionConcepto } from '@prisma/client';
import { construirCosteoHistorico, sanitizarIdentificador, validarTipoCambio, CosteoDocInput } from './importaciones.costeo.service';
import { cotizacionBcu } from './cotizaciones.service';
import {
  clasificarDocumento, parseFacturaComercial, parseLiquidacionDespachante,
  parsePagoExterior, consolidarPagos, TipoDoc, PagoParsed,
  parseDUA, parseFacturaServiciosUY, parsePackingList, parsePagoLocal,
  parseRecibo, parseCertificadoOrigen,
} from './importaciones.parsers.service';

const C = (n: number | null | undefined): bigint => BigInt(Math.round((n ?? 0) * 100));
const fecha = (s: string | null | undefined): Date | null => (s ? new Date(`${s}T00:00:00Z`) : null);

const TIPO_PRISMA: Record<TipoDoc, TipoDocumentoImportacion> = {
  FACTURA_COMERCIAL: TipoDocumentoImportacion.FACTURA_COMERCIAL,
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
async function obtenerTcFiscalOperacion(moneda: string, fecha: Date | null, tcDua: number | null): Promise<number | null> {
  // 1) Cotización cargada por el operador para la fecha (si existe).
  if (fecha) {
    const guardada = await prisma.cotizacion.findFirst({
      where: { monedaOrigen: moneda, tipo: 'CONTABLE', fecha: { lte: fecha } },
      orderBy: { fecha: 'desc' },
    });
    if (guardada && validarTipoCambio(guardada.valor).valido) return guardada.valor;
  }
  // 2) La cotización fiscal del día que informa el DUA (validada estrictamente).
  const vDua = validarTipoCambio(tcDua);
  if (vDua.valido && vDua.valor != null) return vDua.valor;
  // 3) BCU para la fecha exacta de la operación.
  if (fecha) {
    try {
      const fechaStr = fecha.toISOString().slice(0, 10);
      const bcu = await cotizacionBcu(moneda, fechaStr);
      const v = validarTipoCambio(bcu?.venta);
      if (bcu && v.valido && v.valor != null) {
        await prisma.cotizacion.upsert({
          where: { fecha_monedaOrigen_monedaDestino_tipo: { fecha, monedaOrigen: moneda, monedaDestino: 'UYU', tipo: 'CONTABLE' } },
          create: { fecha, monedaOrigen: moneda, monedaDestino: 'UYU', tipo: 'CONTABLE', valor: v.valor, compra: bcu.compra, venta: bcu.venta, fuente: 'BCU' },
          update: { valor: v.valor, compra: bcu.compra, venta: bcu.venta, fuente: 'BCU' },
        });
        return v.valor;
      }
    } catch { /* BCU no disponible → se deja pendiente, sin inventar datos */ }
  }
  return null;
}

/** Cotización fiscal del día (loaded CONTABLE → BCU), SIN usar el TC del DUA.
 *  Para valuar anticipos y servicios en ME a la fecha real de cada pago. */
async function tcFiscalDia(moneda: string, fecha: Date | null): Promise<number | null> {
  return obtenerTcFiscalOperacion(moneda, fecha, null);
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
async function reconstruirCosteoDesdeExtraccion(importacionId: string): Promise<{ ok: boolean; estado?: string; motivo?: string }> {
  const imp = await prisma.importacion.findUnique({ where: { id: importacionId } });
  if (!imp || imp.estado === 'ANULADA') return { ok: false };
  const [duaEx, serviciosEx, factura, pagoTrib, transferencias, recibos, packingEx] = await Promise.all([
    prisma.importacionDocExtraccion.findFirst({ where: { importacionId, tipo: 'DUA' } }),
    prisma.importacionDocExtraccion.findMany({ where: { importacionId, tipo: 'FACTURA_SERVICIOS_UY' } }),
    prisma.importacionFactura.findFirst({ where: { importacionId }, include: { articulos: { orderBy: { nro: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
    prisma.importacionDocExtraccion.findFirst({ where: { importacionId, tipo: 'PAGO_TRIBUTOS' } }),
    prisma.importacionTransferencia.findMany({ where: { importacionId }, orderBy: { fecha: 'asc' } }),
    prisma.importacionDocExtraccion.findMany({ where: { importacionId, tipo: 'RECIBO' } }),
    prisma.importacionDocExtraccion.findFirst({ where: { importacionId, tipo: 'PACKING_LIST' } }),
  ]);
  if (!duaEx) return { ok: false };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = duaEx.datos ?? {};
  const moneda: string = imp.monedaOrigen || d.moneda || 'USD';
  const tcAdVal = validarTipoCambio(d.tipoCambio);
  const duaDate = d.fechaPago ? new Date(`${d.fechaPago}T00:00:00Z`) : (factura?.fecha ?? null);
  const iso = (dd: Date | null) => (dd ? dd.toISOString().slice(0, 10) : null);

  // Anticipos al proveedor: cada transferencia a su cotización fiscal del día de pago.
  const anticipos = await Promise.all(transferencias.map(async (t) => {
    const cot = await tcFiscalDia(t.moneda, t.fecha);
    return { fecha: iso(t.fecha), referencia: t.referencia, moneda: t.moneda, monto: Number(t.importe) / 100, comision: Number(t.comision) / 100, cotizacion: cot };
  }));
  // Servicios con su fecha y, si están en ME, su cotización.
  const servicios = await Promise.all(serviciosEx.map(async (s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sd: any = s.datos ?? {};
    const esUsd = (sd.moneda ?? '').toUpperCase() === 'USD';
    const cot = esUsd ? await tcFiscalDia(sd.moneda, s.fecha) : null;
    const primeraLinea = Array.isArray(sd.lineas) && sd.lineas[0] ? String(sd.lineas[0].descripcion ?? '') : '';
    return { rutComprador: sd.rutComprador ?? null, rutEmisor: sd.rutEmisor ?? s.rutEmisor ?? null, moneda: sd.moneda ?? null, serie: sd.serie ?? null, numero: sd.numero ?? null, emisor: s.emisor, honorarios: sd.honorarios ?? null, gastosOperativos: sd.gastosOperativos ?? null, iva: sd.iva ?? null, total: sd.total ?? null, noFacturable: sd.noFacturable ?? null, concepto: primeraLinea, fecha: iso(s.fecha), cotizacion: cot };
  }));
  // Pago al despachante: recibo emitido por el despachante (RUT declarante).
  const reciboDesp = recibos.find((rc) => rc.rutEmisor && d.declaranteRut && rc.rutEmisor === d.declaranteRut) ?? recibos[0] ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unidadesPacking: number | null = (packingEx?.datos as any)?.cantidadTotal ?? null;
  // Cotización fiscal de la fecha de reconocimiento (día de la operación).
  const cotReconoc = await obtenerTcFiscalOperacion(moneda, duaDate, tcAdVal.valor);

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
      articulos: factura.articulos.map((a) => ({ descripcion: a.descripcion || a.codigo || 'Ítem', codigo: a.codigo, cantidad: a.cantidad || 1, total: a.total })),
    } : null,
    servicios, anticipos,
    pagoSpeCtms: pagoTrib ? pagoTrib.total : null,
    pagoDespachanteCtms: reciboDesp ? reciboDesp.total : null,
    fechaReconocimiento: iso(duaDate), cotizacionReconocimiento: cotReconoc, tcProvisional: tcAdVal.valor,
    unidadesPacking,
    etiqueta: (k) => k, // en el informe/asiento se re-etiqueta con el plan de cuentas
  });
  const ncm: string | null = d.ncm ?? null;
  // TC representativo para el cabezal (varios si hay anticipos en distintas fechas).
  const tcRepresentativo = anticipos.length === 1 ? (anticipos[0].cotizacion ?? null) : (cotReconoc ?? null);
  const costeoDetalle = JSON.parse(JSON.stringify(r, bigintReplacer));

  await prisma.$transaction([
    prisma.itemImportacion.deleteMany({ where: { importacionId } }),
    prisma.tributoImportacion.deleteMany({ where: { importacionId } }),
    prisma.gastoImportacion.deleteMany({ where: { importacionId } }),
    prisma.importacion.update({
      where: { id: importacionId },
      data: {
        proveedorExterior: sanitizarIdentificador(d.proveedor) ?? imp.proveedorExterior,
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
        items: { create: (r.items ?? []).map((i) => ({ descripcion: i.descripcion, ncm, cantidad: i.cantidad, fobUnitario: i.cantidad ? i.fobME / BigInt(Math.max(1, Math.round(i.cantidad))) : i.fobME, fobTotal: i.fobME, costoProrrateado: i.costo })) },
        tributos: { create: r.tributos.map((t) => ({ tipo: t.tipo, baseImponible: 0n, tasa: 0, monto: t.monto, recuperable: t.recuperable })) },
        gastos: { create: r.gastos.filter((g) => g.incluidoEnCosto).map((g) => ({ concepto: /honorario/i.test(g.concepto) ? GastoImportacionConcepto.HONORARIOS_DESPACHANTE : GastoImportacionConcepto.OTRO, descripcion: `${g.documento}: ${g.concepto}`, monto: g.montoUYU, gravadoIva: g.gravado, ivaGasto: g.ivaUYU })) },
      },
    }),
  ]);
  return { ok: true, estado: r.estado, motivo: r.motivos.join(' · ') };
}

export async function procesarExpediente(importacionId: string): Promise<ProcesarResultado> {
  const docs = await prisma.importacionDocumento.findMany({ where: { importacionId } });
  const advertencias: string[] = [];

  // Reproceso idempotente: borrar la extracción previa del expediente.
  await prisma.importacionFactura.deleteMany({ where: { importacionId } });
  await prisma.importacionLiquidacion.deleteMany({ where: { importacionId } });
  await prisma.importacionTransferencia.deleteMany({ where: { importacionId } });
  await prisma.importacionDocExtraccion.deleteMany({ where: { importacionId } });

  let facturas = 0, liquidaciones = 0, docsProcesados = 0;
  let dua = 0, facturasServicios = 0, pagosLocales = 0, otros = 0;
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

  for (const doc of docs) {
    if (doc.mimeType !== 'application/pdf') {
      await prisma.importacionDocumento.update({ where: { id: doc.id }, data: { estadoProc: EstadoProcesamientoDoc.PENDIENTE, errorProc: 'Requiere OCR (no es PDF con texto) — próxima etapa' } });
      continue;
    }
    let texto = '';
    try { texto = await storageService.read(doc.storageKey).then((b) => textoDelPdf(b)); }
    catch { await prisma.importacionDocumento.update({ where: { id: doc.id }, data: { estadoProc: EstadoProcesamientoDoc.ERROR, errorProc: 'No se pudo leer el PDF' } }); continue; }

    const { tipo, confianza } = clasificarDocumento(texto);
    tiposVistos.add(tipo);

    // PDF escaneado sin capa de texto (p. ej. conocimiento aéreo): no se puede
    // leer sin OCR. Se deja PENDIENTE con aviso; el AWB ya se obtiene del DUA.
    if (texto.trim().length < 40) {
      await prisma.importacionDocumento.update({ where: { id: doc.id }, data: { tipoDetectado: TIPO_PRISMA[tipo], confianzaTipo: confianza, estadoProc: EstadoProcesamientoDoc.PENDIENTE, errorProc: 'PDF escaneado sin texto — requiere OCR (el Nº de AWB ya se toma del DUA)' } });
      advertencias.push(`"${doc.fileName}" parece escaneado (sin texto): no se pudo leer automáticamente; se requeriría OCR.`);
      continue;
    }

    await prisma.importacionDocumento.update({ where: { id: doc.id }, data: { tipoDetectado: TIPO_PRISMA[tipo], confianzaTipo: confianza, estadoProc: EstadoProcesamientoDoc.PROCESADO, errorProc: null } });
    docsProcesados += 1;

    if (tipo === 'FACTURA_COMERCIAL') {
      const f = parseFacturaComercial(texto);
      await prisma.importacionFactura.create({
        data: {
          importacionId, documentoId: doc.id,
          proveedor: f.proveedor, cuit: f.cuit, numero: f.numero, fecha: fecha(f.fecha),
          moneda: f.moneda, incoterm: f.incoterm,
          fob: C(f.fob), flete: C(f.flete), seguro: C(f.seguro), cif: C(f.cif), total: C(f.total),
          confianza,
          articulos: { create: f.articulos.map((a) => ({ nro: a.nro, codigo: a.codigo, descripcion: a.descripcion, cantidad: a.cantidad, precioUnit: a.precioUnit, total: C(a.total) })) },
        },
      });
      facturas += 1;
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
      const s = parseFacturaServiciosUY(texto);
      await guardarExtraccion(doc.id, 'FACTURA_SERVICIOS_UY', confianza, {
        emisor: s.emisor, rutEmisor: s.rutEmisor, serie: s.serie, numero: s.numero,
        fecha: s.fecha, moneda: s.moneda, total: s.total,
        resumen: `${s.emisor ?? 'Servicio UY'} · ${s.tipoDoc} ${s.serie ?? ''}${s.numero ?? ''} · ${s.moneda} ${(s.total ?? 0).toLocaleString('es-UY')}`,
        datos: s,
      });
      facturasServicios += 1;
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

  // Recalcular el costeo desde los documentos oficiales (DUA + factura + CFE):
  // CIF, tributos y gastos pasan a reflejar lo realmente declarado/liquidado.
  let costeoActualizado = false;
  if (dua > 0) {
    try {
      const rc = await reconstruirCosteoDesdeExtraccion(importacionId);
      costeoActualizado = rc.ok;
      if (rc.ok && rc.estado === 'OK') advertencias.push('Costeo recalculado desde el DUA y la factura: CIF, tributos y gastos reflejan los documentos oficiales.');
      else if (rc.ok && rc.estado === 'PENDIENTE') advertencias.push(`Costeo PENDIENTE (los asientos definitivos quedan bloqueados): ${rc.motivo ?? 'faltan datos para completar el costo'}.`);
    } catch (e) { advertencias.push(`No se pudo recalcular el costeo desde el DUA: ${e instanceof Error ? e.message : 'error'}.`); }
  }

  return {
    docsProcesados, facturas, liquidaciones, transferencias: consolidadas.length,
    dua, facturasServicios, pagosLocales, otros, costeoActualizado, faltantes, advertencias,
  };
}
