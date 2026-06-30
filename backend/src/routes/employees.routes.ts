import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole, SalaryType, EstadoCivil, Contrato } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess, accessibleCompanyIds } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { calcularAntiguedad, diasLicenciaCorrespondientes } from '../utils/date';
import { calcularLiquidacionFinal } from '../services/vacation.service';

export const employeesRouter = Router();

const personFields = {
  ci: z.string().min(1),
  employeeNumber: z.number().int().positive().optional(),
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
  observaciones: z.string().optional(),
};

const contratoFields = {
  companyId: z.string().cuid(),
  vigenciaDesde: z.string().optional(),
  fechaFin: z.string().optional(),
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

async function checkCompanyAccess(req: Request, companyId: string | null): Promise<void> {
  await assertCompanyAccess(req, companyId);
}

/**
 * Una persona es global y puede estar vinculada a varias empresas (vía contratos).
 * Concede acceso si el usuario puede ver CUALQUIERA de las empresas de la persona
 * (o es ADMIN de plataforma). Reemplaza el chequeo viejo contra una sola empresa.
 */
async function assertPersonaAccess(req: Request, employeeId: string, legacyCompanyId: string | null): Promise<void> {
  if (req.user!.role === UserRole.ADMIN) return;
  const ids = await accessibleCompanyIds(req);
  if (ids === 'ALL') return;
  const contratos = await prisma.contrato.findMany({ where: { employeeId }, select: { companyId: true } });
  const empresasPersona = new Set<string>([
    ...(legacyCompanyId ? [legacyCompanyId] : []),
    ...contratos.map((c) => c.companyId).filter((id): id is string => id !== null),
  ]);
  if (![...empresasPersona].some((id) => ids.includes(id))) {
    throw new AppError(403, 'Acceso denegado a esta persona');
  }
}

employeesRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await checkCompanyAccess(req, companyId);

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
          id: true, ci: true, employeeNumber: true, nombre: true, apellido: true,
          estadoCivil: true, email: true, telefono: true,
          cargo: true, categoria: true, salaryType: true,
          salarioNominal: true, fechaIngreso: true, fechaEgreso: true,
          active: true, conyugeACargo: true, hijosACargo: true,
          hijosDiscapacitados: true, fonasaFamilia: true, irpfMetodo: true,
          // Contrato vigente en ESTA empresa, para mostrar datos por empresa.
          contratos: {
            where: { companyId, activo: true },
            orderBy: { vigenciaDesde: 'desc' },
            take: 1,
            select: { salarioNominal: true, cargo: true, categoria: true, salaryType: true, fechaIngreso: true },
          },
        },
      }),
    ]);

    res.json({
      // Para personas en varias empresas, los datos laborales (salario, cargo,
      // ingreso) se toman del contrato de la empresa activa, no del denormalizado.
      data: employees.map((e) => {
        const { contratos, ...rest } = e as typeof e & { contratos?: Array<Record<string, unknown>> };
        const ct = contratos?.[0];
        const merged = ct
          ? { ...rest, salarioNominal: ct.salarioNominal, cargo: ct.cargo ?? rest.cargo, categoria: ct.categoria ?? rest.categoria, salaryType: ct.salaryType, fechaIngreso: ct.fechaIngreso }
          : rest;
        return serializeEmployee(merged);
      }),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

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
    await assertPersonaAccess(req, employee.id, employee.companyId);

    const antiguedad = calcularAntiguedad(employee.fechaIngreso);
    const diasLicencia = diasLicenciaCorrespondientes(antiguedad);

    res.json({
      ...serializeEmployee(employee),
      antiguedadAnios: antiguedad,
      diasLicenciaCorresponden: diasLicencia,
    });
  } catch (err) { next(err); }
});

employeesRouter.post('/', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createEmployeeSchema.parse(req.body);
    const c = data.contrato;
    await checkCompanyAccess(req, c.companyId);

    const fechaIngreso = new Date(c.fechaIngreso);

    // El CI es único POR EMPRESA (puede repetirse entre empresas). Cada empresa
    // tiene su propia ficha de la persona, identificada por su legajo.
    const dupEnEmpresa = await prisma.employee.findFirst({
      where: { companyId: c.companyId, ci: data.ci },
    });
    if (dupEnEmpresa) {
      throw new AppError(409, `Ya existe una persona con CI ${data.ci} en esta empresa (legajo ${dupEnEmpresa.employeeNumber ?? '—'})`);
    }

    // Legajo (employeeNumber): el indicado, o automático = máximo de la empresa + 1.
    let employeeNumber = data.employeeNumber;
    if (employeeNumber == null) {
      const maxEN = await prisma.employee.aggregate({ where: { companyId: c.companyId }, _max: { employeeNumber: true } });
      employeeNumber = (maxEN._max.employeeNumber ?? 0) + 1;
    } else {
      const enTomado = await prisma.employee.findFirst({ where: { companyId: c.companyId, employeeNumber } });
      if (enTomado) throw new AppError(409, `El legajo ${employeeNumber} ya está usado en esta empresa`);
    }

    const employee = await prisma.employee.create({
      data: {
        ci: data.ci,
        employeeNumber,
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
        observaciones: data.observaciones,
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
        fechaFin: c.fechaFin ? new Date(c.fechaFin) : undefined,
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

employeesRouter.put('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Empleado');
    await assertPersonaAccess(req, existing.id, existing.companyId);

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

employeesRouter.delete('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Empleado');
    await assertPersonaAccess(req, existing.id, existing.companyId);
    await prisma.employee.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ message: 'Empleado desactivado exitosamente' });
  } catch (err) { next(err); }
});

