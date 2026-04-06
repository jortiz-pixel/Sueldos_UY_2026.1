import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Singleton pattern — reuse in development (avoid too many connections)
export const prisma =
  global.__prisma ||
  new PrismaClient({
    log: [
      // In development, also log slow queries to console
      ...(process.env.NODE_ENV !== 'production'
        ? [{ emit: 'stdout' as const, level: 'warn' as const }]
        : []),
      { emit: 'event' as const, level: 'error' as const },
      { emit: 'event' as const, level: 'warn' as const },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

prisma.$on('error', (e) => {
  logger.error('Prisma error', { message: e.message, target: e.target });
});

prisma.$on('warn', (e) => {
  logger.warn('Prisma warning', { message: e.message, target: e.target });
});

export default prisma;
