// IMPORTACIONES (comercio exterior) — registro de operaciones de importación de
// mercadería por empresa (multiempresa). CRUD con costeo según normativa UY;
// toda operación valida el acceso a la empresa dueña (anti-IDOR) y audita.
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { createHash } from 'crypto';
import {
  UserRole, Prisma,
  ImportacionEstado, ImportacionRegimen,
  TributoImportacionTipo, GastoImportacionConcepto,
  EstadoProcesamientoDoc, CotizacionTipo,
} from '@prisma/client';
import { storageService, safeFileName } from '../services/storage.service';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import * as XLSX from 'xlsx';
import { recordAudit } from '../services/audit.service';
import { calcularCosteo, esTributoRecuperable, armarAsientoImportacion } from '../services/importaciones.service';
import { generateInformePDF, costeoFilename } from '../services/importaciones.pdf.service';
import { parseImportacionesExcel, buildPlantillaImportaciones, ImportacionImportData } from '../services/importaciones.import.service';
import { extraerImportacionDesdePdf, contarPaginasPdf, textoDelPdf } from '../services/importaciones.pdf-extract.service';
import { clasificarDocumento, parseFacturaComercial, parseLiquidacionDespachante, parsePagoExterior } from '../services/importaciones.parsers.service';
import { procesarExpediente } from '../services/importaciones.procesar.service';
import { CUENTAS_IMPORTACION, PlanCuentas } from '../services/importaciones.config.service';
import { cotizacionBcu, BCU_MONEDA } from '../services/cotizaciones.service';

export const importacionesRouter = Router();

// Todo el módulo es interno del estudio: solo ADMIN/OPERATOR.
importacionesRouter.use(authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR));

const uploadXls = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadDocs = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 30 } });

