import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { CATEGORIAS_CONSTRUCCION, jornalesVigentes, refrescarPartidasDesdeJornal } from '../services/construccion.service';
import { recordAudit } from '../services/audit.service';

export const construccionRouter = Router();

// GET /api/construccion/jornales → jornales vigentes por categoría y recuadro.
construccionRouter.get('/jornales', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : new Date();
    const vigentes = await jornalesVigentes(fecha);
    res.json({
      categorias: CATEGORIAS_CONSTRUCCION,
      jornales: vigentes.map((v) => ({
        categoria: v.categoria,
        recuadro: v.recuadro,
        valorHora: v.valorHora.toString(),
        effectiveDate: v.effectiveDate,
      })),
    });
  } catch (err) { next(err); }
});

// PUT /api/construccion/jornales — guarda una vigencia de jornales (por ronda).
// body: { effectiveDate, valores: [{ categoria, recuadro, valorHoraPesos }] }
construccionRouter.put('/jornales', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      effectiveDate: z.string().min(1),
      valores: z.array(z.object({
        categoria: z.string().min(1),
        recuadro: z.enum(['INCLUIDOS', 'NO_INCLUIDOS']),
        valorHoraPesos: z.number().min(0),
      })),
    });
    const { effectiveDate, valores } = schema.parse(req.body);
    const fecha = new Date(effectiveDate);

    let guardados = 0;
    for (const v of valores) {
      if (v.valorHoraPesos <= 0) continue;
      await prisma.jornalConstruccion.upsert({
        where: { categoria_recuadro_effectiveDate: { categoria: v.categoria, recuadro: v.recuadro, effectiveDate: fecha } },
        create: { categoria: v.categoria, recuadro: v.recuadro, effectiveDate: fecha, valorHora: BigInt(Math.round(v.valorHoraPesos * 100)) },
        update: { valorHora: BigInt(Math.round(v.valorHoraPesos * 100)) },
      });
      guardados++;
    }

    // Derivar ropa/transporte/herramientas del ½ Oficial Albañil (incluidos).
    const partidasActualizadas = await refrescarPartidasDesdeJornal(fecha);

    await recordAudit({ action: 'PARAMETER_CHANGE', entity: 'parameter', newData: { tipo: 'jornales_construccion', effectiveDate, guardados, partidasActualizadas }, req });
    res.json({ guardados, partidasActualizadas });
  } catch (err) { next(err); }
});
