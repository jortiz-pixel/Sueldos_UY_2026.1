/**
 * POLICY DE MEMBRESÍAS — invariante de propiedad (OWNER)
 *
 * Regla de negocio (D9, ver docs/ARQUITECTURA.md §5 y §16):
 * una empresa SIEMPRE conserva al menos un OWNER activo. Si el último OWNER
 * activo deja de serlo (cambio de rol o revocación), un ADMIN activo **asume**
 * automáticamente como OWNER (propiedad transferible). Si no hay ningún ADMIN
 * que pueda asumir, el cambio se rechaza.
 *
 * Esta es una función PURA: no toca la base de datos. El llamador obtiene las
 * membresías de la empresa, evalúa el cambio y, si la decisión incluye un
 * `promoteToOwnerId`, aplica ambas actualizaciones en una transacción.
 */
import { MembershipRole, MembershipStatus } from '@prisma/client';

export interface MemberLite {
  id: string;
  role: MembershipRole;
  estado: MembershipStatus;
  createdAt: Date;
}

export interface OwnerChangeRequest {
  role?: MembershipRole;
  estado?: MembershipStatus;
}

export type OwnerChangeDecision =
  | { allowed: true; promoteToOwnerId: string | null }
  | { allowed: false; reason: string };

function isActiveOwner(m: MemberLite): boolean {
  return m.role === MembershipRole.OWNER && m.estado === MembershipStatus.ACTIVA;
}

/**
 * Decide si un cambio de rol/estado sobre una membresía respeta la invariante
 * "al menos un OWNER activo", resolviendo el traspaso automático cuando aplica.
 *
 * @param members  Todas las membresías de la empresa (incluida la que cambia).
 * @param targetId Id de la membresía que se quiere modificar.
 * @param next     Cambios solicitados (role y/o estado; undefined = sin cambio).
 */
export function evaluateOwnerChange(
  members: MemberLite[],
  targetId: string,
  next: OwnerChangeRequest,
): OwnerChangeDecision {
  const target = members.find((m) => m.id === targetId);
  if (!target) return { allowed: false, reason: 'Membresía no encontrada' };

  // ¿El target es un OWNER activo que está perdiendo la propiedad?
  const losesOwnerRole = next.role !== undefined && next.role !== MembershipRole.OWNER;
  const losesActive = next.estado !== undefined && next.estado !== MembershipStatus.ACTIVA;
  const losingOwnership = isActiveOwner(target) && (losesOwnerRole || losesActive);

  if (!losingOwnership) return { allowed: true, promoteToOwnerId: null };

  // ¿Queda otro OWNER activo distinto del target? Entonces no hay que traspasar.
  const otherActiveOwners = members.filter((m) => m.id !== targetId && isActiveOwner(m));
  if (otherActiveOwners.length > 0) return { allowed: true, promoteToOwnerId: null };

  // No queda OWNER: el ADMIN activo más antiguo asume (elección determinista).
  const adminCandidate = members
    .filter(
      (m) =>
        m.id !== targetId &&
        m.role === MembershipRole.ADMIN &&
        m.estado === MembershipStatus.ACTIVA,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

  if (!adminCandidate) {
    return {
      allowed: false,
      reason:
        'La empresa debe conservar al menos un OWNER activo y no hay ADMIN que pueda asumir',
    };
  }

  return { allowed: true, promoteToOwnerId: adminCandidate.id };
}
