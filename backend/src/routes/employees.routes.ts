import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole, SalaryType, EstadoCivil, Contrato } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { calcularAntiguedad, diasLicenciaCorrespondientes } from '../utils/date';

export const employeesRouter = Router();

const personFields = {
  ci: z.string().min(1),
  nombre: z.string().min(1),
  apellido: z.string().min(1),
  fechaNacimiento: z.string().optional(),
  estadoCivil: z.nativeEnum(EstadoCivil).default(EstadoCivil.SOLTERO),
  domicilio: z.string().optional(),
  localidad: z.string().optional(),
  departamento: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  telefono: z.string().optional(),
  conyugeACargo: z.boolean().default(false),
  hijosACargo: z.number().int().min(0).default(0),
  hijosDiscapacitados: z.number().int().min(0).default(0),
  irpfMetodo: z.enum(['PROYECCION', 'SIMPLIFICADO']).default('PROYECCION'),
  irpfFicto: z.string().transform((v) => BigInt(v)).optional(),
  bpsNumero: z.string().optional(),
  fonasaFamilia: z.boolean().default(false),
};

const contratoFields = {
  companyId: z.string().cuid(),
  vigenciaDesde: z.string().optional(),
  fechaIngreso: z.string(),
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
};

const createEmployeeSchema = z.object({ ...personFields, contrato: z.object(contratoFields) });
const updatePersonSchema = z.object(personFields).partial();
const contractSchema = z.object(contratoFields);

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

function checkCompanyAccess(req: Request, companyId: string | null): void {
  if (req.user!.role !== UserRole.ADMIN && req.user!.companyId !== companyId) {
    throw new AppError(403, 'Acceso denegado a esta empresa');
  }
}

// GET /api/employees?companyId=&search=&page=&limit=  (personas con contrato en la empresa)
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
      contratos: { some: { companyId } },
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

// POST /api/employees  (crea la persona + su primer contrato)
employeesRouter.post('/', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createEmployeeSchema.parse(req.body);
    const c = data.contrato;
    checkCompanyAccess(req, c.companyId);

    const existing = await prisma.employee.findUnique({ where: { ci: data.ci } });
    if (existing) throw new AppError(409, `Ya existe una persona con CI ${data.ci}`);

    const fechaIngreso = new Date(c.fechaIngreso);

    const employee = await prisma.employee.create({
      data: {
        ci: data.ci,
        nombre: data.nombre,
        apellido: data.apellido,
        fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento) : undefined,
        estadoCivil: data.estadoCivil,
        domicilio: data.domicilio,
        localidad: data.localidad,
        departamento: data.departamento,
        email: data.email || undefined,
        telefono: data.telefono,
        conyugeACargo: data.conyugeACargo,
        hijosACargo: data.hijosACargo,
        hijosDiscapacitados: data.hijosDiscapacitados,
        irpfMetodo: data.irpfMetodo,
        irpfFicto: data.irpfFicto,
        bpsNumero: data.bpsNumero,
        fonasaFamilia: data.fonasaFamilia,
        // datos laborales (caché del contrato vigente) + empresa principal
        companyId: c.companyId,
        fechaIngreso,
        cargo: c.cargo,
        categoria: c.categoria,
        nivel: c.nivel,
        salaryType: c.salaryType,
        salarioNominal: c.salarioNominal,
        jornal: c.jornal,
      },
    });

    await prisma.contrato.create({
      data: {
        employeeId: employee.id,
        companyId: c.companyId,
        numero: 1,
        vigenciaDesde: c.vigenciaDesde ? new Date(c.vigenciaDesde) : fechaIngreso,
        fechaIngreso,
        tipoContrato: c.tipoContrato,
        cargo: c.cargo,
        sector: c.sector,
        categoria: c.categoria,
        nivel: c.nivel,
        salaryType: c.salaryType,
        cobra: c.cobra,
        salarioNominal: c.salarioNominal,
        jornal: c.jornal,
        horasDia: c.horasDia,
        regimenHorario: c.regimenHorario,
        sucursal: c.sucursal,
        moneda: c.moneda,
        grupoActividadNum: c.grupoActividadNum ?? undefined,
        subgrupo: c.subgrupo,
        observacion: c.observacion,
      },
    });

    const currentYear = new Date().getFullYear();
    const antiguedad = calcularAntiguedad(fechaIngreso);
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

// PUT /api/employees/:id  (actualiza datos de la persona)
employeesRouter.put('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, existing.companyId);

    const data = updatePersonSchema.parse(req.body);
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: {
        ...data,
        email: data.email === '' ? undefined : data.email,
        fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento) : undefined,
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

employeesRouter.post('/:id/contracts', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');

    const data = contractSchema.parse(req.body);
    checkCompanyAccess(req, data.companyId);
    const vigenciaDesde = new Date(data.vigenciaDesde ?? data.fechaIngreso);

    // Cerrar contrato vigente anterior de la MISMA empresa
    const vigente = await prisma.contrato.findFirst({
      where: { employeeId: req.params.id, companyId: data.companyId, vigenciaHasta: null, activo: true },
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
        companyId: data.companyId,
        numero: count + 1,
        vigenciaDesde,
        fechaIngreso: new Date(data.fechaIngreso),
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

    // Sincronizar caché laboral + empresa principal del empleado
    await prisma.employee.update({
      where: { id: req.params.id },
      data: {
        companyId: data.companyId,
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

employeesRouter.delete('/:id/contracts/:contractId', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    checkCompanyAccess(req, employee.companyId);
    await prisma.contrato.update({ where: { id: req.params.contractId }, data: { activo: false } });
    res.json({ message: 'Contrato desactivado' });
  } catch (err) { next(err); }
});

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