// ── Helpers ──────────────────────────────────────────────────────────────────
const money = z.number().nonnegative(); // pesos (se convierten a centésimos)
function ctms(pesos?: number | null): bigint {
  return BigInt(Math.round((pesos ?? 0) * 100));
}
function toFecha(s?: string | null): Date | null {
  return s ? new Date(`${s}T00:00:00Z`) : null;
}
function fechaStr(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

const itemSchema = z.object({
  descripcion: z.string().min(1),
  ncm: z.string().optional().nullable(),
  cantidad: z.number().optional(),
  fobUnitario: money.optional(),
  fobTotal: money.optional(),
});
const tributoSchema = z.object({
  tipo: z.nativeEnum(TributoImportacionTipo),
  baseImponible: money.optional(),
  tasa: z.number().optional(),
  monto: money.optional(),
  recuperable: z.boolean().optional(),
});
const gastoSchema = z.object({
  concepto: z.nativeEnum(GastoImportacionConcepto),
  descripcion: z.string().optional().nullable(),
  monto: money.optional(),
  gravadoIva: z.boolean().optional(),
  ivaGasto: money.optional(),
});
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable();

const importacionSchema = z.object({
  companyId: z.string().cuid(),
  estado: z.nativeEnum(ImportacionEstado).optional(),
  regimen: z.nativeEnum(ImportacionRegimen).optional(),
  proveedorExterior: z.string().optional().nullable(),
  paisOrigen: z.string().optional().nullable(),
  incoterm: z.string().optional().nullable(),
  monedaOrigen: z.string().optional(),
  tipoCambio: z.number().positive().optional(),
  facturaComercialNro: z.string().optional().nullable(),
  facturaComercialFecha: fecha,
  duaNumero: z.string().optional().nullable(),
  duaFecha: fecha,
  despachante: z.string().optional().nullable(),
  aduana: z.string().optional().nullable(),
  transporteDoc: z.string().optional().nullable(),
  certificadoOrigen: z.boolean().optional(),
  fechaEmbarque: fecha,
  fechaArribo: fecha,
  fechaNacionalizacion: fecha,
  fob: money.optional(),
  flete: money.optional(),
  seguro: money.optional(),
  notas: z.string().optional().nullable(),
  items: z.array(itemSchema).optional(),
  tributos: z.array(tributoSchema).optional(),
  gastos: z.array(gastoSchema).optional(),
});

type ImportacionConLineas = Prisma.ImportacionGetPayload<{
  include: { items: true; tributos: true; gastos: true };
}>;

function serializar(imp: ImportacionConLineas) {
  return {
    ...imp,
    fob: imp.fob.toString(),
    flete: imp.flete.toString(),
    seguro: imp.seguro.toString(),
    cif: imp.cif.toString(),
    totalTributos: imp.totalTributos.toString(),
    totalGastos: imp.totalGastos.toString(),
    costoMercaderia: imp.costoMercaderia.toString(),
    creditoFiscalIva: imp.creditoFiscalIva.toString(),
    anticipos: imp.anticipos.toString(),
    facturaComercialFecha: fechaStr(imp.facturaComercialFecha),
    duaFecha: fechaStr(imp.duaFecha),
    fechaEmbarque: fechaStr(imp.fechaEmbarque),
    fechaArribo: fechaStr(imp.fechaArribo),
    fechaNacionalizacion: fechaStr(imp.fechaNacionalizacion),
    items: imp.items.map((i) => ({
      ...i,
      fobUnitario: i.fobUnitario.toString(),
      fobTotal: i.fobTotal.toString(),
      costoProrrateado: i.costoProrrateado.toString(),
    })),
    tributos: imp.tributos.map((t) => ({
      ...t,
      baseImponible: t.baseImponible.toString(),
      monto: t.monto.toString(),
    })),
    gastos: imp.gastos.map((g) => ({
      ...g,
      monto: g.monto.toString(),
      ivaGasto: g.ivaGasto.toString(),
    })),
  };
}

// Arma las líneas (con costeo) y los totales derivados a partir del body ya parseado.
function construirDatos(data: z.infer<typeof importacionSchema>) {
  const fobTotalDe = (it: z.infer<typeof itemSchema>) =>
    it.fobTotal != null ? ctms(it.fobTotal) : ctms((it.fobUnitario ?? 0) * (it.cantidad ?? 1));

  const itemsCtms = (data.items ?? []).map((it) => ({
    descripcion: it.descripcion,
    ncm: it.ncm ?? null,
    cantidad: it.cantidad ?? 1,
    fobUnitario: ctms(it.fobUnitario),
    fobTotal: fobTotalDe(it),
  }));
  const tributosCtms = (data.tributos ?? []).map((t) => ({
    tipo: t.tipo,
    baseImponible: ctms(t.baseImponible),
    tasa: t.tasa ?? 0,
    monto: ctms(t.monto),
    recuperable: t.recuperable ?? esTributoRecuperable(t.tipo),
  }));
  const gastosCtms = (data.gastos ?? []).map((g) => ({
    concepto: g.concepto,
    descripcion: g.descripcion ?? null,
    monto: ctms(g.monto),
    gravadoIva: g.gravadoIva ?? false,
    ivaGasto: ctms(g.ivaGasto),
  }));

  const costeo = calcularCosteo({
    fob: ctms(data.fob),
    flete: ctms(data.flete),
    seguro: ctms(data.seguro),
    tributos: tributosCtms,
    gastos: gastosCtms,
    items: itemsCtms.map((i) => ({ fobTotal: i.fobTotal })),
  });

  const items = itemsCtms.map((i, idx) => ({ ...i, costoProrrateado: costeo.costosItems[idx] ?? 0n }));

  return {
    cabezal: {
      regimen: data.regimen ?? ImportacionRegimen.DEFINITIVA,
      proveedorExterior: data.proveedorExterior ?? null,
      paisOrigen: data.paisOrigen ?? null,
      incoterm: data.incoterm ?? null,
      monedaOrigen: data.monedaOrigen ?? 'USD',
      tipoCambio: data.tipoCambio ?? 1,
      facturaComercialNro: data.facturaComercialNro ?? null,
      facturaComercialFecha: toFecha(data.facturaComercialFecha),
      duaNumero: data.duaNumero ?? null,
      duaFecha: toFecha(data.duaFecha),
      despachante: data.despachante ?? null,
      aduana: data.aduana ?? null,
      transporteDoc: data.transporteDoc ?? null,
      certificadoOrigen: data.certificadoOrigen ?? false,
      fechaEmbarque: toFecha(data.fechaEmbarque),
      fechaArribo: toFecha(data.fechaArribo),
      fechaNacionalizacion: toFecha(data.fechaNacionalizacion),
      fob: ctms(data.fob),
      flete: ctms(data.flete),
      seguro: ctms(data.seguro),
      cif: costeo.cif,
      totalTributos: costeo.totalTributos,
      totalGastos: costeo.totalGastos,
      costoMercaderia: costeo.costoMercaderia,
      creditoFiscalIva: costeo.creditoFiscalIva,
      anticipos: costeo.anticipos,
      notas: data.notas ?? null,
    },
    items,
    tributos: tributosCtms,
    gastos: gastosCtms,
  };
}

const incluir = { items: true, tributos: true, gastos: true } as const;

// ── GET / — lista de importaciones de una empresa ────────────────────────────
importacionesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const incluirAnuladas = req.query.incluirAnuladas === 'true';
    const importaciones = await prisma.importacion.findMany({
      where: { companyId, ...(incluirAnuladas ? {} : { estado: { not: ImportacionEstado.ANULADA } }) },
      include: incluir,
      orderBy: [{ duaFecha: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(importaciones.map(serializar));
  } catch (err) { next(err); }
});

// ── Cotizaciones (Etapa 2 §6) — tipos de cambio por fecha/moneda/tipo ────────
function serializarCot(c: {
  id: string; fecha: Date; monedaOrigen: string; monedaDestino: string; tipo: string;
  valor: number; compra: number | null; venta: number | null; fuente: string;
  fechaConsulta: Date; confirmadoPor: string | null;
}) {
  return { ...c, fecha: c.fecha.toISOString().slice(0, 10), fechaConsulta: c.fechaConsulta.toISOString() };
}

// GET /cotizaciones?moneda=&desde=&hasta=&tipo= → lista (global).
importacionesRouter.get('/cotizaciones', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const moneda = req.query.moneda as string | undefined;
    const tipo = req.query.tipo as CotizacionTipo | undefined;
    const desde = req.query.desde as string | undefined;
    const hasta = req.query.hasta as string | undefined;
    const where: Prisma.CotizacionWhereInput = {};
    if (moneda) where.monedaOrigen = moneda.toUpperCase();
    if (tipo) where.tipo = tipo;
    if (desde || hasta) where.fecha = { ...(desde ? { gte: new Date(`${desde}T00:00:00Z`) } : {}), ...(hasta ? { lte: new Date(`${hasta}T00:00:00Z`) } : {}) };
    const cots = await prisma.cotizacion.findMany({ where, orderBy: [{ fecha: 'desc' }, { monedaOrigen: 'asc' }], take: 500 });
    res.json({ cotizaciones: cots.map(serializarCot), monedasBcu: Object.keys(BCU_MONEDA) });
  } catch (err) { next(err); }
});

const cotManualSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monedaOrigen: z.string().min(1),
  monedaDestino: z.string().optional(),
  tipo: z.nativeEnum(CotizacionTipo),
  valor: z.number().positive(),
  compra: z.number().positive().optional(),
  venta: z.number().positive().optional(),
});

