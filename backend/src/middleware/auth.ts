import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  companyId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Verifica JWT y adjunta payload al request */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticación requerido' });
    return;
  }
  const token = authHeader.split(' ')[1];
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET no configurado');
    const payload = jwt.verify(token, secret) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

/** Verifica que el usuario tenga el rol requerido */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Permisos insuficientes',
        required: roles,
        current: req.user.role,
      });
      return;
    }
    next();
  };
}

/** Verifica que el usuario pertenezca a la empresa solicitada */
export function requireCompanyAccess(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }
  // ADMIN can access any company
  if (req.user.role === UserRole.ADMIN) {
    next();
    return;
  }
  const companyId = req.params.companyId || req.body.companyId || req.query.companyId;
  if (companyId && req.user.companyId !== companyId) {
    res.status(403).json({ error: 'Acceso denegado a esta empresa' });
    return;
  }
  next();
}

/** Genera access token */
export function generateAccessToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no configurado');
  return jwt.sign(payload, secret, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as jwt.SignOptions['expiresIn'],
  });
}

/** Genera refresh token */
export function generateRefreshToken(userId: string): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET no configurado');
  return jwt.sign({ userId }, secret, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
  });
}

/** Verifica refresh token */
export function verifyRefreshToken(token: string): { userId: string } {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET no configurado');
  return jwt.verify(token, secret) as { userId: string };
}
