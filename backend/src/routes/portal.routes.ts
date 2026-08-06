/**
 * PORTAL DE EMPLEADOS (Fase 1) — endpoints públicos de bajo privilegio.
 * Login con CI + PIN; ver y descargar SOLO los recibos CONFIRMADOS propios.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { LiquidationStatus } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import {
  generatePortalToken, authenticatePortal,
  generateCompanyPortalToken, authenticateCompanyPortal,
} from '../middleware/auth';
import {
  verificarLogin, setNuevoPin,
  verificarLoginEmpresa, setNuevoPinEmpresa,
} from '../services/portal.service';
import { recordAudit } from '../services/audit.service';
import { generateReciboPDF, reciboFilename } from '../services/pdf.service';

export const portalRouter = Router();

function ciDigitos(ci: string): string {
  return (ci || '').replace(/\D/g, '');
}

// Etiqueta amigable del recibo (empresa) para la lista y el nombre del PDF.
function digitos(s: string): string {
  return (s || '').replace(/\D/g, '');
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

// ═══════════════════════ PORTAL DE CLIENTES (empresas) ═══════════════════════
// Login con RUT + PIN; ver y descargar los recibos CONFIRMADOS de TODOS los
// empleados de la empresa.

// POST /api/portal/empresa/login { rut, pin }
portalRouter.post('/empresa/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rut, pin } = z.object({ rut: z.string().min(1), pin: z.string().min(1) }).parse(req.body);
    const r = await verificarLoginEmpresa(rut, pin);
    recordAudit({ action: 'PORTAL_EMPRESA_LOGIN', entity: 'company', entityId: r.companyId, companyId: r.companyId, req });
    if (r.mustSetPin) {
      res.json({ mustSetPin: true, setupToken: generateCompanyPortalToken(r.companyId, true) });
      return;
    }
    res.json({ token: generateCompanyPortalToken(r.companyId) });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 401) {
      recordAudit({ action: 'PORTAL_EMPRESA_LOGIN_FAILED', entity: 'company', newData: { rut: digitos(req.body?.rut ?? '') }, req });
    }
    next(err);
  }
});

// POST /api/portal/empresa/set-pin { newPin }  (Authorization: setup o full token)
portalRouter.post('/empresa/set-pin', authenticateCompanyPortal({ allowSetup: true }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { newPin } = z.object({ newPin: z.string().min(6).max(64) }).parse(req.body);
    await setNuevoPinEmpresa(req.portalEmpresa!.companyId, newPin);
    recordAudit({ action: 'PORTAL_EMPRESA_SET_PIN', entity: 'company', entityId: req.portalEmpresa!.companyId, companyId: req.portalEmpresa!.companyId, req });
    res.json({ token: generateCompanyPortalToken(req.portalEmpresa!.companyId) });
  } catch (err) { next(err); }
});

// GET /api/portal/empresa/recibos  → recibos CONFIRMADOS de todos los empleados de la empresa
portalRouter.get('/empresa/recibos', authenticateCompanyPortal(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.portalEmpresa!.companyId;
    const liqs = await prisma.liquidation.findMany({
      where: { status: LiquidationStatus.CONFIRMADO, period: { companyId } },
      include: { employee: { select: { nombre: true, apellido: true, ci: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { employeeId: 'asc' }],
    });
    res.json(liqs.map((l) => ({
      id: l.id,
      year: l.year,
      month: l.month,
      type: l.type,
      liquidoPercibir: l.liquidoPercibir.toString(),
      empleado: `${l.employee?.apellido ?? ''}, ${l.employee?.nombre ?? ''}`.trim(),
      ci: l.employee?.ci ?? '',
    })));
  } catch (err) { next(err); }
});

// GET /api/portal/empresa/recibos/:id/pdf  → recibo en PDF (solo confirmado y de la empresa)
portalRouter.get('/empresa/recibos/:id/pdf', authenticateCompanyPortal(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = req.portalEmpresa!.companyId;
    const liquidation = await prisma.liquidation.findUnique({
      where: { id: req.params.id },
      include: { items: true, period: true },
    });
    if (!liquidation) throw new NotFoundError('Recibo');
    if (liquidation.status !== LiquidationStatus.CONFIRMADO) throw new AppError(403, 'El recibo no está disponible.');
    // Control de acceso a nivel de objeto: el recibo tiene que ser de ESTA empresa.
    if (liquidation.period?.companyId !== companyId) throw new AppError(403, 'Acceso denegado');

    const employee = await prisma.employee.findUnique({
      where: { id: liquidation.employeeId },
      include: { company: true },
    });
    if (!employee) throw new NotFoundError('Empleado');

    const contrato = await prisma.contrato.findFirst({
      where: { employeeId: employee.id, companyId },
      orderBy: { vigenciaDesde: 'desc' },
    });

    const pdfBuffer = await generateReciboPDF(liquidation, employee, contrato);
    recordAudit({ action: 'PORTAL_EMPRESA_RECIBO_DOWNLOAD', entity: 'liquidation', entityId: liquidation.id, companyId, req });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reciboFilename(liquidation, employee)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) { next(err); }
});
