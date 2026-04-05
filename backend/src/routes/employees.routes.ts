import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole, SalaryType, EstadoCivil } from '@prisma/client';
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
      data: employees,
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

    res.json({ ...employee, antiguedadAnios: antiguedad, diasLicenciaCorresponden: diasLicencia });
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

    res.status(201).json(employee);
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
    res.json(employee);
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
    res.json(liquidations);
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
