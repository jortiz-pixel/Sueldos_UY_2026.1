import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError } from '../middleware/errorHandler';
import { getCalendarEvents } from '../services/calendar.service';

export const calendarRouter = Router();

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
