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
  faltantes: string[];
  advertencias: string[];
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

  return {
    docsProcesados, facturas, liquidaciones, transferencias: consolidadas.length,
    dua, facturasServicios, pagosLocales, otros, faltantes, advertencias,
  };
}