// POST /cotizaciones → alta/edición manual (fuente MANUAL).
importacionesRouter.post('/cotizaciones', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = cotManualSchema.parse(req.body);
    const clave = { fecha: new Date(`${d.fecha}T00:00:00Z`), monedaOrigen: d.monedaOrigen.toUpperCase(), monedaDestino: (d.monedaDestino ?? 'UYU').toUpperCase(), tipo: d.tipo };
    const cot = await prisma.cotizacion.upsert({
      where: { fecha_monedaOrigen_monedaDestino_tipo: clave },
      create: { ...clave, valor: d.valor, compra: d.compra ?? null, venta: d.venta ?? null, fuente: 'MANUAL', confirmadoPor: req.user?.userId ?? null },
      update: { valor: d.valor, compra: d.compra ?? null, venta: d.venta ?? null, fuente: 'MANUAL', confirmadoPor: req.user?.userId ?? null, fechaConsulta: new Date() },
    });
    await recordAudit({ req, action: 'COTIZACION_MANUAL', entity: 'cotizacion', entityId: cot.id, newData: { moneda: cot.monedaOrigen, fecha: d.fecha, valor: d.valor } });
    res.json(serializarCot(cot));
  } catch (err) { next(err); }
});

// POST /cotizaciones/bcu → traer del BCU para {moneda, fecha, tipo} y guardar.
importacionesRouter.post('/cotizaciones/bcu', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { moneda, fecha, tipo } = z.object({
      moneda: z.string().min(1), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), tipo: z.nativeEnum(CotizacionTipo),
    }).parse(req.body);
    const dato = await cotizacionBcu(moneda, fecha);
    if (!dato) throw new AppError(404, `El BCU no tiene cotización de ${moneda.toUpperCase()} para el ${fecha} (feriado, fin de semana, fecha futura o moneda sin código).`);
    const clave = { fecha: new Date(`${dato.fecha}T00:00:00Z`), monedaOrigen: dato.moneda, monedaDestino: 'UYU', tipo };
    const cot = await prisma.cotizacion.upsert({
      where: { fecha_monedaOrigen_monedaDestino_tipo: clave },
      create: { ...clave, valor: dato.venta, compra: dato.compra, venta: dato.venta, fuente: 'BCU', confirmadoPor: req.user?.userId ?? null },
      update: { valor: dato.venta, compra: dato.compra, venta: dato.venta, fuente: 'BCU', confirmadoPor: req.user?.userId ?? null, fechaConsulta: new Date() },
    });
    await recordAudit({ req, action: 'COTIZACION_BCU', entity: 'cotizacion', entityId: cot.id, newData: { moneda: cot.monedaOrigen, fecha: dato.fecha, valor: dato.venta } });
    res.json(serializarCot(cot));
  } catch (err) { next(err); }
});

// DELETE /cotizaciones/:id
importacionesRouter.delete('/cotizaciones/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.cotizacion.delete({ where: { id: req.params.id } });
    res.json({ message: 'Cotización eliminada' });
  } catch (err) { next(err); }
});

// ── Configuración fiscal y contable de la empresa (Etapa 2 §3) ───────────────
const cuentaCfgSchema = z.object({ codigo: z.string().nullable().optional(), nombre: z.string().nullable().optional() });
const configSchema = z.object({
  companyId: z.string().cuid(),
  iraeRegimen: z.string().nullable().optional(),
  ivaRegimen: z.string().nullable().optional(),
  grupoCede: z.string().nullable().optional(),
  formularioDgi: z.string().nullable().optional(),
  tipoActividad: z.string().nullable().optional(),
  porcentajeDeduccionIva: z.number().nullable().optional(),
  marcoContable: z.string().nullable().optional(),
  metodoCosteo: z.string().nullable().optional(),
  politicaDistribucion: z.string().nullable().optional(),
  tratamientoMoneda: z.string().nullable().optional(),
  monedaFuncional: z.string().optional(),
  monedaPresentacion: z.string().optional(),
  cierreEjercicio: z.string().nullable().optional(),
  inicioActividad: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  planCuentas: z.record(cuentaCfgSchema).nullable().optional(),
});

// GET /config?companyId= → configuración (o null) + catálogo canónico de cuentas.
importacionesRouter.get('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const cfg = await prisma.importacionEmpresaConfig.findUnique({ where: { companyId } });
    res.json({
      config: cfg ? { ...cfg, inicioActividad: cfg.inicioActividad ? cfg.inicioActividad.toISOString().slice(0, 10) : null } : null,
      catalogoCuentas: CUENTAS_IMPORTACION,
    });
  } catch (err) { next(err); }
});

// PUT /config → crea o actualiza la configuración de la empresa.
importacionesRouter.put('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = configSchema.parse(req.body);
    await assertCompanyAccess(req, data.companyId);
    const { companyId, inicioActividad, planCuentas, ...rest } = data;
    const payload = {
      ...rest,
      inicioActividad: inicioActividad ? new Date(`${inicioActividad}T00:00:00Z`) : null,
      planCuentas: (planCuentas ?? undefined) as Prisma.InputJsonValue | undefined,
    };
    const cfg = await prisma.importacionEmpresaConfig.upsert({
      where: { companyId },
      create: { companyId, ...payload },
      update: payload,
    });
    await recordAudit({ req, action: 'IMPORTACION_CONFIG', entity: 'importacion_config', entityId: cfg.id, companyId, newData: { formularioDgi: cfg.formularioDgi } });
    res.json({ ...cfg, inicioActividad: cfg.inicioActividad ? cfg.inicioActividad.toISOString().slice(0, 10) : null });
  } catch (err) { next(err); }
});

