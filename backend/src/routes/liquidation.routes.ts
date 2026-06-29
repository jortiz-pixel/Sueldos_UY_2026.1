import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole, LiquidationStatus, PeriodStatus } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { generarLiquidacionMensual, confirmarLiquidacion } from '../services/liquidation.service';
import { calcularAguinaldo } from '../services/aguinaldo.service';
import { calcularLiquidacionLicencia, calcularLiquidacionFinal } from '../services/vacation.service';
import { generateReciboPDF } from '../services/pdf.service';

export const liquidationRouter = Router();

// GET /api/liquidation/periods
liquidationRouter.get('/periods', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);

    const periods = await prisma.payrollPeriod.findMany({
      where: {
        companyId,
        ...(req.query.year && { year: parseInt(req.query.year as string) }),
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        _count: { select: { liquidations: true } },
      },
    });
    res.json(periods);
  } catch (err) { next(err); }
});

// POST /api/liquidation/periods
liquidationRouter.post('/periods', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      companyId: z.string().cuid(),
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
    });
    const { companyId, year, month } = schema.parse(req.body);
    await assertCompanyAccess(req, companyId);

    const period = await prisma.payrollPeriod.upsert({
      where: { companyId_year_month: { companyId, year, month } },
      create: { companyId, year, month },
      update: {},
    });
    res.status(201).json(period);
  } catch (err) { next(err); }
});

// POST /api/liquidation/generate
liquidationRouter.post('/generate', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      employeeId: z.string().cuid(),
      periodId: z.string().cuid(),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      diasTrabajados: z.number().int().min(0).max(31).optional(),
      horasExtraDiurnas: z.number().min(0).optional(),
      horasExtraNocturnas: z.number().min(0).optional(),
      comisiones: z.string().transform((v) => BigInt(v)).optional(),
      otrosHaberes: z.array(z.object({
        concepto: z.string(),
        descripcion: z.string(),
        amount: z.string().transform((v) => BigInt(v)),
      })).optional(),
      otrosDescuentos: z.array(z.object({
        concepto: z.string(),
        descripcion: z.string(),
        amount: z.string().transform((v) => BigInt(v)),
      })).optional(),
    });

    const input = schema.parse(req.body);

    const period = await prisma.payrollPeriod.findUnique({ where: { id: input.periodId } });
    if (!period) throw new NotFoundError('Período');
    if (period.status === PeriodStatus.CERRADO) {
      throw new AppError(409, 'El período está cerrado y no se puede modificar');
    }

    const result = await generarLiquidacionMensual({ ...input, userId: req.user!.userId });
    const { totalHaberes, totalDescuentos, totalPatronal, liquidoPercibir, items, ...restResult } = result;
    res.json({
      ...restResult,
      totalHaberes: totalHaberes.toString(),
      totalDescuentos: totalDescuentos.toString(),
      totalPatronal: totalPatronal.toString(),
      liquidoPercibir: liquidoPercibir.toString(),
      items: items.map((item) => ({
        ...item,
        baseCalculo: item.baseCalculo?.toString() ?? null,
        amount: item.amount.toString(),
      })),
    });
  } catch (err) { next(err); }
});

// POST /api/liquidation/generate-batch  (genera para todos los contratos VIGENTES de la empresa)
liquidationRouter.post('/generate-batch', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      companyId: z.string().cuid(),
      periodId: z.string().cuid(),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
    });
    const { companyId, periodId, year, month } = schema.parse(req.body);
    await assertCompanyAccess(req, companyId);
    const asOf = new Date(year, month - 1, 1);

    const contratos = await prisma.contrato.findMany({
      where: {
        companyId,
        activo: true,
        vigenciaDesde: { lte: asOf },
        AND: [
          { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: asOf } }] },
          { OR: [{ fechaFin: null }, { fechaFin: { gte: asOf } }] },
        ],
      },
      select: { employeeId: true },
      distinct: ['employeeId'],
    });

    const results = [];
    const errors = [];

    for (const c of contratos) {
      try {
        const result = await generarLiquidacionMensual({
          employeeId: c.employeeId,
          periodId,
          year,
          month,
          userId: req.user!.userId,
        });
        results.push({ employeeId: c.employeeId, liquidacionId: result.liquidacionId, success: true });
      } catch (err) {
        errors.push({ employeeId: c.employeeId, error: (err as Error).message });
      }
    }

    res.json({ generated: results.length, failed: errors.length, results, errors });
  } catch (err) { next(err); }
});

