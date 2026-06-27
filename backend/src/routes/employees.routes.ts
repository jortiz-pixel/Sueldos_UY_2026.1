import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole, SalaryType, EstadoCivil, Contrato } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { calcularAntiguedad, diasLicenciaCorrespondientes } from '../utils/date';

export const employeesRouter = Router();

const employeeSchema = z.object({
  companyId: z.string().cuid(),
  ci: z.string().min(1),
  nombre: z.string().min(1),
  apellido: z.string().min(1),
  fechaNacimiento: z.string().datetime().optional(),
  estadoCivil: z.nativeEnum(EstadoCivil).default(EstadoCivil.SOLTERO),
  domicilio: z.string().optional(),
  localidad: z.string().optional(),
  departamento: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  telefono: z.string().optional(),
  fechaIngreso: z.string().datetime(),
  cargo: z.string().optional(),
  categoria: z.string().optional(),
  nivel: z.string().optional(),
  salaryType: z.nativeEnum(SalaryType).default(SalaryType.MENSUAL),
  salarioNominal: z.string().transform((v) => BigInt(v)),  // centésimos as string
  jornal: z.string().transform((v) => BigInt(v)).optional(),
  conyugeACargo: z.boolean().default(false),
  hijosACargo: z.number().int().min(0).default(0),
  hijosDiscapacitados: z.number().int().min(0).default(0),
  irpfMetodo: z.enum(['PROYECCION', 'SIMPLIFICADO']).default('PROYECCION'),
  irpfFicto: z.string().transform((v) => BigInt(v)).optional(),
  bpsNumero: z.string().optional(),
  fonasaFamilia: z.boolean().default(false),
});

const contractSchema = z.object({
  vigenciaDesde: z.string(),
  fechaIngreso: z.string().optional(),
  tipoContrato: z.string().optional(),
  cargo: z.string().optional(),
  sector: z.string().optional(),
  categoria: z.string().optional(),
  nivel: z.string().optional(),
  salaryType: z.nativeEnum(SalaryType).default(SalaryType.MENSUAL),
  cobra: z.string().optional(),
  salarioNominal: z.string().transform((v) => BigInt(v)),
  jornal: z.string().transform((v) => BigInt(v)).optional(),
  horasDia: z.number().int().optional(),
  regimenHorario: z.string().optional(),
  sucursal: z.string().optional(),
  moneda: z.string().default('UYU'),
  grupoActividadNum: z.number().int().optional().nullable(),
  subgrupo: z.string().optional(),
  observacion: z.string().optional(),
});

/** Serializa campos BigInt de un empleado (salarioNominal/jornal/irpfFicto) a string. */
function serializeEmployee(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...e };
  if (typeof out.salarioNominal === 'bigint') out.salarioNominal = out.salarioNominal.toString();
  if (typeof out.jornal === 'bigint') out.jornal = out.jornal.toString();
  if (typeof out.irpfFicto === 'bigint') out.irpfFicto = out.irpfFicto.toString();
  return out;
}

function serializeContrato(c: Contrato) {
  return {
    ...c,
    salarioNominal: c.salarioNominal.toString(),
    jornal: c.jornal != null ? c.jornal.toString() : null,
  };
}

/** Verifica que el usuario tiene acceso a la empresa */
function checkCompanyAccess(req: Request, companyId: string): void {
  if (req.user!.role !== UserRole.ADMIN && req.user!.companyId !== companyId) {
    throw new AppError(403, 'Acceso denegado a esta empresa');
  }
}

