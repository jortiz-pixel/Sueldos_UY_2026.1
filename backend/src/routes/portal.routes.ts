/**
 * PORTAL DE EMPLEADOS (Fase 1) — endpoints públicos de bajo privilegio.
 * Login con CI + PIN; ver y descargar SOLO los recibos CONFIRMADOS propios.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { LiquidationStatus } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { generatePortalToken, authenticatePortal } from '../middleware/auth';
import { verificarLogin, setNuevoPin } from '../services/portal.service';
import { recordAudit } from '../services/audit.service';
import { generateReciboPDF, reciboFilename } from '../services/pdf.service';

export const portalRouter = Router();

function ciDigitos(ci: string): string {
  return (ci || '').replace(/\D/g, '');
}

// POST /api/portal/login { ci, pin }
portalRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ci, pin } = z.object({ ci: z.string().min(1), pin: z.string().min(1) }).parse(req.body);
    const r = await verificarLogin(ci, pin);
    recordAudit({ action: 'PORTAL_LOGIN', entity: 'portal', newData: { ci: r.ci }, req });
    if (r.mustSetPin) {
      // Primer ingreso: token limitado que SOLO permite fijar el PIN.
      res.json({ mustSetPin: true, setupToken: generatePortalToken(r.ci, true) });
      return;
    }
    res.json({ token: generatePortalToken(r.ci) });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 401) {
      recordAudit({ action: 'PORTAL_LOGIN_FAILED', entity: 'portal', newData: { ci: ciDigitos(req.body?.ci ?? '') }, req });
    }
    next(err);
  }
});

// POST /api/portal/set-pin { newPin }  (Authorization: setup o full token)
portalRouter.post('/set-pin', authenticatePortal({ allowSetup: true }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { newPin } = z.object({ newPin: z.string().min(6).max(64) }).parse(req.body);
    await setNuevoPin(req.portal!.ci, newPin);
    recordAudit({ action: 'PORTAL_SET_PIN', entity: 'portal', newData: { ci: req.portal!.ci }, req });
    res.json({ token: generatePortalToken(req.portal!.ci) });
  } catch (err) { next(err); }
});

// GET /api/portal/recibos  → liquidaciones CONFIRMADAS del propio empleado (todas sus empresas)
portalRouter.get('/recibos', authenticatePortal(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ci = req.portal!.ci;
    const empleados = await prisma.employee.findMany({ where: { ci }, select: { id: true } });
    const ids = empleados.map((e) => e.id);
    if (ids.length === 0) { res.json([]); return; }
    const liqs = await prisma.liquidation.findMany({
      where: { employeeId: { in: ids }, status: LiquidationStatus.CONFIRMADO },
      include: { period: { include: { company: { select: { razonSocial: true, nombreFantasia: true } } } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    res.json(liqs.map((l) => ({
      id: l.id,
      year: l.year,
      month: l.month,
      type: l.type,
      liquidoPercibir: l.liquidoPercibir.toString(),
      empresa: l.period?.company?.nombreFantasia || l.period?.company?.razonSocial || '',
    })));
  } catch (err) { next(err); }
});

// GET /api/portal/recibos/:id/pdf  → recibo en PDF (solo confirmado y propio)
portalRouter.get('/recibos/:id/pdf', authenticatePortal(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ci = req.portal!.ci;
    const liquidation = await prisma.liquidation.findUnique({
      where: { id: req.params.id },
      include: { items: true, period: true },
    });
    if (!liquidation) throw new NotFoundError('Recibo');
    if (liquidation.status !== LiquidationStatus.CONFIRMADO) throw new AppError(403, 'El recibo no está disponible.');

    const employee = await prisma.employee.findUnique({
      where: { id: liquidation.employeeId },
      include: { company: true },
    });
    // Control de acceso a nivel de objeto: el recibo tiene que ser de ESTA persona.
    if (!employee || employee.ci !== ci) throw new AppError(403, 'Acceso denegado');

    const contrato = await prisma.contrato.findFirst({
      where: { employeeId: employee.id, companyId: liquidation.period?.companyId ?? employee.companyId ?? undefined },
      orderBy: { vigenciaDesde: 'desc' },
    });

    const pdfBuffer = await generateReciboPDF(liquidation, employee, contrato);
    recordAudit({ action: 'PORTAL_RECIBO_DOWNLOAD', entity: 'liquidation', entityId: liquidation.id, newData: { ci }, req });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reciboFilename(liquidation, employee)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});
