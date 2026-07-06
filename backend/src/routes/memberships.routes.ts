import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import {
  UserRole,
  MembershipRole,
  MembershipStatus,
  ModuleKey,
  EntitlementStatus,
} from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { canManageCompany } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { recordAudit } from '../services/audit.service';

export const membershipsRouter = Router();

// Dominios habilitados para login con Google (mismos que usa /auth/google).
const GOOGLE_ALLOWED_DOMAINS = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
  .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

// Una cuenta de Google ingresa por OAuth (sin contraseña). Es "Google" si el
// dominio es gmail/googlemail o un dominio de Workspace habilitado en el server.
function esEmailGoogle(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return domain === 'gmail.com' || domain === 'googlemail.com' || GOOGLE_ALLOWED_DOMAINS.includes(domain);
}

// Deriva un nombre/apellido razonable del email cuando no se proporcionan
// (p. ej. "ines.rosas@gmail.com" → Ines / Rosas; "inerosas@..." → Inerosas / "").
function nombreDesdeEmail(email: string): { nombre: string; apellido: string } {
  const local = (email.split('@')[0] || 'Usuario').replace(/\+.*/, '');
  const partes = local.split(/[._-]+/).filter(Boolean);
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  return { nombre: cap(partes[0] || 'Usuario'), apellido: cap(partes.slice(1).join(' ')) };
}

// -------------------------------------------------------------------
// GET /api/memberships/my  → empresas a las que el usuario tiene acceso
// (alimenta el selector de empresa del frontend)
// -------------------------------------------------------------------
membershipsRouter.get('/my', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Superadmin de plataforma: todas las empresas activas.
    if (req.user!.role === UserRole.ADMIN) {
      const companies = await prisma.company.findMany({
        where: { active: true, hidden: false },
        orderBy: { razonSocial: 'asc' },
        select: { id: true, razonSocial: true, nombreFantasia: true },
      });
      res.json(companies.map((c) => ({
        companyId: c.id,
        razonSocial: c.razonSocial,
        nombreFantasia: c.nombreFantasia,
        role: MembershipRole.OWNER,
        superadmin: true,
      })));
      return;
    }

    const memberships = await prisma.membership.findMany({
      where: { userId: req.user!.userId, estado: MembershipStatus.ACTIVA, company: { active: true, hidden: false } },
      include: { company: { select: { id: true, razonSocial: true, nombreFantasia: true } } },
      orderBy: { company: { razonSocial: 'asc' } },
    });
    res.json(memberships.map((m) => ({
      companyId: m.companyId,
      razonSocial: m.company.razonSocial,
      nombreFantasia: m.company.nombreFantasia,
      role: m.role,
      superadmin: false,
    })));
  } catch (err) { next(err); }
});

// -------------------------------------------------------------------
// GET /api/memberships?companyId=  → quién tiene acceso a una empresa
// -------------------------------------------------------------------
membershipsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.query.companyId ?? '');
    if (!companyId) throw new AppError(400, 'companyId requerido');
    if (!(await canManageCompany(req.user!.userId, req.user!.role, companyId))) {
      throw new AppError(403, 'Sin permisos para ver los accesos de esta empresa');
    }
    const memberships = await prisma.membership.findMany({
      where: { companyId },
      include: { user: { select: { id: true, email: true, nombre: true, apellido: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(memberships.map((m) => ({
      id: m.id,
      role: m.role,
      estado: m.estado,
      user: m.user,
      createdAt: m.createdAt,
    })));
  } catch (err) { next(err); }
});

// -------------------------------------------------------------------
// POST /api/memberships  → compartir empresa (agregar usuario)
// body: { companyId, email, role, nombre?, apellido?, password? }
//   - si el email ya existe: se le crea la membresía.
//   - si no existe: se crea el usuario (requiere nombre, apellido, password).
// -------------------------------------------------------------------
const shareSchema = z.object({
  companyId: z.string().min(1),
  email: z.string().email('Email inválido'),
  role: z.nativeEnum(MembershipRole).default(MembershipRole.OPERATOR),
  nombre: z.string().min(1).optional(),
  apellido: z.string().min(1).optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').optional(),
});

membershipsRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = shareSchema.parse(req.body);
    if (!(await canManageCompany(req.user!.userId, req.user!.role, data.companyId))) {
      throw new AppError(403, 'Sin permisos para compartir esta empresa');
    }

    const company = await prisma.company.findUnique({ where: { id: data.companyId } });
    if (!company) throw new NotFoundError('Empresa');

    const email = data.email.toLowerCase();
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const esGoogle = esEmailGoogle(email);
      if (!esGoogle && (!data.nombre || !data.apellido || !data.password)) {
        throw new AppError(400, 'Para invitar un usuario nuevo se requieren nombre, apellido y contraseña');
      }
      // Cuenta de Google: se crea sin contraseña (ingresa con "Iniciar sesión con
      // Google"); el nombre se toma del invitador o se deriva del email.
      const derivado = nombreDesdeEmail(email);
      const passwordHash = await bcrypt.hash(
        data.password ?? randomBytes(32).toString('hex'),
        12,
      );
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          nombre: data.nombre || derivado.nombre,
          apellido: data.apellido || derivado.apellido,
          role: UserRole.OPERATOR,
          companyId: data.companyId, // última empresa usada (default)
        },
      });
    }

    const existing = await prisma.membership.findUnique({
      where: { userId_companyId: { userId: user.id, companyId: data.companyId } },
    });
    if (existing && existing.estado !== MembershipStatus.REVOCADA) {
      throw new AppError(409, 'El usuario ya tiene acceso a esta empresa');
    }

    const membership = existing
      ? await prisma.membership.update({
          where: { id: existing.id },
          data: { estado: MembershipStatus.ACTIVA, role: data.role, invitedById: req.user!.userId },
        })
      : await prisma.membership.create({
          data: {
            userId: user.id,
            companyId: data.companyId,
            role: data.role,
            estado: MembershipStatus.ACTIVA,
            invitedById: req.user!.userId,
          },
        });

    await recordAudit({ action: 'ACCESS_GRANT', entity: 'membership', entityId: membership.id, companyId: data.companyId, newData: { email, role: data.role }, req });

    res.status(201).json({
      id: membership.id,
      role: membership.role,
      estado: membership.estado,
      user: { id: user.id, email: user.email, nombre: user.nombre, apellido: user.apellido },
    });
  } catch (err) { next(err); }
});