// ── GET /clientes — TODAS las empresas del estudio (Sueldos + solo-Tareas) ───
// Importaciones es un módulo interno del estudio (como la Agenda): el operador
// puede registrar importaciones para cualquier cliente, sea de Sueldos o creado
// solo para Tareas. Por eso lista todas las empresas activas. DEBE declararse
// antes de GET /:id.
importacionesRouter.get('/clientes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const incluirInactivas = req.query.incluirInactivas === 'true';
    const empresas = await prisma.company.findMany({
      where: incluirInactivas ? {} : { active: true },
      orderBy: { razonSocial: 'asc' },
      select: { id: true, razonSocial: true, nombreFantasia: true, soloTareas: true, active: true },
    });
    res.json(empresas.map((e) => ({
      companyId: e.id, razonSocial: e.razonSocial, nombreFantasia: e.nombreFantasia,
      soloTareas: e.soloTareas, active: e.active,
    })));
  } catch (err) { next(err); }
});

// ── POST /extraer — leer un archivo y devolver los datos (sin crear nada) ────
// Para autocompletar el formulario de alta. Hoy lee Excel/CSV; el PDF del DUA
// se adjunta pero todavía no se extrae (requiere una muestra del formato real).
importacionesRouter.post('/extraer', uploadXls.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError(400, 'Archivo requerido (campo "file")');
    const nombre = (req.file.originalname || '').toLowerCase();
    const esHoja = /\.(xlsx|xls|csv)$/.test(nombre)
      || req.file.mimetype.includes('sheet') || req.file.mimetype.includes('excel') || req.file.mimetype.includes('csv');
    const esPdf = /\.pdf$/.test(nombre) || req.file.mimetype.includes('pdf');

    if (esPdf) {
      const texto = await textoDelPdf(req.file.buffer);
      const { tipo } = clasificarDocumento(texto);
      const vacio = (): ImportacionImportData => ({
        regimen: ImportacionRegimen.DEFINITIVA, proveedorExterior: null, paisOrigen: null, incoterm: null,
        monedaOrigen: 'USD', tipoCambio: 1, duaNumero: null, despachante: null, aduana: null,
        fob: 0, flete: 0, seguro: 0, tributos: [], gastos: [], items: [],
      });

      if (tipo === 'FACTURA_COMERCIAL') {
        const f = parseFacturaComercial(texto);
        const datos: ImportacionImportData = {
          ...vacio(), proveedorExterior: f.proveedor, incoterm: f.incoterm, monedaOrigen: f.moneda,
          fob: f.fob ?? 0, flete: f.flete, seguro: f.seguro,
          facturaComercialNro: f.numero, facturaComercialFecha: f.fecha ?? undefined,
          items: f.articulos.map((a) => ({ descripcion: `${a.codigo} - ${a.descripcion}`, cantidad: a.cantidad, fobUnitario: a.precioUnit })),
        };
        res.json({ datos, aviso: `Factura: proveedor ${f.proveedor ?? '—'}, ${f.articulos.length} artículos, FOB ${f.fob}, flete ${f.flete}, seguro ${f.seguro}, CIF ${f.cif}.`, encontrados: ['factura', `${f.articulos.length} artículos`, 'FOB/flete/seguro'], texto: texto.slice(0, 4000) });
        return;
      }
      if (tipo === 'LIQUIDACION_DESPACHANTE') {
        const l = parseLiquidacionDespachante(texto);
        const c = l.conceptos;
        const tributos: ImportacionImportData['tributos'] = [];
        if (c.ivaImportacion) tributos.push({ tipo: TributoImportacionTipo.IVA_IMPORTACION, monto: c.ivaImportacion });
        if (c.ivaAnticipado) tributos.push({ tipo: TributoImportacionTipo.ANTICIPO_IVA, monto: c.ivaAnticipado });
        if (c.imaduni) tributos.push({ tipo: TributoImportacionTipo.ARANCEL_TEC, monto: c.imaduni });
        if (c.recargo) tributos.push({ tipo: TributoImportacionTipo.RECARGO, monto: c.recargo });
        const tasas = (c.tasaConsular ?? 0) + (c.tsa ?? 0) + (c.extraordinario ?? 0) + (c.guiaTransito ?? 0) + (c.timbre ?? 0) + (c.vuce ?? 0) + (c.escaner ?? 0);
        if (tasas > 0) tributos.push({ tipo: TributoImportacionTipo.TASA_SERVICIOS, monto: tasas });
        const gastos: ImportacionImportData['gastos'] = [];
        if (c.honorarios) gastos.push({ concepto: GastoImportacionConcepto.HONORARIOS_DESPACHANTE, monto: c.honorarios, ivaGasto: 0 });
        const otros = (c.gastosOperativos ?? 0) + (c.tcu ?? 0);
        if (otros > 0) gastos.push({ concepto: GastoImportacionConcepto.OTRO, monto: otros, ivaGasto: 0 });
        if (c.ivaGastos) { if (gastos.length) gastos[0].ivaGasto = c.ivaGastos; else gastos.push({ concepto: GastoImportacionConcepto.OTRO, monto: 0, ivaGasto: c.ivaGastos }); }
        const datos: ImportacionImportData = {
          ...vacio(), proveedorExterior: l.proveedor, paisOrigen: l.origen, tipoCambio: l.tipoCambio ?? 1,
          duaNumero: l.carpeta, despachante: l.despachante, aduana: l.aduana, fechaNacionalizacion: l.fecha ?? undefined,
          transporteDoc: l.transporte, tributos, gastos,
          notas: l.gastosAgenciaExtra ? `Gastos de agencia informados aparte: USD ${l.gastosAgenciaExtra}` : null,
        };
        res.json({ datos, aviso: `Liquidación: carpeta ${l.carpeta ?? '—'}, total $${l.total}, IVA importación ${c.ivaImportacion ?? 0}, IVA anticipado ${c.ivaAnticipado ?? 0}, IVA gastos ${c.ivaGastos ?? 0}.`, encontrados: ['liquidación', 'tributos', 'IVA'], texto: texto.slice(0, 4000) });
        return;
      }
      if (tipo === 'SWIFT' || tipo === 'DEBITO_BANCARIO') {
        const p = parsePagoExterior(texto);
        const datos: ImportacionImportData = {
          ...vacio(), monedaOrigen: p.moneda,
          notas: `Pago a ${p.beneficiario ?? 'proveedor'}: ${p.moneda} ${p.importe ?? '—'} (${p.fecha ?? 's/f'}), ref ${p.ref ?? '—'}${p.comision ? `, comisión ${p.comision}` : ''}.`,
        };
        res.json({ datos, aviso: `Comprobante de pago: ${p.moneda} ${p.importe ?? '—'} a ${p.beneficiario ?? '—'} (ref ${p.ref ?? '—'}${p.comision ? `, comisión ${p.comision}` : ''}). Los pagos se registrarán como transferencias aparte; por ahora va informado en Notas.`, encontrados: ['pago'], texto: texto.slice(0, 4000) });
        return;
      }
      // Formato no reconocido → heurística genérica.
      const r = await extraerImportacionDesdePdf(req.file.buffer);
      res.json({ datos: r.datos, aviso: r.aviso, encontrados: r.encontrados, texto: r.texto });
      return;
    }
    if (!esHoja) {
      res.json({ datos: null, aviso: 'Formato no reconocido. Subí un PDF (factura, DUA, comprobante) o un Excel/CSV.' });
      return;
    }
    const { rows } = parseImportacionesExcel(req.file.buffer);
    const first = rows[0];
    if (!first) { res.json({ datos: null, aviso: 'El archivo no tiene filas de datos.' }); return; }
    res.json({ datos: first.datos, errores: first.errores });
  } catch (err) { next(err); }
});

