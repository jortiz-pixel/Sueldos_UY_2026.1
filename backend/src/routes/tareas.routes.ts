// Agenda del estudio — tareas y vencimientos (uso interno; solo staff).
import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { listarVencimientos, resumenAgenda, materializarVencimientos, ESTADOS } from '../services/tareas.service';

export const tareasRouter = Router();

// Todo el módulo es interno del estudio: solo ADMIN/OPERATOR.
tareasRouter.use(authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR));

const tareaSchema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().optional().nullable(),
  categoria: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  companyIds: z.array(z.string()).optional(), // plantilla aplicada a varios clientes
  responsableId: z.string().optional().nullable(),
  tipo: z.enum(['PUNTUAL', 'RECURRENTE']),
  recurrencia: z.enum(['MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']).optional().nullable(),
  diaVencimiento: z.number().int().min(1).max(31).optional().nullable(),
  mesAncla: z.number().int().min(1).max(12).optional().nullable(),
  fechaVencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  esVencimiento: z.boolean().optional(),
  activa: z.boolean().optional(),
});

function toFecha(s?: string | null): Date | null {
  return s ? new Date(`${s}T00:00:00Z`) : null;
}

// GET /api/tareas/clientes — TODOS los clientes visibles en Tareas: las empresas
// de Sueldos + las creadas solo para Tareas.
tareasRouter.get('/clientes', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const clientes = await prisma.company.findMany({
      where: { active: true },
      orderBy: { razonSocial: 'asc' },
      select: { id: true, razonSocial: true, nombreFantasia: true, soloTareas: true },
    });
    res.json(clientes);
  } catch (err) { next(err); }
});

// POST /api/tareas/clientes — crea un cliente SOLO para Tareas (no aparece en
// Sueldos). Necesita un nombre; el RUT es opcional (se genera un marcador único).
tareasRouter.post('/clientes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nombre, rut } = z.object({
      nombre: z.string().min(1),
      rut: z.string().optional().nullable(),
    }).parse(req.body);
    const rutFinal = (rut && rut.trim()) || `TAR-${randomBytes(6).toString('hex')}`;
    const existe = await prisma.company.findUnique({ where: { rut: rutFinal } });
    if (existe) throw new AppError(409, 'Ya existe una empresa con ese RUT.');
    const cliente = await prisma.company.create({
      data: { razonSocial: nombre.trim(), rut: rutFinal, soloTareas: true },
      select: { id: true, razonSocial: true, nombreFantasia: true, soloTareas: true },
    });
    res.status(201).json(cliente);
  } catch (err) { next(err); }
});

// GET /api/tareas/usuarios — staff del estudio (para asignar responsables).
tareasRouter.get('/usuarios', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      where: { active: true, role: { in: [UserRole.ADMIN, UserRole.OPERATOR] } },
      select: { id: true, nombre: true, apellido: true, role: true },
      orderBy: [{ nombre: 'asc' }],
    });
    res.json(users);
  } catch (err) { next(err); }
});

// GET /api/tareas — definiciones de tareas + el vencimiento del período vigente
// (para poder cambiar el estado directo desde la lista de tareas).
tareasRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { companyId, responsableId, categoria, activa, year, month } = req.query;
    // Vencimiento del MES elegido (por defecto, el mes actual).
    const hoy = new Date();
    const yy = year ? Number(year) : hoy.getUTCFullYear();
    const mm = month ? Number(month) : hoy.getUTCMonth() + 1;
    const inicioMes = new Date(Date.UTC(yy, mm - 1, 1));
    const finVentana = new Date(Date.UTC(yy, mm, 0, 23, 59, 59));
    await materializarVencimientos(inicioMes, finVentana);

    const tareas = await prisma.tarea.findMany({
      where: {
        ...(companyId ? { companyId: String(companyId) } : {}),
        ...(responsableId ? { responsableId: String(responsableId) } : {}),
        ...(categoria ? { categoria: String(categoria) } : {}),
        ...(activa != null ? { activa: activa === 'true' } : {}),
      },
      include: {
        company: { select: { id: true, razonSocial: true, nombreFantasia: true } },
        responsable: { select: { id: true, nombre: true, apellido: true } },
        vencimientos: {
          where: { fecha: { gte: inicioMes, lte: finVentana } },
          orderBy: { fecha: 'asc' },
          select: { id: true, fecha: true, estado: true },
        },
      },
      orderBy: [{ activa: 'desc' }, { titulo: 'asc' }],
    });
    // vencimientoActual = el vigente del período (el más cercano de la ventana).
    const out = tareas.map((t) => {
      const { vencimientos, ...rest } = t;
      return { ...rest, vencimientoActual: vencimientos[0] ?? null };
    });
    res.json(out);
  } catch (err) { next(err); }
});

