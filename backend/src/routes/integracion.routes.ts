import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { asientoContable } from '../services/pagos.service';
import { resolverAccesoEfactura } from '../services/efactura.service';
import { prisma } from '../utils/prisma';

/**
 * Integración con AsysTax e-Factura (servidor a servidor). El facturador se
 * identifica con un pase de un solo uso del usuario y la empresa (header
 * x-efactura-token), que se verifica contra el propio facturador.
 */
export const integracionRouter = Router();

// GET /api/integracion/efactura/asiento?year=&month=
//   El MISMO asiento contable del mes que muestra Reportes (asientoContable:
//   solo liquidaciones confirmadas), para registrarlo en la contabilidad.
integracionRouter.get('/efactura/asiento', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.get('x-efactura-token') ?? '');
    if (!token) throw new AppError(401, 'Falta el pase de e-Factura');
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) throw new AppError(400, 'year y month requeridos');

    const { companyId, rut } = await resolverAccesoEfactura(token);
    if (!companyId) throw new AppError(404, `La empresa RUT ${rut} no está en Sueldos o tu usuario no tiene acceso a ella`);

    const r = await asientoContable(companyId, year, month);
    const empresa = await prisma.company.findUnique({ where: { id: companyId }, select: { razonSocial: true, rut: true } });
    res.json({ empresa, year, month, ...r });
  } catch (err) { next(err); }
});
