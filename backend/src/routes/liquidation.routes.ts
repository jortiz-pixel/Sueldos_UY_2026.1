import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole, LiquidationStatus, PeriodStatus, ItemType, LiquidationType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { generarLiquidacionMensual, confirmarLiquidacion, valorJornalFalta } from '../services/liquidation.service';
import { calcularAguinaldo, calcularAguinaldoBrutoSemestre } from '../services/aguinaldo.service';
import { calcularLiquidacionLicencia, calcularLiquidacionFinal } from '../services/vacation.service';
import { calcularAportesObreros, calcularAportesPatronales, fonasaCargasDeSeguroSalud } from '../services/bps.service';
import { resolverContratoEnMes } from '../services/contract.service';
import { recordAudit } from '../services/audit.service';
import { calcularIrpfMensual } from '../services/irpf.service';
import { parametersService } from '../services/parameters.service';
import { generateReciboPDF, reciboFilename } from '../services/pdf.service';

export const liquidationRouter = Router();

// Control de acceso a nivel de objeto (evita IDOR entre empresas): una
// liquidación solo es accesible si el usuario tiene membresía activa sobre la
// empresa del período (o es superadmin de plataforma). Se llama en TODOS los
// endpoints que operan sobre una liquidación por :id.
async function assertLiquidationAccess(req: Request, liquidationId: string): Promise<void> {
  const liq = await prisma.liquidation.findUnique({
    where: { id: liquidationId },
    select: { period: { select: { companyId: true } }, employee: { select: { companyId: true } } },
  });
  if (!liq) throw new NotFoundError('Liquidación');
  await assertCompanyAccess(req, liq.period?.companyId ?? liq.employee?.companyId ?? null);
}


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

// DELETE /api/liquidation/periods/:id — elimina un período (y sus borradores).
// Bloquea si tiene liquidaciones confirmadas o el período está cerrado.
liquidationRouter.delete('/periods/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = await prisma.payrollPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw new NotFoundError('Período');
    await assertCompanyAccess(req, period.companyId);
    if (period.status === PeriodStatus.CERRADO) {
      throw new AppError(409, 'El período está cerrado; reabrilo antes de eliminarlo.');
    }
    const confirmadas = await prisma.liquidation.count({ where: { periodId: req.params.id, status: LiquidationStatus.CONFIRMADO } });
    if (confirmadas > 0) {
      throw new AppError(409, `El período tiene ${confirmadas} liquidación(es) confirmada(s). Desconfirmalas o anulalas antes de eliminar el período.`);
    }
    await prisma.$transaction([
      prisma.payrollItem.deleteMany({ where: { liquidation: { periodId: req.params.id } } }),
      prisma.payrollAdjustment.deleteMany({ where: { liquidation: { periodId: req.params.id } } }),
      prisma.liquidation.deleteMany({ where: { periodId: req.params.id } }),
      prisma.payrollPeriod.delete({ where: { id: req.params.id } }),
    ]);
    res.json({ message: 'Período eliminado' });
  } catch (err) { next(err); }
});

// POST /api/liquidation/confirm-batch { periodId } — confirma TODOS los borradores del período.
liquidationRouter.post('/confirm-batch', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { periodId } = z.object({ periodId: z.string().cuid() }).parse(req.body);
    const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundError('Período');
    await assertCompanyAccess(req, period.companyId);
    if (period.status === PeriodStatus.CERRADO) throw new AppError(409, 'El período está cerrado.');

    const borradores = await prisma.liquidation.findMany({ where: { periodId, status: LiquidationStatus.BORRADOR }, select: { id: true } });
    let confirmed = 0;
    const errors: Array<{ id: string; error: string }> = [];
    for (const l of borradores) {
      try {
        await recalcularLiquidacion(l.id);
        await confirmarLiquidacion(l.id, req.user!.userId);
        confirmed++;
      } catch (e) { errors.push({ id: l.id, error: (e as Error).message }); }
    }
    res.json({ confirmed, failed: errors.length, errors });
  } catch (err) { next(err); }
});

