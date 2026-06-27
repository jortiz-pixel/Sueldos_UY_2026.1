import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';

export const catalogsRouter = Router();

// GET /api/catalogs/tipos-aporte
catalogsRouter.get('/tipos-aporte', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.tipoAporte.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/catalogs/tipos-contribuyente
catalogsRouter.get('/tipos-contribuyente', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.tipoContribuyente.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/catalogs/grupos-actividad (incluye subgrupos)
catalogsRouter.get('/grupos-actividad', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.grupoActividad.findMany({
      orderBy: { numero: 'asc' },
      include: { subgrupos: { orderBy: { numero: 'asc' } } },
    });
    res.json(data);
  } catch (err) { next(err); }
});
