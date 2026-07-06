/**
 * SERVICIO DE AUDITORÍA
 *
 * Registra eventos sensibles (accesos y acciones) en la tabla `audit_log`.
 * Es "fire-and-forget tolerante": NUNCA lanza ni bloquea la operación principal;
 * si el registro falla, solo se loguea el error.
 */
import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

export interface AuditInput {
  action: string;                 // ej. 'LOGIN', 'LOGIN_FAILED', 'COMPANY_UPDATE'
  entity: string;                 // ej. 'auth', 'company', 'membership', 'contract'
  entityId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  oldData?: unknown;
  newData?: unknown;
  req?: Request;                  // para extraer IP y user-agent
}

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === undefined || v === null) return Prisma.DbNull;
  return v as Prisma.InputJsonValue;
}

/** IP real del cliente (con `trust proxy` configurado, req.ip ya es la correcta). */
function clientIp(req?: Request): string | null {
  if (!req) return null;
  return (req.ip || req.socket?.remoteAddress || null)?.slice(0, 60) ?? null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        companyId: input.companyId ?? null,
        userId: input.userId ?? (input.req?.user?.userId ?? null),
        oldData: toJson(input.oldData),
        newData: toJson(input.newData),
        ipAddress: clientIp(input.req),
        userAgent: input.req?.headers['user-agent']?.slice(0, 300) ?? null,
      },
    });
  } catch (e) {
    logger.error('No se pudo registrar auditoría', { action: input.action, error: (e as Error).message });
  }
}