// GET /api/employees?companyId=&search=&page=&limit=
employeesRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    checkCompanyAccess(req, companyId);

    const search = req.query.search as string | undefined;
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '50');
    const includeInactive = req.query.includeInactive === 'true';

    const where = {
      companyId,
      active: includeInactive ? undefined : true,
      ...(search && {
        OR: [
          { nombre: { contains: search, mode: 'insensitive' as const } },
          { apellido: { contains: search, mode: 'insensitive' as const } },
          { ci: { contains: search } },
        ],
      }),
    };

    const [total, employees] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({
        where,
        orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, ci: true, nombre: true, apellido: true,
          cargo: true, categoria: true, salaryType: true,
          salarioNominal: true, fechaIngreso: true, fechaEgreso: true,
          active: true, conyugeACargo: true, hijosACargo: true,
          fonasaFamilia: true,
        },
      }),
    ]);

    res.json({
      data: employees.map((e) => serializeEmployee(e)),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// GET /api/employees/:id
employeesRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        vacationAccruals: { orderBy: { year: 'desc' }, take: 3 },
        history: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!employee) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, employee.companyId);

    const antiguedad = calcularAntiguedad(employee.fechaIngreso);
    const diasLicencia = diasLicenciaCorrespondientes(antiguedad);

    res.json({
      ...serializeEmployee(employee),
      antiguedadAnios: antiguedad,
      diasLicenciaCorresponden: diasLicencia,
    });
  } catch (err) { next(err); }
});

// POST /api/employees
employeesRouter.post('/', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = employeeSchema.parse(req.body);
    checkCompanyAccess(req, data.companyId);

    // Check CI uniqueness in company
    const existing = await prisma.employee.findUnique({
      where: { companyId_ci: { companyId: data.companyId, ci: data.ci } },
    });
    if (existing) throw new AppError(409, `Ya existe un empleado con CI ${data.ci} en esta empresa`);

    const employee = await prisma.employee.create({
      data: {
        ...data,
        fechaIngreso: new Date(data.fechaIngreso),
        fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento) : undefined,
      },
    });

    // Contrato inicial (versión 1)
    await prisma.contrato.create({
      data: {
        employeeId: employee.id,
        numero: 1,
        vigenciaDesde: employee.fechaIngreso,
        fechaIngreso: employee.fechaIngreso,
        cargo: employee.cargo,
        categoria: employee.categoria,
        nivel: employee.nivel,
        salaryType: employee.salaryType,
        salarioNominal: employee.salarioNominal,
        jornal: employee.jornal,
      },
    });

    // Initialize vacation accrual for current year
    const currentYear = new Date().getFullYear();
    const antiguedad = calcularAntiguedad(employee.fechaIngreso);
    await prisma.vacationAccrual.create({
      data: {
        employeeId: employee.id,
        year: currentYear,
        diasCorresponden: diasLicenciaCorrespondientes(antiguedad),
        diasTomados: 0,
        diasPendientes: diasLicenciaCorrespondientes(antiguedad),
      },
    });

    res.status(201).json(serializeEmployee(employee));
  } catch (err) { next(err); }
});

// PUT /api/employees/:id
employeesRouter.put('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, existing.companyId);

    const data = employeeSchema.partial().parse(req.body);

    // Track salary changes in history
    if (data.salarioNominal && data.salarioNominal !== existing.salarioNominal) {
      await prisma.employeeHistory.create({
        data: {
          employeeId: req.params.id,
          field: 'salarioNominal',
          oldValue: existing.salarioNominal.toString(),
          newValue: data.salarioNominal.toString(),
          changedBy: req.user!.userId,
          reason: req.body.reason || 'Actualización de salario',
        },
      });
    }

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: {
        ...data,
        fechaIngreso: data.fechaIngreso ? new Date(data.fechaIngreso as unknown as string) : undefined,
        fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento as unknown as string) : undefined,
      },
    });
    res.json(serializeEmployee(employee));
  } catch (err) { next(err); }
});

// DELETE /api/employees/:id (soft delete)
employeesRouter.delete('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, existing.companyId);

    await prisma.employee.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ message: 'Empleado desactivado exitosamente' });
  } catch (err) { next(err); }
});

// =============================================================
// CONTRATOS del empleado
// =============================================================

// GET /api/employees/:id/contracts
employeesRouter.get('/:id/contracts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, employee.companyId);

    const contratos = await prisma.contrato.findMany({
      where: { employeeId: req.params.id },
      orderBy: { vigenciaDesde: 'desc' },
    });
    res.json(contratos.map(serializeContrato));
  } catch (err) { next(err); }
});

