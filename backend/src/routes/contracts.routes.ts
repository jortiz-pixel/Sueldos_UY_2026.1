import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { assertCompanyAccess, accessibleCompanyIds } from '../middleware/tenancy';
import { AppError } from '../middleware/errorHandler';

export const contractsRouter = Router();

// GET /api/contracts/persons — personas para el selector (padrón accesible)
contractsRouter.get('/persons', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ids = await accessibleCompanyIds(req);
    const where = ids === 'ALL'
      ? { active: true }
      : { active: true, contratos: { some: { companyId: { in: ids } } } };
    const persons = await prisma.employee.findMany({
      where,
      select: { id: true, ci: true, nombre: true, apellido: true },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
      take: 500,
    });
    res.json(persons);
  } catch (err) { next(err); }
});

// GET /api/contracts?companyId= — contratos (vínculos) de una empresa, con la persona
contractsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);

    const contratos = await prisma.contrato.findMany({
      where: { companyId },
      include: { employee: { select: { id: true, ci: true, nombre: true, apellido: true } } },
      orderBy: [{ activo: 'desc' }, { vigenciaDesde: 'desc' }],
    });

    res.json(contratos.map((c) => ({
      ...c,
      salarioNominal: c.salarioNominal.toString(),
      jornal: c.jornal != null ? c.jornal.toString() : null,
    })));
  } catch (err) { next(err); }
});
