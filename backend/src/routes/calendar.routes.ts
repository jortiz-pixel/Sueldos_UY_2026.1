import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { getCalendarEvents } from '../services/calendar.service';
import { calcularAntiguedad, calcularAntiguedadMeses, diasLicenciaCorrespondientes } from '../utils/date';

export const calendarRouter = Router();

// GET /api/calendar/month?companyId=&year=&month= → eventos del mes (para la grilla)
calendarRouter.get('/month', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.query.companyId ?? '');
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const year = parseInt(String(req.query.year), 10);
    const month = parseInt(String(req.query.month), 10);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) throw new AppError(400, 'year y month requeridos');

    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0);
    const events = await getCalendarEvents(companyId, from, to);
    res.json(events);
  } catch (err) { next(err); }
});

// ── Licencias ──────────────────────────────────────────────────────

// Días de licencia entre dos fechas (inclusive), sin contar domingos.
function diasLicencia(desde: Date, hasta: Date): number {
  let n = 0;
  const d = new Date(desde);
  while (d <= hasta) {
    if (d.getDay() !== 0) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

// Días de licencia que corresponden gozar en `year` (generados el año anterior).
// Ley 12.590: 20 días base, +1 cada 4 años a partir del 5° de antigüedad
// (escala simplificada 20/25/30 de utils/date). Primer año: proporcional
// a los meses trabajados hasta el 31/12 del año de generación (1,67/mes).
function diasCorrespondenAnio(fechaIngreso: Date, year: number): number {
  const cierreGeneracion = new Date(year - 1, 11, 31);
  if (fechaIngreso > cierreGeneracion) return 0; // ingresó este año: aún no generó
  const meses = calcularAntiguedadMeses(fechaIngreso, cierreGeneracion);
  if (meses < 12) return Math.round((meses * 20) / 12);
  return diasLicenciaCorrespondientes(calcularAntiguedad(fechaIngreso, cierreGeneracion));
}

// GET /api/calendar/leaves/saldos?companyId=&year=
// Saldo de licencia por persona: generados, tomados (agendados) y disponibles.
calendarRouter.get('/leaves/saldos', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.query.companyId ?? '');
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);

    const employees = await prisma.employee.findMany({
      where: { companyId, active: true },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
      select: { id: true, ci: true, nombre: true, apellido: true, fechaIngreso: true },
    });

    const desde = new Date(year, 0, 1);
    const hasta = new Date(year, 11, 31);
    const leaves = await prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        status: { in: ['PENDIENTE', 'APROBADA'] },
        fechaInicio: { lte: hasta },
        fechaFin: { gte: desde },
      },
      orderBy: { fechaInicio: 'asc' },
    });

    const saldos = employees.map((e) => {
      const corresponden = diasCorrespondenAnio(new Date(e.fechaIngreso), year);
      const propias = leaves.filter((l) => l.employeeId === e.id);
      const tomados = propias.reduce((s, l) => s + l.diasHabiles, 0);
      return {
        employee: { id: e.id, ci: e.ci, nombre: e.nombre, apellido: e.apellido },
        corresponden,
        tomados,
        disponibles: corresponden - tomados,
        licencias: propias.map((l) => ({
          id: l.id,
          fechaInicio: l.fechaInicio,
          fechaFin: l.fechaFin,
          dias: l.diasHabiles,
          status: l.status,
          motivo: l.motivo,
        })),
      };
    });

    res.json({ year, saldos });
  } catch (err) { next(err); }
});

// POST /api/calendar/leaves  { employeeId, fechaInicio, fechaFin, motivo?, anticipar? }
calendarRouter.post('/leaves', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = z.object({
      employeeId: z.string().min(1),
      fechaInicio: z.string().min(1),
      fechaFin: z.string().min(1),
      motivo: z.string().optional(),
      anticipar: z.boolean().optional(),
    }).parse(req.body);

    const employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
    if (!employee) throw new NotFoundError('Empleado');
    await assertCompanyAccess(req, employee.companyId);

    const inicio = new Date(data.fechaInicio);
    const fin = new Date(data.fechaFin);
    if (fin < inicio) throw new AppError(400, 'La fecha de fin no puede ser anterior al inicio');

    const solapada = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: data.employeeId,
        status: { in: ['PENDIENTE', 'APROBADA'] },
        fechaInicio: { lte: fin },
        fechaFin: { gte: inicio },
      },
    });
    if (solapada) throw new AppError(409, 'La persona ya tiene una licencia que se superpone con esas fechas');

    // Validar saldo del año (salvo anticipo explícito).
    const dias = diasLicencia(inicio, fin);
    const year = inicio.getFullYear();
    const corresponden = diasCorrespondenAnio(new Date(employee.fechaIngreso), year);
    const tomadas = await prisma.leaveRequest.aggregate({
      where: {
        employeeId: data.employeeId,
        status: { in: ['PENDIENTE', 'APROBADA'] },
        fechaInicio: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31) },
      },
      _sum: { diasHabiles: true },
    });
    const disponibles = corresponden - (tomadas._sum.diasHabiles ?? 0);
    if (dias > disponibles && !data.anticipar) {
      throw new AppError(
        409,
        `SALDO_INSUFICIENTE: ${employee.nombre} ${employee.apellido} tiene ${Math.max(0, disponibles)} día(s) disponible(s) en ${year} y la licencia insume ${dias}. Podés registrarla igual como anticipo.`,
      );
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: data.employeeId,
        fechaInicio: inicio,
        fechaFin: fin,
        diasHabiles: diasLicencia(inicio, fin),
        motivo: data.motivo,
        status: 'APROBADA',
        approvedBy: req.user!.userId,
      },
    });
    res.status(201).json(leave);
  } catch (err) { next(err); }
});

// DELETE /api/calendar/leaves/:id → cancela una licencia
calendarRouter.delete('/leaves/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const leave = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id },
      include: { employee: true },
    });
    if (!leave) throw new NotFoundError('Licencia');
    await assertCompanyAccess(req, leave.employee.companyId);
    await prisma.leaveRequest.update({ where: { id: leave.id }, data: { status: 'CANCELADA' } });
    res.json({ message: 'Licencia cancelada' });
  } catch (err) { next(err); }
});

// GET /api/calendar?companyId=&days=45  → eventos próximos (cumpleaños, vencimientos, altas/bajas)
calendarRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.query.companyId ?? '');
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);

    const days = Math.min(Math.max(parseInt(String(req.query.days ?? '45'), 10) || 45, 1), 365);
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + days);

    const events = await getCalendarEvents(companyId, from, to);
    res.json(events);
  } catch (err) { next(err); }
});