// POST /api/employees/:id/contracts
employeesRouter.post('/:id/contracts', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, employee.companyId);

    const data = contractSchema.parse(req.body);
    const vigenciaDesde = new Date(data.vigenciaDesde);

    // Cerrar el contrato vigente anterior (vigenciaHasta = día previo)
    const vigente = await prisma.contrato.findFirst({
      where: { employeeId: req.params.id, vigenciaHasta: null, activo: true },
      orderBy: { vigenciaDesde: 'desc' },
    });
    if (vigente) {
      const hasta = new Date(vigenciaDesde);
      hasta.setDate(hasta.getDate() - 1);
      await prisma.contrato.update({ where: { id: vigente.id }, data: { vigenciaHasta: hasta } });
    }

    const count = await prisma.contrato.count({ where: { employeeId: req.params.id } });

    const contrato = await prisma.contrato.create({
      data: {
        employeeId: req.params.id,
        numero: count + 1,
        vigenciaDesde,
        fechaIngreso: data.fechaIngreso ? new Date(data.fechaIngreso) : employee.fechaIngreso,
        tipoContrato: data.tipoContrato,
        cargo: data.cargo,
        sector: data.sector,
        categoria: data.categoria,
        nivel: data.nivel,
        salaryType: data.salaryType,
        cobra: data.cobra,
        salarioNominal: data.salarioNominal,
        jornal: data.jornal,
        horasDia: data.horasDia,
        regimenHorario: data.regimenHorario,
        sucursal: data.sucursal,
        moneda: data.moneda,
        grupoActividadNum: data.grupoActividadNum ?? undefined,
        subgrupo: data.subgrupo,
        observacion: data.observacion,
      },
    });

    // Sincronizar el dato "vigente" legado del empleado (para listados/reportes)
    await prisma.employee.update({
      where: { id: req.params.id },
      data: {
        salaryType: data.salaryType,
        salarioNominal: data.salarioNominal,
        jornal: data.jornal ?? null,
        cargo: data.cargo ?? employee.cargo,
        categoria: data.categoria ?? employee.categoria,
        nivel: data.nivel ?? employee.nivel,
      },
    });

    res.status(201).json(serializeContrato(contrato));
  } catch (err) { next(err); }
});

// PUT /api/employees/:id/contracts/:contractId
employeesRouter.put('/:id/contracts/:contractId', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, employee.companyId);

    const data = contractSchema.partial().parse(req.body);
    const contrato = await prisma.contrato.update({
      where: { id: req.params.contractId },
      data: {
        ...data,
        vigenciaDesde: data.vigenciaDesde ? new Date(data.vigenciaDesde) : undefined,
        fechaIngreso: data.fechaIngreso ? new Date(data.fechaIngreso) : undefined,
        grupoActividadNum: data.grupoActividadNum ?? undefined,
      },
    });
    res.json(serializeContrato(contrato));
  } catch (err) { next(err); }
});

// DELETE /api/employees/:id/contracts/:contractId (desactivar)
employeesRouter.delete('/:id/contracts/:contractId', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, employee.companyId);

    await prisma.contrato.update({ where: { id: req.params.contractId }, data: { activo: false } });
    res.json({ message: 'Contrato desactivado' });
  } catch (err) { next(err); }
});

// GET /api/employees/:id/history
employeesRouter.get('/:id/history', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, employee.companyId);

    const history = await prisma.employeeHistory.findMany({
      where: { employeeId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(history);
  } catch (err) { next(err); }
});

// GET /api/employees/:id/liquidations
employeesRouter.get('/:id/liquidations', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, employee.companyId);

    const liquidations = await prisma.liquidation.findMany({
      where: { employeeId: req.params.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { items: true },
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

// GET /api/employees/:id/vacation
employeesRouter.get('/:id/vacation', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, employee.companyId);

    const accruals = await prisma.vacationAccrual.findMany({
      where: { employeeId: req.params.id },
      orderBy: { year: 'desc' },
    });
    res.json(accruals);
  } catch (err) { next(err); }
});
