/**
 * TESTS UNITARIOS — POLICY DE MEMBRESÍAS (invariante de OWNER, D9)
 *
 * Verifica la regla "la empresa conserva siempre un OWNER activo" y el
 * traspaso automático de la propiedad a un ADMIN cuando el último OWNER deja
 * de serlo. Función pura, sin BD.
 *
 * Para verificar:
 * npx jest tests/membership.policy.test.ts
 */
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { evaluateOwnerChange, MemberLite } from '../src/services/membership.policy';

const { OWNER, ADMIN, OPERATOR, VIEWER } = MembershipRole;
const { ACTIVA, REVOCADA, PENDIENTE } = MembershipStatus;

/** Helper para construir una membresía con createdAt determinista por día. */
function m(
  id: string,
  role: MembershipRole,
  estado: MembershipStatus,
  dayOffset = 0,
): MemberLite {
  return { id, role, estado, createdAt: new Date(2026, 0, 1 + dayOffset) };
}

describe('evaluateOwnerChange', () => {
  it('permite cambios sobre membresías que no son OWNER', () => {
    const members = [m('o1', OWNER, ACTIVA), m('op1', OPERATOR, ACTIVA)];
    const d = evaluateOwnerChange(members, 'op1', { role: VIEWER });
    expect(d).toEqual({ allowed: true, promoteToOwnerId: null });
  });

  it('permite degradar un OWNER si queda otro OWNER activo (sin traspaso)', () => {
    const members = [m('o1', OWNER, ACTIVA), m('o2', OWNER, ACTIVA)];
    const d = evaluateOwnerChange(members, 'o1', { role: ADMIN });
    expect(d).toEqual({ allowed: true, promoteToOwnerId: null });
  });

  it('traspasa la propiedad al ADMIN activo más antiguo al degradar al único OWNER', () => {
    const members = [
      m('o1', OWNER, ACTIVA, 0),
      m('a_new', ADMIN, ACTIVA, 5),
      m('a_old', ADMIN, ACTIVA, 2),
    ];
    const d = evaluateOwnerChange(members, 'o1', { role: ADMIN });
    expect(d).toEqual({ allowed: true, promoteToOwnerId: 'a_old' });
  });

  it('traspasa la propiedad al revocar (estado) al único OWNER', () => {
    const members = [m('o1', OWNER, ACTIVA, 0), m('a1', ADMIN, ACTIVA, 1)];
    const d = evaluateOwnerChange(members, 'o1', { estado: REVOCADA });
    expect(d).toEqual({ allowed: true, promoteToOwnerId: 'a1' });
  });

  it('rechaza dejar a la empresa sin OWNER cuando no hay ADMIN que asuma', () => {
    const members = [m('o1', OWNER, ACTIVA), m('op1', OPERATOR, ACTIVA)];
    const d = evaluateOwnerChange(members, 'o1', { estado: REVOCADA });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/OWNER/);
  });

  it('ignora ADMINs no activos como candidatos al traspaso', () => {
    const members = [
      m('o1', OWNER, ACTIVA),
      m('a_rev', ADMIN, REVOCADA),
      m('a_pend', ADMIN, PENDIENTE),
    ];
    const d = evaluateOwnerChange(members, 'o1', { role: OPERATOR });
    expect(d.allowed).toBe(false);
  });

  it('no exige traspaso si se cambia un OWNER ya inactivo', () => {
    const members = [m('o1', OWNER, ACTIVA), m('o2', OWNER, REVOCADA)];
    const d = evaluateOwnerChange(members, 'o2', { estado: ACTIVA });
    expect(d).toEqual({ allowed: true, promoteToOwnerId: null });
  });

  it('permite mantener OWNER activo (cambio sin pérdida de propiedad)', () => {
    const members = [m('o1', OWNER, ACTIVA)];
    const d = evaluateOwnerChange(members, 'o1', { role: OWNER, estado: ACTIVA });
    expect(d).toEqual({ allowed: true, promoteToOwnerId: null });
  });

  it('rechaza si la membresía objetivo no existe', () => {
    const members = [m('o1', OWNER, ACTIVA)];
    const d = evaluateOwnerChange(members, 'inexistente', { role: ADMIN });
    expect(d.allowed).toBe(false);
  });
});
