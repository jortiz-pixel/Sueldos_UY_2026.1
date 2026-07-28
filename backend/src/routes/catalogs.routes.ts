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
    const data = await prisma.tipoContribuyente.findMany({ orderBy: [{ tipoAporte: 'asc' }, { codigo: 'asc' }] });
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

// ---- Codificador BPS (Versión 37) ----

// GET /api/catalogs/naturaleza-juridica  (BPS Tabla 22)
catalogsRouter.get('/naturaleza-juridica', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.naturalezaJuridica.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/catalogs/causales-egreso  (BPS Tabla 9)
catalogsRouter.get('/causales-egreso', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.causalEgreso.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/catalogs/vinculos-funcionales  (BPS Tabla 3)
catalogsRouter.get('/vinculos-funcionales', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.vinculoFuncional.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/catalogs/tipos-remuneracion  (BPS Tabla 2)
catalogsRouter.get('/tipos-remuneracion', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.tipoRemuneracion.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/catalogs/seguros-salud  (BPS Tabla 8)
catalogsRouter.get('/seguros-salud', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.seguroSalud.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/catalogs/exoneraciones-aporte  (BPS Tabla 10)
catalogsRouter.get('/exoneraciones-aporte', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.exoneracionAporte.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/catalogs/computos-especiales  (BPS Tabla 12)
catalogsRouter.get('/computos-especiales', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.computoEspecial.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/catalogs/conceptos-bps  (BPS Tabla 15)
catalogsRouter.get('/conceptos-bps', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await prisma.conceptoBps.findMany({ orderBy: { codigo: 'asc' } });
    res.json(data);
  } catch (err) { next(err); }
});
