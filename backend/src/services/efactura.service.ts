/**
 * INTEGRACIÓN CON ASYSTAX E-FACTURA (efactura.gro.com.uy)
 *
 * El facturador muestra Sueldos dentro de su panel y le presenta un PASE de
 * un solo uso (vida 2 min) del usuario y la empresa que tiene activos. Acá se
 * verifica ese pase llamando al facturador, que responde email + RUT:
 * - el usuario tiene que EXISTIR y estar activo en Sueldos (mismo email);
 *   no se dan altas automáticas;
 * - la empresa se busca por RUT y solo se usa si el usuario tiene acceso.
 * Si algo falla, no se inicia sesión y Sueldos sigue con su login de siempre.
 * Apagar la integración: EFACTURA_INTEGRACION=0.
 */
import { User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveMembership } from '../middleware/tenancy';

const URL_VERIFICACION = process.env.EFACTURA_SSO_URL || 'https://efactura.gro.com.uy/api/sso/verificar';

const respuestaSchema = z.object({
  email: z.string().email(),
  nombre: z.string().optional(),
  rut: z.string().min(1),
  razonSocial: z.string().optional(),
});

const soloDigitos = (s: string) => s.replace(/\D/g, '');

export function integracionEfacturaActiva(): boolean {
  return process.env.EFACTURA_INTEGRACION !== '0';
}

/** Verifica el pase con el facturador (lo consume) → email y RUT. */
export async function verificarPaseEfactura(token: string): Promise<z.infer<typeof respuestaSchema>> {
  if (!integracionEfacturaActiva()) throw new AppError(404, 'Integración con e-Factura desactivada');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new AppError(401, 'Pase de e-Factura inválido');
  let r: Response;
  try {
    r = await fetch(URL_VERIFICACION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AppError(502, 'No se pudo verificar el acceso con AsysTax e-Factura');
  }
  if (!r.ok) throw new AppError(401, 'El pase de e-Factura venció o ya se usó');
  const datos = respuestaSchema.safeParse(await r.json().catch(() => null));
  if (!datos.success) throw new AppError(502, 'Respuesta inesperada de AsysTax e-Factura');
  return datos.data;
}

/**
 * Pase → usuario de Sueldos (mismo email, activo) y empresa por RUT (solo si
 * el usuario tiene acceso; si no, companyId null).
 */
export async function resolverAccesoEfactura(token: string): Promise<{ user: User; companyId: string | null; rut: string }> {
  const datos = await verificarPaseEfactura(token);
  const user = await prisma.user.findUnique({ where: { email: datos.email.toLowerCase() } });
  if (!user || !user.active) {
    throw new AppError(403, `El usuario ${datos.email} no está dado de alta en Sueldos`);
  }
  const rut = soloDigitos(datos.rut);
  const empresas = await prisma.company.findMany({ select: { id: true, rut: true } });
  const empresa = empresas.find((c) => soloDigitos(c.rut) === rut);
  let companyId: string | null = null;
  if (empresa && (await resolveMembership(user.id, user.role, empresa.id))) companyId = empresa.id;
  return { user, companyId, rut };
}
