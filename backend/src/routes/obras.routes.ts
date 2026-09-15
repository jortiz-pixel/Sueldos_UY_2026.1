// OBRAS — datos de obra de las empresas de CONSTRUCCIÓN (Grupo 9), usados en las
// nóminas. CRUD por empresa; toda operación valida el acceso a la empresa dueña.
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { esEmpresaConstruccion } from '../services/construccion.service';

export const obrasRouter = Router();

const obraSchema = z.object({
  companyId: z.string().cuid(),
  numeroObra: z.string().min(1),
  numeroIdentificador: z.string().optional().nullable(),
  nombre: z.string().min(1),
  direccion: z.string().optional().nullable(),
  departamento: z.string().optional().nullable(),
  localidad: z.string().optional().nullable(),
  padron: z.string().optional().nullable(),
  fRealizacion: z.string().optional().nullable(),
  estado: z.string().optional().nullable(),
  aportePatronal: z.string().optional().nullable(),
  cajaActividad: z.string().optional().nullable(),
  nroAutorizacion: z.string().optional().nullable(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  observaciones: z.string().optional().nullable(),
  activa: z.boolean().optional(),
});

function toFecha(s?: string | null): Date | null {
  return s ? new Date(`${s}T00:00:00Z`) : null;
}

function serializar(o: { fechaInicio: Date | null; fechaFin: Date | null }) {
  return {
    ...o,
    fechaInicio: o.fechaInicio ? o.fechaInicio.toISOString().slice(0, 10) : null,
    fechaFin: o.fechaFin ? o.fechaFin.toISOString().slice(0, 10) : null,
  };
}

// GET /api/obras?companyId= — obras de una empresa (de construcción).
obrasRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const obras = await prisma.obra.findMany({
      where: { companyId },
      orderBy: [{ activa: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(obras.map(serializar));
  } catch (err) { next(err); }
});

// POST /api/obras — crear obra (solo empresas de construcción).
obrasRouter.post('/', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = obraSchema.parse(req.body);
    await assertCompanyAccess(req, data.companyId);
    const company = await prisma.company.findUnique({ where: { id: data.companyId } });
    if (!company) throw new NotFoundError('Empresa');
    if (!esEmpresaConstruccion(company)) {
      throw new AppError(400, 'Las obras corresponden solo a empresas de construcción (Grupo 9).');
    }
    const { fechaInicio, fechaFin, ...rest } = data;
    const obra = await prisma.obra.create({
      data: { ...rest, fechaInicio: toFecha(fechaInicio), fechaFin: toFecha(fechaFin) },
    });
    res.status(201).json(serializar(obra));
  } catch (err) { next(err); }
});

// PUT /api/obras/:id — editar obra.
obrasRouter.put('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.obra.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Obra');
    await assertCompanyAccess(req, existing.companyId);
    const data = obraSchema.partial().parse(req.body);
    const { companyId: _ignore, fechaInicio, fechaFin, ...rest } = data;
    const obra = await prisma.obra.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(fechaInicio !== undefined ? { fechaInicio: toFecha(fechaInicio) } : {}),
        ...(fechaFin !== undefined ? { fechaFin: toFecha(fechaFin) } : {}),
      },
    });
    res.json(serializar(obra));
  } catch (err) { next(err); }
});

// DELETE /api/obras/:id — eliminar obra.
obrasRouter.delete('/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.obra.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Obra');
    await assertCompanyAccess(req, existing.companyId);
    await prisma.obra.delete({ where: { id: req.params.id } });
    res.json({ message: 'Obra eliminada' });
  } catch (err) { next(err); }
});