// GET /api/liquidation/period/:id/roster — personas con ≥1 día de contrato vigente en el período.
liquidationRouter.get('/period/:id/roster', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = await prisma.payrollPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw new NotFoundError('Período');
    await assertCompanyAccess(req, period.companyId);
    const monthStart = new Date(period.year, period.month - 1, 1);
    const monthEnd = new Date(period.year, period.month, 0);
    const contratos = await prisma.contrato.findMany({
      where: {
        companyId: period.companyId,
        activo: true,
        vigenciaDesde: { lte: monthEnd },
        AND: [
          { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: monthStart } }] },
          { OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }] },
        ],
      },
      select: { employeeId: true },
      distinct: ['employeeId'],
    });
    const ids = contratos.map((c) => c.employeeId);
    const employees = await prisma.employee.findMany({
      where: { id: { in: ids } },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
      select: { id: true, ci: true, employeeNumber: true, nombre: true, apellido: true, active: true, cargo: true, salarioNominal: true, fechaIngreso: true },
    });
    const excluidas = new Set(
      (await prisma.periodExclusion.findMany({ where: { periodId: period.id }, select: { employeeId: true } }))
        .map((x) => x.employeeId),
    );
    res.json(employees.map((e) => ({ ...e, salarioNominal: e.salarioNominal.toString(), excluido: excluidas.has(e.id) })));
  } catch (err) { next(err); }
});

// POST /api/liquidation/period/:id/exclude { employeeId } — excluir a una persona
// de la liquidación de ESTE período (no se liquida ni se incluye en 'Generar
// todos'). Reversible. Bloquea si la persona ya tiene una liquidación en el mes.
liquidationRouter.post('/period/:id/exclude', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = z.object({ employeeId: z.string().cuid() }).parse(req.body);
    const period = await prisma.payrollPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw new NotFoundError('Período');
    await assertCompanyAccess(req, period.companyId);
    const yaLiquidada = await prisma.liquidation.findFirst({ where: { periodId: period.id, employeeId } });
    if (yaLiquidada) throw new AppError(409, 'La persona ya tiene una liquidación en este período. Eliminá la liquidación primero.');
    await prisma.periodExclusion.upsert({
      where: { periodId_employeeId: { periodId: period.id, employeeId } },
      create: { periodId: period.id, employeeId, createdBy: req.user!.userId },
      update: {},
    });
    res.json({ message: 'Persona excluida del período' });
  } catch (err) { next(err); }
});

// DELETE /api/liquidation/period/:id/exclude/:employeeId — volver a incluir.
liquidationRouter.delete('/period/:id/exclude/:employeeId', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = await prisma.payrollPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw new NotFoundError('Período');
    await assertCompanyAccess(req, period.companyId);
    await prisma.periodExclusion.deleteMany({ where: { periodId: period.id, employeeId: req.params.employeeId } });
    res.json({ message: 'Persona reincluida' });
  } catch (err) { next(err); }
});

