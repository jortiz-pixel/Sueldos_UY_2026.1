import { Router, Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';

export const auditRouter = Router();

// GET /api/audit  → registro de auditoría (solo ADMIN de plataforma).
// Filtros opcionales: action, entity, companyId, userId, from, to. Paginado.
auditRouter.get('/', authenticate, requireRole(UserRole.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1'));
    const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) || '50')));

    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    const where = {
      ...(req.query.action ? { action: String(req.query.action) } : {}),
      ...(req.query.entity ? { entity: String(req.query.entity) } : {}),
      ...(req.query.companyId ? { companyId: String(req.query.companyId) } : {}),
      ...(req.query.userId ? { userId: String(req.query.userId) } : {}),
      ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, email: true, nombre: true, apellido: true } },
          company: { select: { id: true, razonSocial: true } },
        },
      }),
    ]);

    res.json({
      data: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        createdAt: r.createdAt,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        oldData: r.oldData,
        newData: r.newData,
        usuario: r.user ? `${r.user.nombre} ${r.user.apellido}` : null,
        usuarioEmail: r.user?.email ?? null,
        empresa: r.company?.razonSocial ?? null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});
