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
  OTRO: TipoDocumentoImportacion.OTRO,
};

export interface ProcesarResultado {
  docsProcesados: number;
  facturas: number;
  liquidaciones: number;
  transferencias: number;
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

  let facturas = 0, liquidaciones = 0, docsProcesados = 0;
  const pagos: Array<PagoParsed & { tipos: TipoDoc }> = [];
  const tiposVistos = new Set<TipoDoc>();

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

  return { docsProcesados, facturas, liquidaciones, transferencias: consolidadas.length, faltantes, advertencias };
}