// POST /api/liquidation/aguinaldo
liquidationRouter.post('/aguinaldo', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      employeeId: z.string().cuid(),
      periodId: z.string().cuid(),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      mesesTrabajados: z.number().int().min(1).max(6).optional(),
    });
    const input = schema.parse(req.body);
    const result = await calcularAguinaldo(input);
    res.json({
      ...result,
      aguinaldoBruto: result.aguinaldoBruto.toString(),
      aguinaldoNeto: result.aguinaldoNeto.toString(),
      bpsObrero: result.bpsObrero.toString(),
      fonasa: result.fonasa.toString(),
      frl: result.frl.toString(),
      irpf: result.irpf.toString(),
      baseCalculo: result.baseCalculo.toString(),
    });
  } catch (err) { next(err); }
});

// POST /api/liquidation/licencia
liquidationRouter.post('/licencia', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      employeeId: z.string().cuid(),
      periodId: z.string().cuid(),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      diasHabilesTomar: z.number().int().min(1).max(30),
    });
    const input = schema.parse(req.body);
    const result = await calcularLiquidacionLicencia(input);
    res.json({
      ...result,
      salarioLicencia: result.salarioLicencia.toString(),
      salarioVacacional: result.salarioVacacional.toString(),
      totalBruto: result.totalBruto.toString(),
      totalDescuentos: result.totalDescuentos.toString(),
      liquidoPercibir: result.liquidoPercibir.toString(),
    });
  } catch (err) { next(err); }
});

// POST /api/liquidation/final
liquidationRouter.post('/final', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      employeeId: z.string().cuid(),
      periodId: z.string().cuid(),
      fechaEgreso: z.string().datetime(),
    });
    const { employeeId, periodId, fechaEgreso } = schema.parse(req.body);
    const result = await calcularLiquidacionFinal(
      employeeId, periodId, new Date(fechaEgreso), req.user!.userId,
    );
    res.json(Object.fromEntries(
      Object.entries(result).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
    ));
  } catch (err) { next(err); }
});

// GET /api/liquidation/:id/preview
liquidationRouter.get('/:id/preview', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidation = await prisma.liquidation.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: [{ itemType: 'asc' }, { concepto: 'asc' }] },
        adjustments: true,
        period: true,
      },
    });
    if (!liquidation) throw new NotFoundError('Liquidación');

    res.json({
      ...liquidation,
      totalHaberes: liquidation.totalHaberes.toString(),
      totalDescuentos: liquidation.totalDescuentos.toString(),
      totalPatronal: liquidation.totalPatronal.toString(),
      liquidoPercibir: liquidation.liquidoPercibir.toString(),
      items: liquidation.items.map((i) => ({
        ...i,
        baseCalculo: i.baseCalculo?.toString() ?? null,
        amount: i.amount.toString(),
      })),
    });
  } catch (err) { next(err); }
});

// POST /api/liquidation/:id/confirm
liquidationRouter.post('/:id/confirm', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidation = await prisma.liquidation.findUnique({ where: { id: req.params.id } });
    if (!liquidation) throw new NotFoundError('Liquidación');
    if (liquidation.status !== LiquidationStatus.BORRADOR) {
      throw new AppError(409, 'Solo se pueden confirmar liquidaciones en estado BORRADOR');
    }
    await confirmarLiquidacion(req.params.id, req.user!.userId);
    res.json({ message: 'Liquidación confirmada exitosamente' });
  } catch (err) { next(err); }
});