// ── GET /plantilla — Excel de ejemplo para importar ──────────────────────────
importacionesRouter.get('/plantilla', (_req: Request, res: Response) => {
  const buf = buildPlantillaImportaciones();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_importaciones.xlsx"');
  res.send(buf);
});

// ── POST /importar — generar registros desde un Excel/CSV ────────────────────
// commit != 'true' → dry-run (parsea y valida). commit == 'true' → crea.
importacionesRouter.post('/importar', uploadXls.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.body.companyId ?? '');
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const commit = String(req.body.commit ?? '') === 'true';
    if (!req.file) throw new AppError(400, 'Archivo requerido (campo "file")');

    const { headers, mapeo, rows } = parseImportacionesExcel(req.file.buffer);
    if (rows.length === 0) throw new AppError(400, 'El archivo no tiene filas de datos');

    const validas = rows.filter((r) => r.errores.length === 0);
    const resumen = { total: rows.length, validas: validas.length, conErrores: rows.length - validas.length };

    if (!commit) {
      res.json({ dryRun: true, headers, mapeo, resumen, filas: rows });
      return;
    }

    let creadas = 0;
    for (const row of validas) {
      try {
        const data = importacionSchema.parse({ companyId, ...row.datos });
        const d = construirDatos(data);
        const imp = await prisma.importacion.create({
          data: {
            companyId, estado: ImportacionEstado.BORRADOR, creadoPor: req.user?.userId ?? null,
            ...d.cabezal,
            items: { create: d.items }, tributos: { create: d.tributos }, gastos: { create: d.gastos },
          },
        });
        await recordAudit({ req, action: 'IMPORTACION_IMPORT', entity: 'importacion', entityId: imp.id, companyId, newData: { duaNumero: imp.duaNumero } });
        creadas++;
      } catch (e) {
        row.errores.push('Error al crear: ' + (e as Error).message);
      }
    }
    res.json({ dryRun: false, resumen: { ...resumen, creadas }, filas: rows });
  } catch (err) { next(err); }
});

// ── GET /credito-fiscal — reporte de crédito fiscal del mes (DGI) ────────────
// IVA importación + IVA de gastos (crédito fiscal) y anticipos (pagos a cuenta)
// de las importaciones NACIONALIZADAS/CERRADAS del mes (por fecha de
// nacionalización, o de DUA si falta). DEBE declararse ANTES de GET /:id.
async function reporteCreditoFiscal(companyId: string, year: number, month: number) {
  const imps = await prisma.importacion.findMany({
    where: { companyId, estado: { in: [ImportacionEstado.NACIONALIZADA, ImportacionEstado.CERRADA] } },
    include: { tributos: true, gastos: true },
  });
  const filas = imps
    .map((imp) => {
      const fechaEf = imp.fechaNacionalizacion ?? imp.duaFecha;
      return { imp, fechaEf };
    })
    .filter(({ fechaEf }) => fechaEf && fechaEf.getUTCFullYear() === year && fechaEf.getUTCMonth() + 1 === month)
    .map(({ imp, fechaEf }) => {
      const ivaImportacion = imp.tributos.filter((t) => t.tipo === TributoImportacionTipo.IVA_IMPORTACION).reduce((s, t) => s + t.monto, 0n);
      const anticipoIva = imp.tributos.filter((t) => t.tipo === TributoImportacionTipo.ANTICIPO_IVA).reduce((s, t) => s + t.monto, 0n);
      const anticipoIrae = imp.tributos.filter((t) => t.tipo === TributoImportacionTipo.ANTICIPO_IRAE).reduce((s, t) => s + t.monto, 0n);
      const ivaGastos = imp.gastos.reduce((s, g) => s + g.ivaGasto, 0n);
      return {
        id: imp.id,
        duaNumero: imp.duaNumero,
        fecha: fechaEf ? fechaEf.toISOString().slice(0, 10) : null,
        proveedor: imp.proveedorExterior,
        ivaImportacion: ivaImportacion.toString(),
        ivaGastos: ivaGastos.toString(),
        anticipoIva: anticipoIva.toString(),
        anticipoIrae: anticipoIrae.toString(),
        creditoFiscalIva: imp.creditoFiscalIva.toString(),
        anticipos: imp.anticipos.toString(),
      };
    });

  const sum = (k: 'ivaImportacion' | 'ivaGastos' | 'anticipoIva' | 'anticipoIrae' | 'creditoFiscalIva' | 'anticipos') =>
    filas.reduce((s, f) => s + BigInt(f[k]), 0n).toString();
  const totales = {
    ivaImportacion: sum('ivaImportacion'), ivaGastos: sum('ivaGastos'),
    anticipoIva: sum('anticipoIva'), anticipoIrae: sum('anticipoIrae'),
    creditoFiscalIva: sum('creditoFiscalIva'), anticipos: sum('anticipos'),
  };
  return { filas, totales };
}

