/**
 * Procesa los documentos de un expediente: lee cada archivo, lo clasifica,
 * extrae con los parsers deterministas y GUARDA el resultado estructurado
 * (factura + artículos, liquidación + conceptos, transferencias con dedup),
 * enlazado a su documento de origen. Idempotente: reprocesar reemplaza la
 * extracción previa del expediente. Ver docs/importaciones-diseno.md (Etapa 1 sub-3).
 */
import { TipoDocumentoImportacion, EstadoProcesamientoDoc, TributoImportacionTipo, GastoImportacionConcepto } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { storageService } from './storage.service';
import { textoDelPdf } from './importaciones.pdf-extract.service';
import { calcularCosteo, esTributoRecuperable } from './importaciones.service';
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

// Mapeo de los códigos de tributo del DUA a los tipos del costeo.
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

/**
 * Recalcula el COSTEO del expediente a partir de los documentos oficiales ya
 * extraídos (DUA + factura comercial + e-facturas de servicios), que son la
 * fuente autorizada. Lleva todo a PESOS con el tipo de cambio del DUA:
 *   · CIF = Valor en Aduana del DUA (FOB/flete/seguro de la factura × TC).
 *   · Tributos = los LIQUIDADOS en el DUA (importes exactos, no recalculados).
 *   · Gastos de plaza = honorarios + gastos operativos (gravados) y los demás
 *     servicios facturados AL IMPORTADOR (terminal, agencia), sin duplicar los
 *     tributos (que ya vienen del DUA) ni los servicios facturados al despachante.
 *   · Ítems = los artículos de la factura (FOB × TC), para la distribución.
 * Reemplaza tributos/gastos/ítems y actualiza el cabezal. Requiere DUA presente.
 */
