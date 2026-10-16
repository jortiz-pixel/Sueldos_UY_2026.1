// IMPORTACIONES (comercio exterior) — registro de operaciones de importación de
// mercadería por empresa (multiempresa). CRUD con costeo según normativa UY;
// toda operación valida el acceso a la empresa dueña (anti-IDOR) y audita.
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  UserRole, Prisma,
  ImportacionEstado, ImportacionRegimen,
  TributoImportacionTipo, GastoImportacionConcepto,
} from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import * as XLSX from 'xlsx';
import { recordAudit } from '../services/audit.service';
import { calcularCosteo, esTributoRecuperable, armarAsientoImportacion } from '../services/importaciones.service';
import { generateCosteoPDF, costeoFilename } from '../services/importaciones.pdf.service';

export const importacionesRouter = Router();

// Todo el módulo es interno del estudio: solo ADMIN/OPERATOR.
importacionesRouter.use(authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR));

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

// ── GET /:id — detalle ───────────────────────────────────────────────────────
importacionesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({ where: { id: req.params.id }, include: incluir });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    res.json(serializar(imp));
  } catch (err) { next(err); }
});

// ── GET /:id/asiento — asiento contable de la importación (JSON) ─────────────
importacionesRouter.get('/:id/asiento', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({ where: { id: req.params.id }, include: incluir });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    res.json(armarAsientoImportacion(imp));
  } catch (err) { next(err); }
});

// ── GET /:id/costeo.pdf — ficha de costeo (PDF) ──────────────────────────────
importacionesRouter.get('/:id/costeo.pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const imp = await prisma.importacion.findUnique({
      where: { id: req.params.id },
      include: { ...incluir, company: true },
    });
    if (!imp) throw new NotFoundError('Importación');
    await assertCompanyAccess(req, imp.companyId);
    const pdf = await generateCosteoPDF(imp, { razonSocial: imp.company.razonSocial, rut: imp.company.rut });
    const nombre = `${costeoFilename(imp)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.send(pdf);
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