importacionesRouter.get('/credito-fiscal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!companyId) throw new AppError(400, 'companyId requerido');
    if (!year || !month) throw new AppError(400, 'year y month requeridos');
    await assertCompanyAccess(req, companyId);
    res.json(await reporteCreditoFiscal(companyId, year, month));
  } catch (err) { next(err); }
});

importacionesRouter.get('/credito-fiscal/excel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!companyId) throw new AppError(400, 'companyId requerido');
    if (!year || !month) throw new AppError(400, 'year y month requeridos');
    await assertCompanyAccess(req, companyId);
    const { filas, totales } = await reporteCreditoFiscal(companyId, year, month);
    const p = (v: string) => Number(BigInt(v)) / 100;
    const aoa: (string | number)[][] = [
      [`Crédito fiscal de importaciones — ${String(month).padStart(2, '0')}/${year}`],
      [],
      ['DUA', 'Fecha', 'Proveedor', 'IVA importación', 'IVA gastos', 'Anticipo IVA', 'Anticipo IRAE', 'Crédito fiscal total', 'Anticipos'],
      ...filas.map((f) => [f.duaNumero ?? '', f.fecha ?? '', f.proveedor ?? '', p(f.ivaImportacion), p(f.ivaGastos), p(f.anticipoIva), p(f.anticipoIrae), p(f.creditoFiscalIva), p(f.anticipos)]),
      ['TOTALES', '', '', p(totales.ivaImportacion), p(totales.ivaGastos), p(totales.anticipoIva), p(totales.anticipoIrae), p(totales.creditoFiscalIva), p(totales.anticipos)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 18 }, { wch: 13 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Crédito fiscal');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="credito_fiscal_importaciones_${String(month).padStart(2, '0')}${year}.xlsx"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// ── Documentos del expediente ────────────────────────────────────────────────
const MIME_DOC = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'text/csv', 'application/csv',
]);

function serializarDoc(d: {
  id: string; fileName: string; mimeType: string; tamano: number; paginas: number | null;
  tipoDetectado: string | null; tipoConfirmado: string | null; confianzaTipo: number | null;
  estadoProc: string; errorProc: string | null; createdAt: Date;
}) {
  return {
    id: d.id, fileName: d.fileName, mimeType: d.mimeType, tamano: d.tamano, paginas: d.paginas,
    tipoDetectado: d.tipoDetectado, tipoConfirmado: d.tipoConfirmado, confianzaTipo: d.confianzaTipo,
    estadoProc: d.estadoProc, errorProc: d.errorProc, createdAt: d.createdAt.toISOString(),
  };
}

// GET /:id/documentos — lista de documentos del expediente.
importacionesRouter.get('/:id/documentos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({ where: { id: req.params.id } });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    const docs = await prisma.importacionDocumento.findMany({ where: { importacionId: imp.id }, orderBy: { createdAt: 'asc' } });
    res.json(docs.map(serializarDoc));
  } catch (err) { next(err); }
});

// POST /:id/documentos — subir uno o varios archivos (campo "files").
importacionesRouter.post('/:id/documentos', uploadDocs.array('files', 30), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({ where: { id: req.params.id } });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new AppError(400, 'No se subió ningún archivo (campo "files")');

    const existentes = await prisma.importacionDocumento.findMany({ where: { importacionId: imp.id }, select: { hash: true } });
    const hashes = new Set(existentes.map((e) => e.hash));
    const creados: ReturnType<typeof serializarDoc>[] = [];
    const duplicados: string[] = [];

    for (const file of files) {
      if (!MIME_DOC.has(file.mimetype)) { duplicados.push(`${file.originalname}: tipo no permitido`); continue; }
      const hash = createHash('sha256').update(file.buffer).digest('hex');
      if (hashes.has(hash)) { duplicados.push(`${file.originalname}: duplicado (ya está en el expediente)`); continue; }
      hashes.add(hash);

      const paginas = file.mimetype === 'application/pdf' ? await contarPaginasPdf(file.buffer) : (file.mimetype.startsWith('image/') ? 1 : null);
      const key = `${imp.companyId}/IMPORTACION/${imp.id}/${hash.slice(0, 12)}_${safeFileName(file.originalname)}`;
      await storageService.save(key, file.buffer);
      const doc = await prisma.importacionDocumento.create({
        data: {
          importacionId: imp.id, fileName: file.originalname, mimeType: file.mimetype,
          storageKey: key, hash, tamano: file.size, paginas: paginas || null,
          estadoProc: EstadoProcesamientoDoc.PENDIENTE, subidoPor: req.user?.userId ?? null,
        },
      });
      creados.push(serializarDoc(doc));
    }

    await recordAudit({ req, action: 'IMPORTACION_DOC_UPLOAD', entity: 'importacion', entityId: imp.id, companyId: imp.companyId, newData: { creados: creados.length, duplicados: duplicados.length } });
    res.status(201).json({ creados, duplicados });
  } catch (err) { next(err); }
});

