import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(public details: unknown[]) {
    super(422, 'Error de validación');
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} no encontrado`);
    this.name = 'NotFoundError';
    this.code = 'NOT_FOUND';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
    this.name = 'ConflictError';
    this.code = 'CONFLICT';
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ValidationError) {
    res.status(422).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Prisma errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as unknown as { code: string; meta?: { target?: string[] } };
    if (prismaErr.code === 'P2002') {
      res.status(409).json({
        error: 'Registro duplicado',
        code: 'DUPLICATE_ENTRY',
        field: prismaErr.meta?.target,
      });
      return;
    }
    if (prismaErr.code === 'P2025') {
      res.status(404).json({
        error: 'Registro no encontrado',
        code: 'NOT_FOUND',
      });
      return;
    }
  }

  logger.error('Error no manejado', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message,
    code: 'INTERNAL_ERROR',
  });
}