async function reconstruirCosteoDesdeExtraccion(importacionId: string): Promise<boolean> {
  const imp = await prisma.importacion.findUnique({ where: { id: importacionId } });
  if (!imp || imp.estado === 'ANULADA') return false;
  const [duaEx, serviciosEx, factura] = await Promise.all([
    prisma.importacionDocExtraccion.findFirst({ where: { importacionId, tipo: 'DUA' } }),
    prisma.importacionDocExtraccion.findMany({ where: { importacionId, tipo: 'FACTURA_SERVICIOS_UY' } }),
    prisma.importacionFactura.findFirst({ where: { importacionId }, include: { articulos: { orderBy: { nro: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (!duaEx) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = duaEx.datos ?? {};
  const tc = Number(d.tipoCambio) || imp.tipoCambio || 1;
  const importadorRut: string | null = d.importadorRut ?? null;
  const P = (pesos: number | null | undefined): bigint => BigInt(Math.round((pesos ?? 0) * 100)); // pesos → centésimos
  const usdCtmsAPesos = (ctmsUsd: bigint): bigint => BigInt(Math.round(Number(ctmsUsd) * tc)); // centésimos USD → centésimos pesos

  // CIF en pesos: el valor en Aduana del DUA manda; FOB/flete de la factura×TC y
  // el seguro absorbe el redondeo para que FOB+flete+seguro = Valor en Aduana.
  const cifPesos = d.valorAduanaPesos != null ? P(d.valorAduanaPesos) : (factura ? usdCtmsAPesos(factura.fob + factura.flete + factura.seguro) : 0n);
  const fobPesos = factura ? usdCtmsAPesos(factura.fob) : cifPesos;
  const fletePesos = factura ? usdCtmsAPesos(factura.flete) : 0n;
  const seguroPesos = factura ? (cifPesos - fobPesos - fletePesos) : 0n;

  // Tributos: los importes LIQUIDADOS en el DUA (pesos enteros).
  const tributos: Array<{ tipo: TributoImportacionTipo; baseImponible: bigint; tasa: number; monto: bigint; recuperable: boolean }> =
    (d.tributos ?? []).map((t: { codigo: string; monto: number }) => {
      const tipo = DUA_TRIB_TIPO[t.codigo] ?? TributoImportacionTipo.OTRO;
      return { tipo, baseImponible: 0n, tasa: 0, monto: P(t.monto), recuperable: esTributoRecuperable(tipo) };
    });

  // Gastos de plaza: solo los facturados AL IMPORTADOR (evita duplicar la factura
  // del terminal que el despachante re-cobra). El "no facturable" del despachante
  // = tributos, ya contemplados arriba, por eso NO se suma como gasto.
  const gastos: Array<{ concepto: GastoImportacionConcepto; descripcion: string; monto: bigint; gravadoIva: boolean; ivaGasto: bigint }> = [];
  for (const s of serviciosEx) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sd: any = s.datos ?? {};
    if (importadorRut && sd.rutComprador && sd.rutComprador !== importadorRut) continue; // facturado a un tercero (p. ej. al despachante)
    const factor = (sd.moneda === 'USD') ? tc : 1;
    const hon = Number(sd.honorarios) || 0;
    const gop = Number(sd.gastosOperativos) || 0;
    if (hon || gop) {
      const iva = Number(sd.iva) || 0;
      gastos.push({ concepto: GastoImportacionConcepto.HONORARIOS_DESPACHANTE, descripcion: `Honorarios y gastos del despachante${sd.serie ? ` (${sd.serie}${sd.numero ?? ''})` : ''}`, monto: P((hon + gop) * factor), gravadoIva: true, ivaGasto: P(iva * factor) });
    } else {
      const total = Number(sd.total) || 0;
      if (total > 0) gastos.push({ concepto: GastoImportacionConcepto.OTRO, descripcion: `${s.emisor ?? 'Servicio de plaza'}${sd.serie ? ` (${sd.serie}${sd.numero ?? ''})` : ''}`, monto: P(total * factor), gravadoIva: (Number(sd.iva) || 0) > 0, ivaGasto: P((Number(sd.iva) || 0) * factor) });
    }
  }

  // Ítems: artículos de la factura, FOB total en pesos.
  const items = (factura?.articulos ?? []).map((a) => ({
    descripcion: a.descripcion || a.codigo || 'Ítem',
    ncm: d.ncm ?? null,
    cantidad: a.cantidad || 1,
    fobUnitario: a.cantidad ? usdCtmsAPesos(a.total) / BigInt(Math.max(1, Math.round(a.cantidad))) : usdCtmsAPesos(a.total),
    fobTotal: usdCtmsAPesos(a.total),
  }));

  const costeo = calcularCosteo({
    fob: fobPesos, flete: fletePesos, seguro: seguroPesos,
    tributos: tributos.map((t) => ({ tipo: t.tipo, monto: t.monto })),
    gastos: gastos.map((g) => ({ monto: g.monto, ivaGasto: g.ivaGasto })),
    items: items.map((i) => ({ fobTotal: i.fobTotal })),
  });

  await prisma.$transaction([
    prisma.itemImportacion.deleteMany({ where: { importacionId } }),
    prisma.tributoImportacion.deleteMany({ where: { importacionId } }),
    prisma.gastoImportacion.deleteMany({ where: { importacionId } }),
    prisma.importacion.update({
      where: { id: importacionId },
      data: {
        proveedorExterior: d.proveedor ?? imp.proveedorExterior,
        paisOrigen: d.paisOrigen ?? imp.paisOrigen,
        monedaOrigen: d.moneda ?? imp.monedaOrigen,
        tipoCambio: tc,
        duaNumero: d.nroDua ?? imp.duaNumero,
        duaFecha: d.fechaPago ? new Date(`${d.fechaPago}T00:00:00Z`) : imp.duaFecha,
        aduana: d.aduana ?? imp.aduana,
        transporteDoc: d.awb ? `AWB ${d.awb}` : imp.transporteDoc,
        facturaComercialNro: factura?.numero ?? imp.facturaComercialNro,
        facturaComercialFecha: factura?.fecha ?? imp.facturaComercialFecha,
        fob: fobPesos, flete: fletePesos, seguro: seguroPesos, cif: costeo.cif,
        totalTributos: costeo.totalTributos, totalGastos: costeo.totalGastos,
        costoMercaderia: costeo.costoMercaderia, creditoFiscalIva: costeo.creditoFiscalIva, anticipos: costeo.anticipos,
        items: { create: items.map((i, idx) => ({ ...i, costoProrrateado: costeo.costosItems[idx] ?? 0n })) },
        tributos: { create: tributos },
        gastos: { create: gastos },
      },
    }),
  ]);
  return true;
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
    try { costeoActualizado = await reconstruirCosteoDesdeExtraccion(importacionId); }
    catch (e) { advertencias.push(`No se pudo recalcular el costeo desde el DUA: ${e instanceof Error ? e.message : 'error'}.`); }
    if (costeoActualizado) advertencias.push('Costeo recalculado desde el DUA y la factura: CIF, tributos y gastos ahora reflejan los documentos oficiales.');
  }

  return {
    docsProcesados, facturas, liquidaciones, transferencias: consolidadas.length,
    dua, facturasServicios, pagosLocales, otros, costeoActualizado, faltantes, advertencias,
  };
}
