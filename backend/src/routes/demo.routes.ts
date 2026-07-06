import { Router, Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, requireRole } from '../middleware/auth';
import { seedDemoData } from '../services/demo.service';
import { recordAudit } from '../services/audit.service';

export const demoRouter = Router();

// POST /api/demo/seed — genera el plantel de prueba en la empresa Demo
// (personas, contratos, liquidaciones Ene–Jun 2026, aguinaldos y egresos).
// Solo ADMIN. Idempotente: se puede reejecutar sin duplicar personas.
demoRouter.post('/seed', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await seedDemoData(req.user!.userId);
    await recordAudit({ action: 'DEMO_SEED', entity: 'demo', newData: { ...result, errores: result.errores.length }, req });
    res.json(result);
  } catch (err) { next(err); }
});
