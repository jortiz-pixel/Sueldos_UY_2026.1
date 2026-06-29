import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { UserRole, User } from '@prisma/client';
import { prisma } from '../utils/prisma';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticate,
} from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Login con Google (ID token). Solo requiere el Client ID (público) para verificar.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_ALLOWED_DOMAINS = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const googleClient = new OAuth2Client();

/** Emite access+refresh token para un usuario y registra la sesión. */
async function emitirSesion(user: User) {
  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId ?? undefined,
  });
  const refreshToken = generateRefreshToken(user.id);
  await prisma.refreshToken.create({
    data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { accessToken, refreshToken };
}

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      throw new AppError(401, 'Credenciales incorrectas');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError(401, 'Credenciales incorrectas');

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId ?? undefined,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(user.id);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        role: user.role,
        companyId: user.companyId,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/google  { credential }
//   credential = ID token de Google Identity Services (lo emite el botón del frontend).
authRouter.post('/google', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!GOOGLE_CLIENT_ID) throw new AppError(500, 'El login con Google no está configurado en el servidor');
    const { credential } = z.object({ credential: z.string().min(1) }).parse(req.body);

    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) {
      throw new AppError(401, 'La cuenta de Google no tiene un email verificado');
    }
    const email = payload.email.toLowerCase();

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Alta automática solo si el dominio está habilitado (GOOGLE_ALLOWED_DOMAINS).
      const domain = email.split('@')[1] ?? '';
      if (!GOOGLE_ALLOWED_DOMAINS.includes(domain)) {
        throw new AppError(403, 'Este email no está autorizado a ingresar. Pedile a un administrador que te dé de alta.');
      }
      const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          nombre: payload.given_name || 'Usuario',
          apellido: payload.family_name || 'Google',
          role: UserRole.OPERATOR,
        },
      });
    }
    if (!user.active) throw new AppError(401, 'Usuario inactivo');

    const { accessToken, refreshToken } = await emitirSesion(user);
    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id, email: user.email, nombre: user.nombre,
        apellido: user.apellido, role: user.role, companyId: user.companyId,
      },
    });
  } catch (err) { next(err); }
});

// POST /api/auth/refresh
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError(401, 'Refresh token requerido');

    const payload = verifyRefreshToken(refreshToken);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
      throw new AppError(401, 'Refresh token inválido o expirado');
    }

    const user = storedToken.user;
    if (!user.active) throw new AppError(401, 'Usuario inactivo');

    const newAccessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId ?? undefined,
    });

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken, userId: req.user!.userId },
        data: { revokedAt: new Date() },
      });
    }
    res.json({ message: 'Sesión cerrada exitosamente' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, nombre: true, apellido: true, role: true, companyId: true, lastLoginAt: true },
    });
    if (!user) throw new AppError(404, 'Usuario no encontrado');
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/change-password
authRouter.put('/change-password', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    });
    const { currentPassword, newPassword } = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw new AppError(404, 'Usuario no encontrado');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError(401, 'Contraseña actual incorrecta');

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (err) {
    next(err);
  }
});