// DELETE /:id/permanent  → elimina la persona DEFINITIVAMENTE.
// Solo si NO tiene contratos asociados (ni liquidaciones). Borra los registros
// dependientes huérfanos (licencias, ajustes, historial, adjuntos) en una transacción.
employeesRouter.delete('/:id/permanent', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Empleado');
    await assertPersonaAccess(req, existing.id, existing.companyId);

    const contratosCount = await prisma.contrato.count({ where: { employeeId: req.params.id } });
    if (contratosCount > 0) {
      throw new AppError(409, 'No se puede eliminar: la persona tiene contratos asociados con empresas. Quitá sus contratos primero, o usá "Desactivar".');
    }
    const liqCount = await prisma.liquidation.count({ where: { employeeId: req.params.id } });
    if (liqCount > 0) {
      throw new AppError(409, 'No se puede eliminar: la persona tiene liquidaciones registradas.');
    }

    await prisma.$transaction([
      prisma.vacationAccrual.deleteMany({ where: { employeeId: req.params.id } }),
      prisma.employeeHistory.deleteMany({ where: { employeeId: req.params.id } }),
      prisma.leaveRequest.deleteMany({ where: { employeeId: req.params.id } }),
      prisma.payrollAdjustment.deleteMany({ where: { employeeId: req.params.id } }),
      prisma.attachment.deleteMany({ where: { ownerId: req.params.id } }),
      prisma.employee.delete({ where: { id: req.params.id } }),
    ]);
    res.json({ message: 'Persona eliminada definitivamente' });
  } catch (err) { next(err); }
});

employeesRouter.get('/:id/contracts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    await assertPersonaAccess(req, employee.id, employee.companyId);

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
    await checkCompanyAccess(req, data.companyId);
    const vigenciaDesde = new Date(data.vigenciaDesde ?? data.fechaIngreso);

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
        fechaFin: data.fechaFin ? new Date(data.fechaFin) : undefined,
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
    await assertPersonaAccess(req, employee.id, employee.companyId);

    const data = contractSchema.partial().parse(req.body);
    const contrato = await prisma.contrato.update({
      where: { id: req.params.contractId },
      data: {
        ...data,
        vigenciaDesde: data.vigenciaDesde ? new Date(data.vigenciaDesde) : undefined,
        fechaFin: data.fechaFin ? new Date(data.fechaFin) : undefined,
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
    await assertPersonaAccess(req, employee.id, employee.companyId);
    await prisma.contrato.update({ where: { id: req.params.contractId }, data: { activo: false } });
    res.json({ message: 'Contrato desactivado' });
  } catch (err) { next(err); }
});

// POST /:id/contracts/:contractId/baja  → cierra el contrato con fecha de egreso.
// El contrato sigue 'activo' (es real, fue cumplido) pero termina en esa fecha:
// deja de ser vigente para liquidar a partir de ahí (genera el hueco entre zafras).
// La persona queda disponible para una nueva alta (nuevo contrato) más adelante.
employeesRouter.post('/:id/contracts/:contractId/baja', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    await assertPersonaAccess(req, employee.id, employee.companyId);

    const { fechaEgreso, motivo } = z.object({
      fechaEgreso: z.string().min(1),
      motivo: z.string().optional(),
    }).parse(req.body);
    const fecha = new Date(fechaEgreso);

    const contrato = await prisma.contrato.findUnique({ where: { id: req.params.contractId } });
    if (!contrato || contrato.employeeId !== req.params.id) throw new NotFoundError('Contrato');

    // 1) Cerrar el contrato a la fecha de egreso.
    const updated = await prisma.contrato.update({
      where: { id: req.params.contractId },
      data: {
        fechaFin: fecha,
        vigenciaHasta: fecha,
        observacion: motivo ? `${contrato.observacion ? contrato.observacion + ' · ' : ''}Baja: ${motivo}` : contrato.observacion,
      },
    });

    // 2) Generar automáticamente la liquidación final (egreso) a esa fecha,
    //    para la empresa del contrato (desvinculación en todos sus términos).
    let liquidacionFinalId: string | null = null;
    let avisoFinal: string | undefined;
    try {
      const result = await calcularLiquidacionFinal(req.params.id, req.params.contractId, fecha, req.user!.userId, contrato.companyId ?? undefined);
      liquidacionFinalId = result.liquidacionId;
    } catch (e) {
      avisoFinal = `El contrato se dio de baja, pero no se pudo generar la liquidación final: ${(e as Error).message}`;
    }

    // 3) Si no le quedan contratos vigentes en NINGUNA empresa, inactivar la persona.
    const otrosVigentes = await prisma.contrato.count({
      where: {
        employeeId: req.params.id,
        activo: true,
        AND: [
          { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gt: fecha } }] },
          { OR: [{ fechaFin: null }, { fechaFin: { gt: fecha } }] },
        ],
      },
    });
    if (otrosVigentes === 0) {
      await prisma.employee.update({ where: { id: req.params.id }, data: { fechaEgreso: fecha, active: false } });
    }

    res.json({
      ...serializeContrato(updated),
      liquidacionFinalId,
      desvinculadaTotal: otrosVigentes === 0,
      aviso: avisoFinal,
    });
  } catch (err) { next(err); }
});

employeesRouter.get('/:id/history', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw new NotFoundError('Empleado');
    await assertPersonaAccess(req, employee.id, employee.companyId);
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
    await assertPersonaAccess(req, employee.id, employee.companyId);
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
    await assertPersonaAccess(req, employee.id, employee.companyId);
    const accruals = await prisma.vacationAccrual.findMany({
      where: { employeeId: req.params.id },
      orderBy: { year: 'desc' },
    });
    res.json(accruals);
  } catch (err) { next(err); }
});
