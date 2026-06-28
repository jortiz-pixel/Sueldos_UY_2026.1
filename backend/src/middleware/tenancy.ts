import { Request, Response, NextFunction } from 'express';
import {
  UserRole,
  MembershipRole,
  MembershipStatus,
  ModuleKey,
  EntitlementStatus,
} from '@prisma/client';
import { prisma } from '../utils/prisma';

export interface MembershipContext {
  companyId: string;
  role: MembershipRole;
  superadmin: boolean;
  permisos?: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      membership?: MembershipContext;
    }
  }
}

/** Roles de empresa con poder de administración (compartir / revocar / configurar). */
const MANAGER_ROLES: MembershipRole[] = [MembershipRole.OWNER, MembershipRole.ADMIN];

function resolveCompanyId(req: Request, key: string): string | undefined {
  return (req.params[key] ?? req.body?.[key] ?? req.query?.[key]) as string | undefined;
}

/**
 * Resuelve la membresía del usuario actual sobre una empresa.
 * El ADMIN de plataforma (User.role === ADMIN) es superadmin: accede a todo.
 */
export async function resolveMembership(
  userId: string,
  platformRole: UserRole,
  companyId: string,
): Promise<MembershipContext | null> {
  if (platformRole === UserRole.ADMIN) {
    return { companyId, role: MembershipRole.OWNER, superadmin: true };
  }
  const m = await prisma.membership.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!m || m.estado !== MembershipStatus.ACTIVA) return null;
  return { companyId, role: m.role, superadmin: false, permisos: m.permisos ?? undefined };
}

/** ¿Puede el usuario administrar (compartir/revocar/configurar) esta empresa? */
export async function canManageCompany(
  userId: string,
  platformRole: UserRole,
  companyId: string,
): Promise<boolean> {
  const ctx = await resolveMembership(userId, platformRole, companyId);
  return !!ctx && (ctx.superadmin || MANAGER_ROLES.includes(ctx.role));
}

/**
 * Middleware: exige una membresía ACTIVA sobre la empresa resuelta.
 * Adjunta `req.membership`. Opcionalmente restringe a ciertos roles de empresa.
 */
export function requireMembership(opts: { roles?: MembershipRole[]; key?: string } = {}) {
  const key = opts.key ?? 'companyId';
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }
    const companyId = resolveCompanyId(req, key);
    if (!companyId) {
      res.status(400).json({ error: 'companyId requerido' });
      return;
    }
    const ctx = await resolveMembership(req.user.userId, req.user.role, companyId);
    if (!ctx) {
      res.status(403).json({ error: 'Sin acceso a esta empresa' });
      return;
    }
    if (opts.roles && !ctx.superadmin && !opts.roles.includes(ctx.role)) {
      res.status(403).json({ error: 'Permisos insuficientes en la empresa' });
      return;
    }
    req.membership = ctx;
    next();
  };
}

/**
 * Middleware: exige que la empresa tenga contratado (entitlement) el módulo dado.
 * Es un control a nivel empresa (independiente del poder del usuario).
 */
export function requireEntitlement(module: ModuleKey, opts: { key?: string } = {}) {
  const key = opts.key ?? 'companyId';
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const companyId = resolveCompanyId(req, key);
    if (!companyId) {
      res.status(400).json({ error: 'companyId requerido' });
      return;
    }
    const ent = await prisma.entitlement.findUnique({
      where: { companyId_module: { companyId, module } },
    });
    if (!ent || ent.estado === EntitlementStatus.SUSPENDIDO) {
      res.status(403).json({ error: `Módulo ${module} no contratado para esta empresa`, code: 'MODULE_NOT_ENTITLED' });
      return;
    }
    next();
  };
}
