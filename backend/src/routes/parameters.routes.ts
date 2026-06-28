import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { NotFoundError } from '../middleware/errorHandler';
import { parametersService } from '../services/parameters.service';

export const parametersRouter = Router();

// GET /api/parameters — Lista todos los parámetros vigentes
parametersRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asOfDate = req.query.date ? new Date(req.query.date as string) : new Date();
    const params = await parametersService.getPayrollParameters(asOfDate);
    res.json({
      ...params,
      bpc: params.bpc.toString(),
    });
  } catch (err) { next(err); }
});

// GET /api/parameters/list — Lista histórica de parámetros
parametersRouter.get('/list', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = await prisma.payrollParameter.findMany({
      orderBy: [{ key: 'asc' }, { effectiveDate: 'desc' }],
    });
    res.json(params);
  } catch (err) { next(err); }
});

// POST /api/parameters — Crea nuevo parámetro (versionado)
parametersRouter.post('/', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      key: z.string().min(1),
      value: z.unknown(),
      description: z.string().optional(),
      effectiveDate: z.string().datetime(),
      expiresDate: z.string().datetime().optional(),
    });
    const { value, ...rest } = schema.parse(req.body);

    const param = await prisma.payrollParameter.create({
      data: {
        ...rest,
        value: JSON.stringify(value),
        effectiveDate: new Date(rest.effectiveDate),
        expiresDate: rest.expiresDate ? new Date(rest.expiresDate) : undefined,
        createdBy: req.user!.userId,
      },
    });

    parametersService.clearCache();
    res.status(201).json(param);
  } catch (err) { next(err); }
});

// GET /api/parameters/tax-brackets — IRPF brackets vigentes
parametersRouter.get('/tax-brackets', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asOfDate = req.query.date ? new Date(req.query.date as string) : new Date();
    const brackets = await parametersService.getIrpfBrackets(asOfDate);
    res.json(brackets);
  } catch (err) { next(err); }
});

// POST /api/parameters/tax-brackets — Actualiza escala IRPF
parametersRouter.post('/tax-brackets', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      effectiveDate: z.string().datetime(),
      brackets: z.array(z.object({
        fromBpc: z.number().int().min(0),
        toBpc: z.number().int().nullable(),
        rate: z.number().int().min(0).max(10000),  // basis points
      })).min(1),
    });
    const { effectiveDate, brackets } = schema.parse(req.body);
    const date = new Date(effectiveDate);

    // Expire previous brackets
    await prisma.irpfBracket.updateMany({
      where: { expiresDate: null, effectiveDate: { lt: date } },
      data: { expiresDate: date },
    });

    const created = await prisma.irpfBracket.createMany({
      data: brackets.map((b) => ({ ...b, effectiveDate: date })),
    });

    parametersService.clearCache();
    res.status(201).json({ created: created.count, effectiveDate });
  } catch (err) { next(err); }
});

// GET /api/parameters/tax-brackets/history
parametersRouter.get('/tax-brackets/history', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const brackets = await prisma.irpfBracket.findMany({
      orderBy: [{ effectiveDate: 'desc' }, { fromBpc: 'asc' }],
    });
    res.json(brackets);
  } catch (err) { next(err); }
});

// GET /api/parameters/laudos?companyId=
parametersRouter.get('/laudos', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    await assertCompanyAccess(req, companyId);
    const laudos = await prisma.laudo.findMany({
      where: { companyId: companyId ?? '' },
      orderBy: [{ grupoActividad: 'asc' }, { categoria: 'asc' }],
    });
    res.json(laudos.map((l) => ({ ...l, salarioMinimo: l.salarioMinimo.toString() })));
  } catch (err) { next(err); }
});

// POST /api/parameters/laudos
parametersRouter.post('/laudos', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      companyId: z.string().cuid(),
      grupoActividad: z.string().min(1),
      subgrupo: z.string().optional(),
      categoria: z.string().min(1),
      nivel: z.string().optional(),
      descripcion: z.string().optional(),
      salarioMinimo: z.string().transform((v) => BigInt(v)),
      effectiveDate: z.string().datetime(),
      expiresDate: z.string().datetime().optional(),
    });
    const data = schema.parse(req.body);
    const laudo = await prisma.laudo.create({
      data: {
        ...data,
        effectiveDate: new Date(data.effectiveDate),
        expiresDate: data.expiresDate ? new Date(data.expiresDate) : undefined,
      },
    });
    res.status(201).json({ ...laudo, salarioMinimo: laudo.salarioMinimo.toString() });
  } catch (err) { next(err); }
});