// POST /api/liquidation/periods/:id/cerrar — cierra el mes (solo sin borradores).
liquidationRouter.post('/periods/:id/cerrar', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = await prisma.payrollPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw new AppError(404, 'Período no encontrado');
    await assertCompanyAccess(req, period.companyId);
    const borradores = await prisma.liquidation.count({ where: { periodId: period.id, status: LiquidationStatus.BORRADOR } });
    if (borradores > 0) throw new AppError(409, `No se puede cerrar: hay ${borradores} liquidación(es) en borrador.`);
    const updated = await prisma.payrollPeriod.update({
      where: { id: period.id },
      data: { status: PeriodStatus.CERRADO, closedAt: new Date() },
    });
    res.json({ id: updated.id, status: updated.status });
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
    await assertCompanyAccess(req, period.companyId);
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
    // Contratos que SOLAPAN el mes (incluye altas/bajas a mitad de mes),
    // mismo criterio que el roster y la nómina BPS.
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);

    const contratos = await prisma.contrato.findMany({
      where: {
        companyId,
        activo: true,
        vigenciaDesde: { lte: monthEnd },
        AND: [
          { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: monthStart } }] },
          { OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }] },
        ],
      },
      select: { employeeId: true },
      distinct: ['employeeId'],
    });

    // Saltar las personas excluidas del período (no se liquidan este mes).
    const excluidas = new Set(
      (await prisma.periodExclusion.findMany({ where: { periodId }, select: { employeeId: true } }))
        .map((x) => x.employeeId),
    );

    const results = [];
    const errors = [];

    for (const c of contratos) {
      if (excluidas.has(c.employeeId)) continue;
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
      diasHabilesTomar: z.number().min(0.01).max(31), // admite días fraccionados (ej. 8,33)
      anticipar: z.boolean().optional(),
    });
    const input = schema.parse(req.body);
    const result = await calcularLiquidacionLicencia(input);
    res.json({
      ...result,
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
        period: { include: { company: { select: { razonSocial: true, nombreFantasia: true } } } },
        employee: { select: { id: true, nombre: true, apellido: true, ci: true, employeeNumber: true } },
      },
    });
    if (!liquidation) throw new NotFoundError('Liquidación');
    await assertLiquidationAccess(req, req.params.id);

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
    await assertLiquidationAccess(req, req.params.id);
    if (liquidation.status !== LiquidationStatus.BORRADOR) {
      throw new AppError(409, 'Solo se pueden confirmar liquidaciones en estado BORRADOR');
    }
    // Recalcular aportes sobre la base gravada actual (incluye conceptos
    // manuales gravados) antes de cerrar la liquidación.
    await recalcularLiquidacion(req.params.id);
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
    await assertLiquidationAccess(req, req.params.id);
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

// DELETE /api/liquidation/:id — elimina una liquidación (y sus ítems/ajustes).
// Solo en BORRADOR: si está confirmada hay que desconfirmarla primero (así la
// nómina ya declarada no queda inconsistente).
liquidationRouter.delete('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidation = await prisma.liquidation.findUnique({ where: { id: req.params.id } });
    if (!liquidation) throw new NotFoundError('Liquidación');
    await assertLiquidationAccess(req, req.params.id);
    if (liquidation.status === LiquidationStatus.CONFIRMADO) {
      throw new AppError(409, 'La liquidación está confirmada. Desconfirmala primero para poder eliminarla.');
    }
    await prisma.$transaction([
      prisma.payrollItem.deleteMany({ where: { liquidationId: req.params.id } }),
      prisma.payrollAdjustment.deleteMany({ where: { liquidationId: req.params.id } }),
      prisma.liquidation.delete({ where: { id: req.params.id } }),
    ]);
    await recordAudit({ action: 'LIQUIDATION_DELETE', entity: 'liquidation', entityId: req.params.id, newData: { employeeId: liquidation.employeeId, type: liquidation.type, year: liquidation.year, month: liquidation.month }, req });
    res.json({ message: 'Liquidación eliminada' });
  } catch (err) { next(err); }
});

