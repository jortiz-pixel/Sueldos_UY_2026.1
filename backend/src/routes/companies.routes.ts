import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { accessibleCompanyIds, assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';

export const companiesRouter = Router();

const optionalDate = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.coerce.date().optional(),
);

const companySchema = z.object({
  rut: z.string().min(1),
  razonSocial: z.string().min(1),
  nombreFantasia: z.string().optional(),
  domicilio: z.string().optional(),
  localidad: z.string().optional(),
  departamento: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  actividadPrincipal: z.string().optional(),
  grupoActividad: z.string().optional(),
  bseRate: z.number().int().min(0).max(10000).default(25),

  // Datos BPS / MTSS / BSE (GNS)
  numeroBps: z.string().optional(),
  numeroBse: z.string().optional(),
  tipoAporte: z.number().int().optional().nullable(),
  tipoContribuyente: z.number().int().optional().nullable(),
  grupoActividadNum: z.number().int().optional().nullable(),
  subgrupo: z.string().optional(),
  naturalezaJuridica: z.string().optional(),
  convenioColectivo: z.string().optional(),
  representanteLegal: z.string().optional(),
  representanteCi: z.string().optional(),
  representanteCargo: z.string().optional(),
  inicioActividadMtss: optionalDate,
  fechaInscripcionBps: optionalDate,

  // Exoneraciones (basis points)
  exoApoJub: z.number().int().min(0).max(10000).optional(),
  exoFonasa: z.number().int().min(0).max(10000).optional(),
  exoFrl: z.number().int().min(0).max(10000).optional(),
  exoCcm: z.number().int().min(0).max(10000).optional(),

  // Configuración de licencia / calendario
  diaVencimientoBps: z.number().int().min(1).max(28).optional(),
  diasLicenciaAnio: z.number().int().min(0).max(60).optional(),
  primerDiaExtraDesdeAnio: z.number().int().min(0).max(50).optional(),
  maxDiasExtras: z.number().int().min(0).max(90).optional(),
  diasTrabajadosMes: z.number().int().min(1).max(31).optional(),

  observaciones: z.string().optional(),
});

// GET /api/companies
companiesRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ids = await accessibleCompanyIds(req);
    const where = ids === 'ALL' ? {} : { id: { in: ids } };

    const companies = await prisma.company.findMany({
      where: { ...where, active: true },
      orderBy: { razonSocial: 'asc' },
      include: { _count: { select: { employees: { where: { active: true } } } } },
    });
    res.json(companies);
  } catch (err) { next(err); }
});

// GET /api/companies/:id
companiesRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { employees: { where: { active: true } } } } },
    });
    if (!company) throw new NotFoundError('Empresa');
    await assertCompanyAccess(req, company.id);
    res.json(company);
  } catch (err) { next(err); }
});

// POST /api/companies
companiesRouter.post('/', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = companySchema.parse(req.body);
    const company = await prisma.company.create({ data });
    res.status(201).json(company);
  } catch (err) { next(err); }
});

// PUT /api/companies/:id
companiesRouter.put('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Anti-IDOR: un operador solo puede modificar empresas a las que tiene acceso
    // (evita reescribir RUT/razón social/BSE de otra empresa por su id).
    const existing = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Empresa');
    await assertCompanyAccess(req, existing.id);

    const data = companySchema.partial().parse(req.body);
    const company = await prisma.company.update({ where: { id: req.params.id }, data });
    res.json(company);
  } catch (err) { next(err); }
});

// PATCH /api/companies/:id/visibility  → ocultar / mostrar (no elimina)
companiesRouter.patch('/:id/visibility', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { hidden } = z.object({ hidden: z.boolean() }).parse(req.body);
    const company = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!company) throw new NotFoundError('Empresa');
    await assertCompanyAccess(req, company.id);
    const updated = await prisma.company.update({ where: { id: req.params.id }, data: { hidden } });
    res.json({ id: updated.id, hidden: updated.hidden });
  } catch (err) { next(err); }
});

// DELETE /api/companies/:id (baja lógica) — solo si no tiene empleados activos.
companiesRouter.delete('/:id', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const company = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!company) throw new NotFoundError('Empresa');

    const empleadosActivos = await prisma.employee.count({ where: { companyId: req.params.id, active: true } });
    if (empleadosActivos > 0) {
      throw new AppError(
        409,
        `No se puede eliminar ${company.razonSocial}: tiene ${empleadosActivos} empleado(s) activo(s). ` +
        `Desvinculá o trasladá a las personas primero, o usá "Ocultar" para sacarla del selector sin eliminarla.`,
      );
    }

    await prisma.company.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ message: 'Empresa eliminada exitosamente' });
  } catch (err) { next(err); }
});

// GET /api/companies/:id/users
companiesRouter.get('/:id/users', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Anti-IDOR: no exponer los usuarios (emails) de una empresa ajena.
    await assertCompanyAccess(req, req.params.id);
    const users = await prisma.user.findMany({
      where: { companyId: req.params.id },
      select: { id: true, email: true, nombre: true, apellido: true, role: true, active: true, lastLoginAt: true },
    });
    res.json(users);
  } catch (err) { next(err); }
});

// POST /api/companies/:id/users
companiesRouter.post('/:id/users', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bcrypt = await import('bcryptjs');
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      nombre: z.string().min(1),
      apellido: z.string().min(1),
      role: z.nativeEnum(UserRole).default(UserRole.OPERATOR),
    });
    const { password, ...data } = schema.parse(req.body);
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { ...data, passwordHash, companyId: req.params.id },
      select: { id: true, email: true, nombre: true, apellido: true, role: true },
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
});