// GET /documentos/:docId/download — descarga del archivo original.
importacionesRouter.get('/documentos/:docId/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.importacionDocumento.findUnique({ where: { id: req.params.docId }, include: { importacion: true } });
    if (!doc) throw new NotFoundError('Documento');
    await assertCompanyAccess(req, doc.importacion.companyId);
    const buffer = await storageService.read(doc.storageKey);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName)}"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

// DELETE /documentos/:docId — eliminar un documento del expediente.
importacionesRouter.delete('/documentos/:docId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.importacionDocumento.findUnique({ where: { id: req.params.docId }, include: { importacion: true } });
    if (!doc) throw new NotFoundError('Documento');
    await assertCompanyAccess(req, doc.importacion.companyId);
    await storageService.remove(doc.storageKey).catch(() => { /* archivo ya ausente */ });
    await prisma.importacionDocumento.delete({ where: { id: doc.id } });
    await recordAudit({ req, action: 'IMPORTACION_DOC_DELETE', entity: 'importacion', entityId: doc.importacionId, companyId: doc.importacion.companyId, oldData: { fileName: doc.fileName } });
    res.json({ message: 'Documento eliminado' });
  } catch (err) { next(err); }
});

// ── GET /:id — detalle ───────────────────────────────────────────────────────
importacionesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({ where: { id: req.params.id }, include: incluir });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    res.json(serializar(imp));
  } catch (err) { next(err); }
});

// Plan de cuentas configurado de una empresa (o null).
async function planDeEmpresa(companyId: string): Promise<PlanCuentas | null> {
  const cfg = await prisma.importacionEmpresaConfig.findUnique({ where: { companyId }, select: { planCuentas: true } });
  return (cfg?.planCuentas as PlanCuentas | null) ?? null;
}

// ── GET /:id/asiento — asiento contable de la importación (JSON) ─────────────
importacionesRouter.get('/:id/asiento', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({ where: { id: req.params.id }, include: incluir });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    const plan = await planDeEmpresa(imp.companyId);
    res.json(armarAsientoImportacion(imp, plan));
  } catch (err) { next(err); }
});

