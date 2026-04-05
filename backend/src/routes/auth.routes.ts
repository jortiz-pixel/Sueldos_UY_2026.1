import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
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