// POST /api/liquidation/:id/cancel
liquidationRouter.post('/:id/cancel', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidation = await prisma.liquidation.findUnique({ where: { id: req.params.id } });
    if (!liquidation) throw new NotFoundError('Liquidación');
    await assertLiquidationAccess(req, req.params.id);
    if (liquidation.status === LiquidationStatus.ANULADO) {
      throw new AppError(409, 'La liquidación ya está anulada');
    }
    await prisma.liquidation.update({
      where: { id: req.params.id },
      data: { status: LiquidationStatus.ANULADO },
    });
    await recordAudit({ action: 'LIQUIDATION_CANCEL', entity: 'liquidation', entityId: req.params.id, newData: { employeeId: liquidation.employeeId, type: liquidation.type, year: liquidation.year, month: liquidation.month }, req });
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
    await assertLiquidationAccess(req, req.params.id);

    const employee = await prisma.employee.findUnique({
      where: { id: liquidation.employeeId },
      include: { company: true },
    });
    if (!employee) throw new NotFoundError('Empleado');

    // Contrato vigente (para Nº de contrato, cargo, sector, horario en el recibo).
    const contrato = await prisma.contrato.findFirst({
      where: { employeeId: employee.id, companyId: liquidation.period?.companyId ?? employee.companyId ?? undefined },
      orderBy: { vigenciaDesde: 'desc' },
    });

    const pdfBuffer = await generateReciboPDF(liquidation, employee, contrato);
    const nombreArchivo = `${reciboFilename(liquidation, employee)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});

// Recalcula los totales de una liquidación a partir de sus ítems.
async function recalcularTotales(liquidationId: string): Promise<void> {
  const items = await prisma.payrollItem.findMany({
    where: { liquidationId },
    select: { itemType: true, amount: true },
  });
  let haberes = 0n, descuentos = 0n, patronal = 0n;
  for (const it of items) {
    if (it.itemType === 'HABER') haberes += it.amount;
    else if (it.itemType === 'DESCUENTO_OBRERO') descuentos += it.amount;
    else if (it.itemType === 'APORTE_PATRONAL') patronal += it.amount;
  }
  await prisma.liquidation.update({
    where: { id: liquidationId },
    data: { totalHaberes: haberes, totalDescuentos: descuentos, totalPatronal: patronal, liquidoPercibir: haberes - descuentos },
  });
}

// Conceptos HABER que NO entran a la base de aportes (no gravados).
const HABER_NO_GRAVADO = new Set(['SALARIO_VACACIONAL', 'AJUSTE_NO_GRAVADO']);

// Para liquidaciones MENSUALES, recomputa los aportes legales (BPS/FONASA/FRL/
// IRPF + patronales) sobre la base gravada ACTUAL — así los conceptos manuales
// gravados (p. ej. prima por antigüedad) entran al monto imponible. Luego
// recalcula los totales. Para otros tipos, solo recalcula totales.
async function recalcularLiquidacion(liquidationId: string): Promise<void> {
  const liq = await prisma.liquidation.findUnique({
    where: { id: liquidationId },
    include: { items: true, period: { include: { company: true } } },
  });
  if (!liq) return;
  if (liq.type !== LiquidationType.MENSUAL) { await recalcularTotales(liquidationId); return; }

  const employee = await prisma.employee.findUnique({ where: { id: liq.employeeId } });
  if (!employee) { await recalcularTotales(liquidationId); return; }

  const asOf = new Date(liq.year, liq.month - 1, 1);
  const params = await parametersService.getPayrollParameters(asOf);
  const bseRate = liq.period?.company?.bseRate ?? 0;

  // Gravado de los conceptos configurados de la empresa (por código).
  const companyId = liq.period?.companyId;
  const conceptos = companyId
    ? await prisma.concepto.findMany({ where: { OR: [{ companyId }, { companyId: null }] }, select: { codigo: true, gravado: true } })
    : [];
  const gravadoPorCodigo = new Map(conceptos.map((c) => [c.codigo, c.gravado]));

  // Base gravada = suma de los HABER gravados (incluye los manuales por defecto).
  let baseGravada = 0n;
  for (const it of liq.items) {
    if (it.itemType !== ItemType.HABER) continue;
    let gravado: boolean;
    // FALTAS es un haber negativo que SÍ integra la base imponible: reduce el
    // nominal sobre el que se calculan los aportes (aunque el catálogo la marque
    // como no gravada, porque ahí figura del lado de los descuentos).
    if (it.concepto === 'FALTAS') gravado = true;
    else if (HABER_NO_GRAVADO.has(it.concepto)) gravado = false;
    else if (gravadoPorCodigo.has(it.concepto)) gravado = gravadoPorCodigo.get(it.concepto)!;
    else gravado = true;
    if (gravado) baseGravada += it.amount;
  }

  // Junio/diciembre: el adicional FONASA del aguinaldo se cobra en la mensualidad
  // (base = nominal del mes + aguinaldo del semestre).
  const fonasaAdicionalExtraBase = (liq.month === 6 || liq.month === 12)
    ? (await calcularAguinaldoBrutoSemestre(liq.employeeId, liq.year, liq.month)).bruto
    : 0n;

  // Adicional FONASA según el Seguro de Salud (Tabla 8) del contrato vigente del
  // mes; si el código no lo determina, se usan los datos del empleado.
  const contratoMes = companyId ? await resolverContratoEnMes(liq.employeeId, liq.year, liq.month, companyId) : null;
  const cargasFonasa = fonasaCargasDeSeguroSalud(contratoMes?.seguroSalud);
  const fonasaHijos = cargasFonasa ? (cargasFonasa.hijos ? 1 : 0) : employee.hijosACargo;
  const fonasaConyuge = cargasFonasa ? cargasFonasa.conyuge : employee.conyugeACargo;

  const obreros = calcularAportesObreros({ salarioNominal: baseGravada, hijosACargo: fonasaHijos, conyugeACargo: fonasaConyuge, params, bseRateEmpresa: bseRate, fonasaAdicionalExtraBase });
  const patronales = calcularAportesPatronales({ salarioNominal: baseGravada, fonasaFamilia: employee.fonasaFamilia, params, bseRateEmpresa: bseRate, fonasaPatronalRate: 500 });
  const irpf = calcularIrpfMensual({
    salarioNominal: baseGravada,
    fonasaMensual: obreros.fonasaTotal,
    bpsMensual: obreros.jubilatorio,
    hijosACargo: employee.hijosACargo,
    hijosDiscapacitados: employee.hijosDiscapacitados,
    conyugeACargo: employee.conyugeACargo,
    params,
  });

  const updates: Array<{ concepto: string; amount: bigint; rate?: number; descripcion: string }> = [
    { concepto: 'BPS_JUBILATORIO', amount: obreros.jubilatorio, rate: params.bpsJubilatorioRate, descripcion: 'BPS Jubilatorio' },
    // FONASA (Seguro por Enfermedad): 3% fijo sobre el total de haberes.
    { concepto: 'FONASA', amount: obreros.fonasaBasico, rate: obreros.detail.fonasaSeguroRate, descripcion: 'FONASA (Seguro por Enfermedad)' },
    { concepto: 'FRL', amount: obreros.frl, rate: params.frlObreroRate, descripcion: 'Fondo de Reconversión Laboral' },
    { concepto: 'BPS_IVS_PATRONAL', amount: patronales.bpsIvs, rate: params.bpsIvsPatronalRate, descripcion: 'BPS IVS Patronal' },
    { concepto: 'FONASA_PATRONAL', amount: patronales.fonasa, descripcion: 'FONASA Patronal' },
    { concepto: 'FRL_PATRONAL', amount: patronales.frl, rate: params.frlPatronalRate, descripcion: 'Fondo de Reconversión Laboral (Patronal)' },
    { concepto: 'BSE', amount: patronales.bse, rate: bseRate, descripcion: 'BSE — Seguro de Accidentes del Trabajo' },
  ];
  for (const u of updates) {
    const item = liq.items.find((i) => i.concepto === u.concepto);
    if (item) {
      await prisma.payrollItem.update({
        where: { id: item.id },
        data: { baseCalculo: baseGravada, amount: u.amount, descripcion: u.descripcion, ...(u.rate !== undefined ? { rate: u.rate } : {}) },
      });
    }
  }

  // Adicional FONASA: partida separada. Su base incluye el aguinaldo en junio/
  // diciembre. Se crea/actualiza si corresponde y se elimina si quedó en 0.
  const adicionalItem = liq.items.find((i) => i.concepto === 'FONASA_ADICIONAL');
  if (obreros.fonasaFamilia > 0n) {
    const adicData = {
      baseCalculo: obreros.detail.fonasaAdicionalBase,
      rate: obreros.detail.fonasaAdicionalRate,
      amount: obreros.fonasaFamilia,
      descripcion: 'Adicional FONASA',
    };
    if (adicionalItem) {
      await prisma.payrollItem.update({ where: { id: adicionalItem.id }, data: adicData });
    } else {
      await prisma.payrollItem.create({
        data: { liquidationId, employeeId: liq.employeeId, itemType: ItemType.DESCUENTO_OBRERO, concepto: 'FONASA_ADICIONAL', ...adicData },
      });
    }
  } else if (adicionalItem) {
    await prisma.payrollItem.delete({ where: { id: adicionalItem.id } });
  }

  const irpfItem = liq.items.find((i) => i.concepto === 'IRPF');
  if (irpfItem) {
    await prisma.payrollItem.update({ where: { id: irpfItem.id }, data: { baseCalculo: baseGravada, amount: irpf.retencionMensual } });
  } else if (irpf.retencionMensual > 0n) {
    await prisma.payrollItem.create({
      data: {
        liquidationId, employeeId: liq.employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'IRPF', descripcion: 'IRPF — Impuesto a la Renta de las Personas Físicas (Cat. II)',
        baseCalculo: baseGravada, amount: irpf.retencionMensual,
      },
    });
  }

  await recalcularTotales(liquidationId);
}

// POST /api/liquidation/:id/item — agregar un concepto manual (suma o resta) y recalcular
liquidationRouter.post('/:id/item', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      descripcion: z.string().min(1),
      monto: z.number().positive().optional(),      // en pesos (o usar cantidad para faltas)
      cantidad: z.number().positive().optional(),   // cantidad de faltas (días); el monto se calcula solo
      itemType: z.enum(['HABER', 'DESCUENTO_OBRERO']),
      gravado: z.boolean().optional(),              // solo aplica a HABER; por defecto gravado
    });
    const data = schema.parse(req.body);

    const liquidation = await prisma.liquidation.findUnique({ where: { id: req.params.id } });
    if (!liquidation) throw new NotFoundError('Liquidación');
    await assertLiquidationAccess(req, req.params.id);
    if (liquidation.status !== LiquidationStatus.BORRADOR) {
      throw new AppError(409, 'Solo se pueden agregar conceptos a liquidaciones en BORRADOR. Desconfirmá primero.');
    }

    // FALTAS: aunque se elijan desde la columna de Descuentos, van del lado de
    // los HABERES como un haber NEGATIVO (estilo GNS). Así el "Total de Haberes"
    // sale NETO de faltas y sobre ese neto se calculan TODOS los aportes e IRPF.
    // Se detectan por la descripción (concepto FALTAS del catálogo).
    const esFalta = /\bfaltas?\b/i.test(data.descripcion);

    // Importe del ítem. Para faltas con cantidad, se calcula automáticamente:
    // valor de una falta (mensual: nominal/30 · jornalero: jornal) × cantidad.
    let centesimos: bigint;
    let descripcionFinal = data.descripcion;
    if (esFalta && data.cantidad !== undefined) {
      const jornalCent = await valorJornalFalta(liquidation.id);
      centesimos = BigInt(Math.round(Number(jornalCent) * data.cantidad));
      const jornalTxt = (Number(jornalCent) / 100).toFixed(2);
      descripcionFinal = `Faltas ${data.cantidad} x ${jornalTxt}`;
    } else if (data.monto !== undefined) {
      centesimos = BigInt(Math.round(data.monto * 100));
    } else {
      throw new AppError(400, 'Indicá el monto o la cantidad de faltas.');
    }

    // Un haber manual es gravado por defecto (entra al imponible). Si se marca
    // como no gravado, se etiqueta para excluirlo de la base de aportes.
    const noGravado = data.itemType === 'HABER' && data.gravado === false;
    await prisma.payrollItem.create({
      data: {
        liquidationId: liquidation.id,
        employeeId: liquidation.employeeId,
        itemType: esFalta ? ItemType.HABER : data.itemType,
        concepto: esFalta ? 'FALTAS' : (noGravado ? 'AJUSTE_NO_GRAVADO' : 'AJUSTE'),
        descripcion: descripcionFinal,
        amount: esFalta ? -centesimos : centesimos, // la falta siempre resta
      },
    });
    await recalcularLiquidacion(liquidation.id);
    res.status(201).json({ message: 'Concepto agregado' });
  } catch (err) { next(err); }
});

// DELETE /api/liquidation/:id/item/:itemId — quitar un concepto agregado manualmente
liquidationRouter.delete('/:id/item/:itemId', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidation = await prisma.liquidation.findUnique({ where: { id: req.params.id } });
    if (!liquidation) throw new NotFoundError('Liquidación');
    await assertLiquidationAccess(req, req.params.id);
    if (liquidation.status !== LiquidationStatus.BORRADOR) {
      throw new AppError(409, 'Solo se pueden quitar conceptos en BORRADOR. Desconfirmá primero.');
    }
    const item = await prisma.payrollItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.liquidationId !== liquidation.id) throw new NotFoundError('Concepto');
    // Solo los conceptos agregados a mano: ajustes (AJUSTE/AJUSTE_NO_GRAVADO) y
    // faltas (FALTAS). Los aportes legales se recalculan, no se borran.
    const esManual = item.concepto.startsWith('AJUSTE') || item.concepto === 'FALTAS';
    if (!esManual) {
      throw new AppError(409, 'Solo se pueden quitar los conceptos agregados manualmente');
    }
    await prisma.payrollItem.delete({ where: { id: item.id } });
    await recalcularLiquidacion(liquidation.id);
    res.json({ message: 'Concepto eliminado' });
  } catch (err) { next(err); }
});

// PATCH /api/liquidation/:id/item/:itemId — editar un concepto (descripción y/o monto) y recalcular
liquidationRouter.patch('/:id/item/:itemId', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      descripcion: z.string().min(1).optional(),
      monto: z.number().nonnegative().optional(),
    });
    const data = schema.parse(req.body);

    const liquidation = await prisma.liquidation.findUnique({ where: { id: req.params.id } });
    if (!liquidation) throw new NotFoundError('Liquidación');
    await assertLiquidationAccess(req, req.params.id);
    if (liquidation.status !== LiquidationStatus.BORRADOR) {
      throw new AppError(409, 'Solo se pueden editar conceptos en BORRADOR. Desconfirmá primero.');
    }
    const item = await prisma.payrollItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.liquidationId !== liquidation.id) throw new NotFoundError('Concepto');

    // Al editar el monto, la falta se mantiene como haber negativo.
    let nuevoMonto: bigint | undefined;
    if (data.monto !== undefined) {
      const centesimos = BigInt(Math.round(data.monto * 100));
      nuevoMonto = item.concepto === 'FALTAS' ? -(centesimos < 0n ? -centesimos : centesimos) : centesimos;
    }

    await prisma.payrollItem.update({
      where: { id: item.id },
      data: {
        descripcion: data.descripcion ?? undefined,
        amount: nuevoMonto,
      },
    });
    await recalcularLiquidacion(liquidation.id);
    res.json({ message: 'Concepto actualizado' });
  } catch (err) { next(err); }
});

// POST /api/liquidation/:id/recalcular — recomputa los aportes sobre la base
// gravada actual (incluye conceptos manuales gravados). Disparo manual.
liquidationRouter.post('/:id/recalcular', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const liquidation = await prisma.liquidation.findUnique({ where: { id: req.params.id } });
    if (!liquidation) throw new NotFoundError('Liquidación');
    await assertLiquidationAccess(req, req.params.id);
    if (liquidation.status !== LiquidationStatus.BORRADOR) {
      throw new AppError(409, 'Solo se puede recalcular en BORRADOR. Desconfirmá primero.');
    }
    await recalcularLiquidacion(req.params.id);
    res.json({ message: 'Liquidación recalculada' });
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
    await assertLiquidationAccess(req, req.params.id);
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
