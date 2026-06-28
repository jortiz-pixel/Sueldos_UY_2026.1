import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole, ItemType, Concepto } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';

export const conceptsRouter = Router();

const conceptoSchema = z.object({
  companyId: z.string().cuid(),
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

function serializeConcepto(c: Concepto) {
  return { ...c, valorFijo: c.valorFijo != null ? c.valorFijo.toString() : null };
}

// GET /api/concepts?companyId=
conceptsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await checkCompanyAccess(req, companyId);

    const conceptos = await prisma.concepto.findMany({
      where: { companyId },
      orderBy: [{ orden: 'asc' }, { codigo: 'asc' }],
    });
    res.json(conceptos.map(serializeConcepto));
  } catch (err) { next(err); }
});

// POST /api/concepts
conceptsRouter.post('/', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = conceptoSchema.parse(req.body);
    await checkCompanyAccess(req, data.companyId);
    const concepto = await prisma.concepto.create({ data });
    res.status(201).json(serializeConcepto(concepto));
  } catch (err) { next(err); }
});

// PUT /api/concepts/:id
conceptsRouter.put('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.concepto.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Concepto');
    await checkCompanyAccess(req, existing.companyId);

    const data = conceptoSchema.partial().parse(req.body);
    const concepto = await prisma.concepto.update({ where: { id: req.params.id }, data });
    res.json(serializeConcepto(concepto));
  } catch (err) { next(err); }
});

// DELETE /api/concepts/:id
conceptsRouter.delete('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.concepto.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Concepto');
    await checkCompanyAccess(req, existing.companyId);
    await prisma.concepto.delete({ where: { id: req.params.id } });
    res.json({ message: 'Concepto eliminado' });
  } catch (err) { next(err); }
});
