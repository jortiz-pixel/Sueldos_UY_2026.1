/**
 * PORTAL DE EMPLEADOS (Fase 1) — credenciales CI + PIN.
 *
 * Seguridad: PIN hasheado (bcrypt), bloqueo por intentos fallidos, respuestas
 * genéricas (no revelan si la CI existe). Solo da acceso de LECTURA a los
 * recibos CONFIRMADOS del propio empleado.
 */
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;

// PIN de primer ingreso: 8 caracteres sin ambigüedad (sin 0/O/1/I/l).
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generarPinTemporal(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CHARSET[randomInt(CHARSET.length)];
  return s;
}

function normalizarCi(ci: string): string {
  return (ci || '').replace(/\D/g, ''); // solo dígitos
}

/** Habilita (o resetea) el acceso al portal para una CI. Devuelve el PIN una vez. */
export async function habilitarAccesoPortal(ciRaw: string): Promise<string> {
  const ci = normalizarCi(ciRaw);
  if (!ci) throw new AppError(400, 'CI inválida');
  const pin = generarPinTemporal();
  const pinHash = await bcrypt.hash(pin, 12);
  await prisma.employeePortalCredential.upsert({
    where: { ci },
    create: { ci, pinHash, mustSetPin: true, active: true },
    update: { pinHash, mustSetPin: true, active: true, failedAttempts: 0, lockedUntil: null },
  });
  return pin;
}

export async function revocarAccesoPortal(ciRaw: string): Promise<void> {
  const ci = normalizarCi(ciRaw);
  await prisma.employeePortalCredential.updateMany({ where: { ci }, data: { active: false } });
}

export async function estadoAccesoPortal(ciRaw: string): Promise<{ habilitado: boolean; mustSetPin: boolean; bloqueado: boolean }> {
  const ci = normalizarCi(ciRaw);
  const cred = await prisma.employeePortalCredential.findUnique({ where: { ci } });
  return {
    habilitado: !!cred?.active,
    mustSetPin: !!cred?.mustSetPin,
    bloqueado: !!(cred?.lockedUntil && cred.lockedUntil > new Date()),
  };
}

/** Verifica CI + PIN. Maneja el bloqueo. Devuelve mustSetPin si es primer ingreso. */
export async function verificarLogin(ciRaw: string, pin: string): Promise<{ ci: string; mustSetPin: boolean }> {
  const ci = normalizarCi(ciRaw);
  const generico = new AppError(401, 'Cédula o PIN incorrectos');
  if (!ci || !pin) throw generico;

  const cred = await prisma.employeePortalCredential.findUnique({ where: { ci } });
  // Respuesta uniforme aunque no exista (anti-enumeración); igual gastamos un compare.
  if (!cred || !cred.active) {
    await bcrypt.compare(pin, '$2a$12$0000000000000000000000000000000000000000000000000000'); // tiempo constante
    throw generico;
  }
  if (cred.lockedUntil && cred.lockedUntil > new Date()) {
    throw new AppError(429, 'Acceso bloqueado temporalmente por intentos fallidos. Probá en unos minutos.');
  }

  const ok = await bcrypt.compare(pin, cred.pinHash);
  if (!ok) {
    const intentos = cred.failedAttempts + 1;
    const bloquear = intentos >= MAX_INTENTOS;
    await prisma.employeePortalCredential.update({
      where: { ci },
      data: {
        failedAttempts: bloquear ? 0 : intentos,
        lockedUntil: bloquear ? new Date(Date.now() + BLOQUEO_MIN * 60_000) : null,
      },
    });
    throw generico;
  }

  await prisma.employeePortalCredential.update({
    where: { ci },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  return { ci, mustSetPin: cred.mustSetPin };
}

/** Fija un nuevo PIN elegido por el empleado (primer ingreso o cambio). */
export async function setNuevoPin(ciRaw: string, nuevoPin: string): Promise<void> {
  const ci = normalizarCi(ciRaw);
  if (!nuevoPin || nuevoPin.length < 6) throw new AppError(400, 'El PIN debe tener al menos 6 caracteres.');
  const cred = await prisma.employeePortalCredential.findUnique({ where: { ci } });
  if (!cred || !cred.active) throw new AppError(404, 'Acceso no habilitado');
  const pinHash = await bcrypt.hash(nuevoPin, 12);
  await prisma.employeePortalCredential.update({
    where: { ci },
    data: { pinHash, mustSetPin: false, failedAttempts: 0, lockedUntil: null },
  });
}