// POST /api/liquidation/:id/unconfirm — reabrir una liquidación (CONFIRMADO → BORRADOR)
liquidationRouter.post('/:id/unconfirm', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidation = await prisma.liquidation.findUnique({
      where: { id: req.params.id },
      include: { period: true },
    });
    if (!liquidation) throw new NotFoundError('Liquidación');
    if (liquidation.status !== LiquidationStatus.CONFIRMADO) {
      throw new AppError(409, 'Solo se pueden desconfirmar liquidaciones CONFIRMADAS');
    }
    if (liquidation.period.status === PeriodStatus.CERRADO) {
      throw new AppError(409, 'El período está cerrado; no se puede desconfirmar');
    }
    await prisma.liquidation.update({
      where: { id: req.params.id },
      data: { status: LiquidationStatus.BORRADOR, confirmedAt: null, confirmedBy: null },
    });
    res.json({ message: 'Liquidación reabierta (BORRADOR)' });
  } catch (err) { next(err); }
});

// POST /api/liquidation/:id/cancel
liquidationRouter.post('/:id/cancel', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidation = await prisma.liquidation.findUnique({ where: { id: req.params.id } });
    if (!liquidation) throw new NotFoundError('Liquidación');
    if (liquidation.status === LiquidationStatus.ANULADO) {
      throw new AppError(409, 'La liquidación ya está anulada');
    }
    await prisma.liquidation.update({
      where: { id: req.params.id },
      data: { status: LiquidationStatus.ANULADO },
    });
    res.json({ message: 'Liquidación anulada exitosamente' });
  } catch (err) { next(err); }
});

// GET /api/liquidation/:id/recibo
liquidationRouter.get('/:id/recibo', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidation = await prisma.liquidation.findUnique({
      where: { id: req.params.id },
      include: {
        items: { orderBy: [{ itemType: 'asc' }] },
        period: true,
      },
    });
    if (!liquidation) throw new NotFoundError('Liquidación');

    const employee = await prisma.employee.findUnique({
      where: { id: liquidation.employeeId },
      include: { company: true },
    });
    if (!employee) throw new NotFoundError('Empleado');

    const pdfBuffer = await generateReciboPDF(liquidation, employee);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="recibo_${liquidation.employeeId}_${liquidation.year}_${liquidation.month}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

// POST /api/liquidation/:id/adjustment
liquidationRouter.post('/:id/adjustment', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      concepto: z.string().min(1),
      descripcion: z.string().min(1),
      amount: z.string().transform((v) => BigInt(v)),
      itemType: z.enum(['HABER', 'DESCUENTO_OBRERO', 'APORTE_PATRONAL', 'INFORMATIVO']),
      reason: z.string().min(10, 'Debe especificar el motivo del ajuste (mínimo 10 caracteres)'),
    });
    const data = schema.parse(req.body);

    const liquidation = await prisma.liquidation.findUnique({ where: { id: req.params.id } });
    if (!liquidation) throw new NotFoundError('Liquidación');
    if (liquidation.status === LiquidationStatus.ANULADO) {
      throw new AppError(409, 'No se pueden agregar ajustes a una liquidación anulada');
    }

    const adjustment = await prisma.payrollAdjustment.create({
      data: {
        liquidationId: req.params.id,
        employeeId: liquidation.employeeId,
        ...data,
        createdBy: req.user!.userId,
      },
    });
    res.status(201).json({
      ...adjustment,
      amount: adjustment.amount.toString(),
    });
  } catch (err) { next(err); }
});

// GET /api/liquidation/period/:periodId  (incluye datos de la persona)
liquidationRouter.get('/period/:periodId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidations = await prisma.liquidation.findMany({
      where: {
        periodId: req.params.periodId,
      },
      include: {
        employee: { select: { id: true, ci: true, nombre: true, apellido: true } },
        items: { where: { itemType: { in: ['HABER', 'DESCUENTO_OBRERO'] } } },
      },
      orderBy: [{ employeeId: 'asc' }, { type: 'asc' }],
    });
    res.json(liquidations.map((l) => ({
      ...l,
      totalHaberes: l.totalHaberes.toString(),
      totalDescuentos: l.totalDescuentos.toString(),
      totalPatronal: l.totalPatronal.toString(),
      liquidoPercibir: l.liquidoPercibir.toString(),
      items: l.items.map((i) => ({
        ...i,
        baseCalculo: i.baseCalculo?.toString() ?? null,
        amount: i.amount.toString(),
      })),
    })));
  } catch (err) { next(err); }
});
