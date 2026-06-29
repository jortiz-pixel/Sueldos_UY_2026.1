import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole, ItemType, Concepto } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';

export const conceptsRouter = Router();

const conceptoSchema = z.object({
  // null = concepto común (visible en todas las empresas); requiere ADMIN de plataforma.
  companyId: z.string().cuid().nullable().optional(),
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  nombreReducido: z.string().optional(),
  orden: z.number().int().default(100),
  tipoOperacion: z.nativeEnum(ItemType).default(ItemType.HABER),
  tipoCalculo: z.enum(['VALOR_FIJO', 'PORCENTAJE', 'CANTIDAD_VALOR']).default('VALOR_FIJO'),
  baseCalculo: z.enum(['NOMINAL', 'SUELDO_BASICO', 'HABERES_GRAVADOS']).optional().nullable(),
  valorRate: z.number().int().optional().nullable(),
  valorFijo: z.string().transform((v) => BigInt(v)).optional().nullable(),
  gravado: z.boolean().default(true),
  codBps: z.number().int().optional().nullable(),
  visibleRecibo: z.boolean().default(true),
  incluyeLicencia: z.boolean().default(false),
  activo: z.boolean().default(true),
});

async function checkCompanyAccess(req: Request, companyId: string): Promise<void> {
  await assertCompanyAccess(req, companyId);
}

/**
 * Verifica el acceso para administrar un concepto según su alcance:
 *  - común (companyId null): solo ADMIN de plataforma (afecta a todas las empresas).
 *  - propio (companyId X): ADMIN u operador con acceso a X.
 */
async function assertConceptoScope(req: Request, companyId: string | null | undefined): Promise<void> {
  if (companyId == null) {
    if (req.user!.role !== UserRole.ADMIN) {
      throw new AppError(403, 'Solo un administrador de plataforma puede gestionar conceptos comunes');
    }
    return;
  }
  await assertCompanyAccess(req, companyId);
}

function serializeConcepto(c: Concepto, viewCompanyId?: string) {
  return {
    ...c,
    valorFijo: c.valorFijo != null ? c.valorFijo.toString() : null,
    esComun: c.companyId === null,
    oculto: viewCompanyId ? c.ocultoEn.includes(viewCompanyId) : false,
  };
}

// GET /api/concepts?companyId=  → comunes (todas) + propios de la empresa
conceptsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await checkCompanyAccess(req, companyId);

    const conceptos = await prisma.concepto.findMany({
      where: { OR: [{ companyId }, { companyId: null }] },
      orderBy: [{ orden: 'asc' }, { codigo: 'asc' }],
    });
    res.json(conceptos.map((c) => serializeConcepto(c, companyId)));
  } catch (err) { next(err); }
});

// POST /api/concepts  (companyId null = común, requiere ADMIN)
conceptsRouter.post('/', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = conceptoSchema.parse(req.body);
    await assertConceptoScope(req, data.companyId ?? null);
    const concepto = await prisma.concepto.create({ data: { ...data, companyId: data.companyId ?? null } });
    res.status(201).json(serializeConcepto(concepto, data.companyId ?? undefined));
  } catch (err) { next(err); }
});

// PUT /api/concepts/:id
conceptsRouter.put('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.concepto.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Concepto');
    await assertConceptoScope(req, existing.companyId);

    const data = conceptoSchema.partial().parse(req.body);
    // Cambiar el alcance (común <-> propio) también requiere permiso sobre el destino.
    if (data.companyId !== undefined && data.companyId !== existing.companyId) {
      await assertConceptoScope(req, data.companyId ?? null);
    }
    const concepto = await prisma.concepto.update({ where: { id: req.params.id }, data });
    res.json(serializeConcepto(concepto, existing.companyId ?? undefined));
  } catch (err) { next(err); }
});

// POST /api/concepts/:id/visibilidad  { companyId, oculto }
//   Oculta/muestra un concepto en los listados de una empresa (pensado para comunes).
conceptsRouter.post('/:id/visibilidad', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ companyId: z.string().cuid(), oculto: z.boolean() });
    const { companyId, oculto } = schema.parse(req.body);
    await checkCompanyAccess(req, companyId);

    const existing = await prisma.concepto.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Concepto');
    // Solo se puede ocultar un común, o un propio de la misma empresa.
    if (existing.companyId !== null && existing.companyId !== companyId) {
      throw new AppError(403, 'No se puede modificar la visibilidad de un concepto de otra empresa');
    }

    const ocultoEn = oculto
      ? Array.from(new Set([...existing.ocultoEn, companyId]))
      : existing.ocultoEn.filter((id) => id !== companyId);
    const concepto = await prisma.concepto.update({ where: { id: req.params.id }, data: { ocultoEn } });
    res.json(serializeConcepto(concepto, companyId));
  } catch (err) { next(err); }
});

// DELETE /api/concepts/:id
conceptsRouter.delete('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.concepto.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Concepto');
    await assertConceptoScope(req, existing.companyId);
    await prisma.concepto.delete({ where: { id: req.params.id } });
    res.json({ message: 'Concepto eliminado' });
  } catch (err) { next(err); }
});