// -------------------------------------------------------------------
// PATCH /api/memberships/:id  → cambiar rol / revocar acceso
// body: { role?, estado? }
// -------------------------------------------------------------------
const patchSchema = z.object({
  role: z.nativeEnum(MembershipRole).optional(),
  estado: z.nativeEnum(MembershipStatus).optional(),
});

membershipsRouter.patch('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = patchSchema.parse(req.body);
    const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
    if (!membership) throw new NotFoundError('Membresía');

    if (!(await canManageCompany(req.user!.userId, req.user!.role, membership.companyId))) {
      throw new AppError(403, 'Sin permisos para modificar accesos de esta empresa');
    }

    // No dejar a una empresa sin OWNER activo.
    const losingOwner =
      membership.role === MembershipRole.OWNER &&
      (data.role && data.role !== MembershipRole.OWNER ||
        data.estado && data.estado !== MembershipStatus.ACTIVA);
    if (losingOwner) {
      const owners = await prisma.membership.count({
        where: { companyId: membership.companyId, role: MembershipRole.OWNER, estado: MembershipStatus.ACTIVA },
      });
      if (owners <= 1) throw new AppError(409, 'La empresa debe conservar al menos un OWNER activo');
    }

    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: { role: data.role ?? undefined, estado: data.estado ?? undefined },
    });
    const revoca = data.estado && data.estado !== MembershipStatus.ACTIVA;
    await recordAudit({
      action: revoca ? 'ACCESS_REVOKE' : 'ACCESS_UPDATE',
      entity: 'membership', entityId: updated.id, companyId: membership.companyId,
      oldData: { role: membership.role, estado: membership.estado },
      newData: { role: updated.role, estado: updated.estado }, req,
    });
    res.json({ id: updated.id, role: updated.role, estado: updated.estado });
  } catch (err) { next(err); }
});

// ===================================================================
// Entitlements (módulos contratados por empresa)
// ===================================================================
export const entitlementsRouter = Router();

// GET /api/entitlements?companyId=  → módulos de una empresa
entitlementsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.query.companyId ?? '');
    if (!companyId) throw new AppError(400, 'companyId requerido');
    // Cualquier miembro activo (o superadmin) puede ver qué módulos tiene su empresa.
    const isMember =
      req.user!.role === UserRole.ADMIN ||
      (await prisma.membership.findUnique({
        where: { userId_companyId: { userId: req.user!.userId, companyId } },
      }))?.estado === MembershipStatus.ACTIVA;
    if (!isMember) throw new AppError(403, 'Sin acceso a esta empresa');

    const entitlements = await prisma.entitlement.findMany({
      where: { companyId },
      orderBy: { module: 'asc' },
    });
    res.json(entitlements);
  } catch (err) { next(err); }
});

// PUT /api/entitlements  → activar/suspender un módulo (solo superadmin de plataforma)
const entitlementSchema = z.object({
  companyId: z.string().min(1),
  module: z.nativeEnum(ModuleKey),
  estado: z.nativeEnum(EntitlementStatus).default(EntitlementStatus.ACTIVO),
  plan: z.string().optional(),
});

entitlementsRouter.put('/', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = entitlementSchema.parse(req.body);
    const entitlement = await prisma.entitlement.upsert({
      where: { companyId_module: { companyId: data.companyId, module: data.module } },
      update: { estado: data.estado, plan: data.plan ?? undefined },
      create: { companyId: data.companyId, module: data.module, estado: data.estado, plan: data.plan ?? 'basico' },
    });
    res.json(entitlement);
  } catch (err) { next(err); }
});