// ── GET /:id/costeo.pdf — INFORME completo del expediente (PDF) ──────────────
importacionesRouter.get('/:id/costeo.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({
      where: { id: req.params.id },
      include: { gastos: true, tributos: true, company: true },
    });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    const [facturas, liquidaciones, transferencias, documentos, plan] = await Promise.all([
      prisma.importacionFactura.findMany({ where: { importacionId: imp.id }, include: { articulos: { orderBy: { nro: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
      prisma.importacionLiquidacion.findMany({ where: { importacionId: imp.id }, include: { conceptos: true }, orderBy: { createdAt: 'asc' } }),
      prisma.importacionTransferencia.findMany({ where: { importacionId: imp.id }, orderBy: { fecha: 'asc' } }),
      prisma.importacionDocumento.findMany({ where: { importacionId: imp.id }, orderBy: { createdAt: 'asc' } }),
      planDeEmpresa(imp.companyId),
    ]);
    const pdf = await generateInformePDF({
      empresa: { razonSocial: imp.company.razonSocial, rut: imp.company.rut },
      imp,
      plan,
      facturas: facturas.map((f) => ({ proveedor: f.proveedor, numero: f.numero, fecha: f.fecha, moneda: f.moneda, incoterm: f.incoterm, fob: f.fob, flete: f.flete, seguro: f.seguro, cif: f.cif, total: f.total, articulos: f.articulos.map((a) => ({ nro: a.nro, codigo: a.codigo, descripcion: a.descripcion, cantidad: a.cantidad, precioUnit: a.precioUnit, total: a.total })) })),
      liquidaciones: liquidaciones.map((l) => ({ carpeta: l.carpeta, fecha: l.fecha, aduana: l.aduana, despachante: l.despachante, transporte: l.transporte, tipoCambio: l.tipoCambio, moneda: l.moneda, kilosBrutos: l.kilosBrutos, kilosNetos: l.kilosNetos, total: l.total, gastosAgenciaExtra: l.gastosAgenciaExtra, conceptos: l.conceptos.map((c) => ({ clave: c.clave, monto: c.monto })) })),
      transferencias: transferencias.map((t) => ({ referencia: t.referencia, fecha: t.fecha, moneda: t.moneda, importe: t.importe, comision: t.comision, totalDebitado: t.totalDebitado, beneficiario: t.beneficiario, nroDocs: t.nroDocs })),
      documentos: documentos.map((d) => ({ fileName: d.fileName, tipo: d.tipoConfirmado ?? d.tipoDetectado, paginas: d.paginas, estado: d.estadoProc })),
    });
    const nombre = `${costeoFilename(imp)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// ── POST /:id/procesar — lee y extrae TODOS los documentos del expediente ────
importacionesRouter.post('/:id/procesar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({ where: { id: req.params.id } });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    const r = await procesarExpediente(imp.id);
    await recordAudit({ req, action: 'IMPORTACION_PROCESAR', entity: 'importacion', entityId: imp.id, companyId: imp.companyId, newData: { facturas: r.facturas, liquidaciones: r.liquidaciones, transferencias: r.transferencias } });
    res.json(r);
  } catch (err) { next(err); }
});

// ── GET /:id/extraccion — datos extraídos estructurados del expediente ───────
importacionesRouter.get('/:id/extraccion', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({ where: { id: req.params.id } });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    const [facturas, liquidaciones, transferencias] = await Promise.all([
      prisma.importacionFactura.findMany({ where: { importacionId: imp.id }, include: { articulos: { orderBy: { nro: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
      prisma.importacionLiquidacion.findMany({ where: { importacionId: imp.id }, include: { conceptos: true }, orderBy: { createdAt: 'asc' } }),
      prisma.importacionTransferencia.findMany({ where: { importacionId: imp.id }, orderBy: { fecha: 'asc' } }),
    ]);
    res.json({
      facturas: facturas.map((f) => ({
        id: f.id, documentoId: f.documentoId, proveedor: f.proveedor, cuit: f.cuit, numero: f.numero,
        fecha: f.fecha ? f.fecha.toISOString().slice(0, 10) : null, moneda: f.moneda, incoterm: f.incoterm,
        fob: f.fob.toString(), flete: f.flete.toString(), seguro: f.seguro.toString(), cif: f.cif.toString(), total: f.total.toString(),
        estadoRevision: f.estadoRevision,
        articulos: f.articulos.map((a) => ({ nro: a.nro, codigo: a.codigo, descripcion: a.descripcion, cantidad: a.cantidad, precioUnit: a.precioUnit, total: a.total.toString() })),
      })),
      liquidaciones: liquidaciones.map((l) => ({
        id: l.id, documentoId: l.documentoId, despachante: l.despachante, carpeta: l.carpeta,
        fecha: l.fecha ? l.fecha.toISOString().slice(0, 10) : null, aduana: l.aduana, origen: l.origen, transporte: l.transporte,
        cif: l.cif.toString(), tipoCambio: l.tipoCambio, moneda: l.moneda, total: l.total.toString(), gastosAgenciaExtra: l.gastosAgenciaExtra,
        estadoRevision: l.estadoRevision,
        conceptos: l.conceptos.map((c) => ({ clave: c.clave, monto: c.monto.toString() })),
      })),
      transferencias: transferencias.map((t) => ({
        id: t.id, referencia: t.referencia, fecha: t.fecha ? t.fecha.toISOString().slice(0, 10) : null, moneda: t.moneda,
        importe: t.importe.toString(), comision: t.comision.toString(), totalDebitado: t.totalDebitado.toString(),
        beneficiario: t.beneficiario, nroDocs: t.nroDocs, estadoRevision: t.estadoRevision,
      })),
    });
  } catch (err) { next(err); }
});

// ── POST / — crear ───────────────────────────────────────────────────────────
importacionesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = importacionSchema.parse(req.body);
    await assertCompanyAccess(req, data.companyId);
    const d = construirDatos(data);
    const imp = await prisma.importacion.create({
      data: {
        companyId: data.companyId,
        estado: data.estado ?? ImportacionEstado.BORRADOR,
        creadoPor: req.user?.userId ?? null,
        ...d.cabezal,
        items: { create: d.items },
        tributos: { create: d.tributos },
        gastos: { create: d.gastos },
      },
      include: incluir,
    });
    await recordAudit({ req, action: 'IMPORTACION_CREATE', entity: 'importacion', entityId: imp.id, companyId: imp.companyId, newData: { duaNumero: imp.duaNumero, costoMercaderia: imp.costoMercaderia.toString() } });
    res.status(201).json(serializar(imp));
  } catch (err) { next(err); }
});

// ── PUT /:id — editar (reemplaza cabezal y líneas, recalcula costeo) ──────────
importacionesRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.importacion.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, existing.companyId);
    if (existing.estado === ImportacionEstado.ANULADA) throw new AppError(400, 'La importación está anulada; no se puede editar.');
    // companyId no se cambia en edición: se usa el de la importación existente.
    const data = importacionSchema.parse({ ...req.body, companyId: existing.companyId });
    const d = construirDatos(data);
    const imp = await prisma.$transaction(async (tx) => {
      await tx.itemImportacion.deleteMany({ where: { importacionId: existing.id } });
      await tx.tributoImportacion.deleteMany({ where: { importacionId: existing.id } });
      await tx.gastoImportacion.deleteMany({ where: { importacionId: existing.id } });
      return tx.importacion.update({
        where: { id: existing.id },
        data: {
          ...(data.estado ? { estado: data.estado } : {}),
          ...d.cabezal,
          items: { create: d.items },
          tributos: { create: d.tributos },
          gastos: { create: d.gastos },
        },
        include: incluir,
      });
    });
    await recordAudit({ req, action: 'IMPORTACION_UPDATE', entity: 'importacion', entityId: imp.id, companyId: imp.companyId, newData: { duaNumero: imp.duaNumero, costoMercaderia: imp.costoMercaderia.toString() } });
    res.json(serializar(imp));
  } catch (err) { next(err); }
});

// ── PATCH /:id/estado — cambiar estado del trámite ───────────────────────────
importacionesRouter.patch('/:id/estado', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { estado } = z.object({ estado: z.nativeEnum(ImportacionEstado) }).parse(req.body);
    const existing = await prisma.importacion.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, existing.companyId);
    const imp = await prisma.importacion.update({ where: { id: existing.id }, data: { estado }, include: incluir });
    await recordAudit({ req, action: estado === ImportacionEstado.ANULADA ? 'IMPORTACION_ANULAR' : 'IMPORTACION_ESTADO', entity: 'importacion', entityId: imp.id, companyId: imp.companyId, oldData: { estado: existing.estado }, newData: { estado } });
    res.json(serializar(imp));
  } catch (err) { next(err); }
});

// ── DELETE /:id — eliminar ───────────────────────────────────────────────────
importacionesRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.importacion.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, existing.companyId);
    await prisma.importacion.delete({ where: { id: existing.id } });
    await recordAudit({ req, action: 'IMPORTACION_DELETE', entity: 'importacion', entityId: existing.id, companyId: existing.companyId, oldData: { duaNumero: existing.duaNumero } });
    res.json({ message: 'Importación eliminada' });
  } catch (err) { next(err); }
});