// POST /api/tareas — crea una tarea (o una por cada cliente si viene companyIds).
tareasRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = tareaSchema.parse(req.body);
    if (data.tipo === 'RECURRENTE' && !data.recurrencia) throw new AppError(400, 'Una tarea recurrente necesita periodicidad.');
    if (data.tipo === 'PUNTUAL' && !data.fechaVencimiento) throw new AppError(400, 'Una tarea puntual necesita fecha de vencimiento.');

    const base = {
      titulo: data.titulo,
      descripcion: data.descripcion ?? null,
      categoria: data.categoria ?? null,
      responsableId: data.responsableId ?? null,
      tipo: data.tipo,
      recurrencia: data.tipo === 'RECURRENTE' ? (data.recurrencia ?? null) : null,
      diaVencimiento: data.tipo === 'RECURRENTE' ? (data.diaVencimiento ?? null) : null,
      mesAncla: data.tipo === 'RECURRENTE' ? (data.mesAncla ?? null) : null,
      fechaVencimiento: data.tipo === 'PUNTUAL' ? toFecha(data.fechaVencimiento) : null,
      esVencimiento: data.esVencimiento ?? false,
      activa: data.activa ?? true,
    };

    const targets = data.companyIds && data.companyIds.length > 0
      ? data.companyIds
      : [data.companyId ?? null];
    const creadas = await prisma.$transaction(
      targets.map((cid) => prisma.tarea.create({ data: { ...base, companyId: cid } })),
    );
    res.status(201).json({ creadas: creadas.length, tareas: creadas });
  } catch (err) { next(err); }
});

// PUT /api/tareas/:id — edita la definición.
tareasRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = tareaSchema.partial().parse(req.body);
    const existing = await prisma.tarea.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Tarea');
    const tarea = await prisma.tarea.update({
      where: { id: req.params.id },
      data: {
        ...(data.titulo !== undefined ? { titulo: data.titulo } : {}),
        ...(data.descripcion !== undefined ? { descripcion: data.descripcion ?? null } : {}),
        ...(data.categoria !== undefined ? { categoria: data.categoria ?? null } : {}),
        ...(data.companyId !== undefined ? { companyId: data.companyId ?? null } : {}),
        ...(data.responsableId !== undefined ? { responsableId: data.responsableId ?? null } : {}),
        ...(data.tipo !== undefined ? { tipo: data.tipo } : {}),
        ...(data.recurrencia !== undefined ? { recurrencia: data.recurrencia ?? null } : {}),
        ...(data.diaVencimiento !== undefined ? { diaVencimiento: data.diaVencimiento ?? null } : {}),
        ...(data.mesAncla !== undefined ? { mesAncla: data.mesAncla ?? null } : {}),
        ...(data.fechaVencimiento !== undefined ? { fechaVencimiento: toFecha(data.fechaVencimiento) } : {}),
        ...(data.esVencimiento !== undefined ? { esVencimiento: data.esVencimiento } : {}),
        ...(data.activa !== undefined ? { activa: data.activa } : {}),
      },
    });
    res.json(tarea);
  } catch (err) { next(err); }
});

// DELETE /api/tareas/:id — elimina la tarea y sus vencimientos.
tareasRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.tarea.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Tarea');
    await prisma.tarea.delete({ where: { id: req.params.id } });
    res.json({ message: 'Tarea eliminada' });
  } catch (err) { next(err); }
});

// GET /api/tareas/agenda/vencimientos?from&to&... — vencimientos del rango.
tareasRouter.get('/agenda/vencimientos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, companyId, responsableId, categoria, estado } = req.query;
    if (!from || !to) throw new AppError(400, 'Faltan from y to (YYYY-MM-DD).');
    const desde = new Date(`${String(from)}T00:00:00Z`);
    const hasta = new Date(`${String(to)}T23:59:59Z`);
    const vencimientos = await listarVencimientos(desde, hasta, {
      companyId: companyId ? String(companyId) : undefined,
      responsableId: responsableId ? String(responsableId) : undefined,
      categoria: categoria ? String(categoria) : undefined,
      estado: estado ? String(estado) : undefined,
    });
    res.json(vencimientos);
  } catch (err) { next(err); }
});

// PATCH /api/tareas/agenda/vencimientos/:id — cambia estado / nota.
tareasRouter.patch('/agenda/vencimientos/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { estado, nota } = z.object({
      estado: z.enum(ESTADOS).optional(),
      nota: z.string().optional().nullable(),
    }).parse(req.body);
    const v = await prisma.tareaVencimiento.findUnique({ where: { id: req.params.id } });
    if (!v) throw new NotFoundError('Vencimiento');
    const completado = estado && estado !== 'PENDIENTE';
    const updated = await prisma.tareaVencimiento.update({
      where: { id: req.params.id },
      data: {
        ...(estado !== undefined ? { estado } : {}),
        ...(nota !== undefined ? { nota: nota ?? null } : {}),
        ...(estado !== undefined ? {
          completadoPor: completado ? req.user!.userId : null,
          completadoAt: completado ? new Date() : null,
        } : {}),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/tareas/agenda/resumen — vencidos + próximos (Panel).
tareasRouter.get('/agenda/resumen', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await resumenAgenda());
  } catch (err) { next(err); }
});
