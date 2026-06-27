import { Router, Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

export const contractsRouter = Router();

// GET /api/contracts?companyId=  — contratos (vínculos) de una empresa, con la persona
contractsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    if (req.user!.role !== UserRole.ADMIN && req.user!.companyId !== companyId) {
      throw new AppError(403, 'Acceso denegado a esta empresa');
    }

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
