/**
 * HERRAMIENTA DE ADMINISTRACIÓN DE USUARIOS (CLI)
 *
 * Permite recuperar el acceso al sistema desde el servidor sin tocar la base
 * de datos a mano. Se ejecuta dentro del contenedor del backend:
 *
 *   docker compose exec backend npx tsx prisma/admin-user.ts <comando> [args]
 *
 * Comandos:
 *   list
 *       Lista todos los usuarios (email, rol, activo, último login).
 *
 *   reset <email> <nuevaPassword>
 *       Cambia la contraseña de un usuario existente y lo deja activo.
 *
 *   create-admin <email> <password> <nombre> <apellido>
 *       Crea (o reactiva) un usuario ADMIN de plataforma (ve todas las empresas).
 *
 *   promote <email>
 *       Promueve un usuario existente a ADMIN de plataforma.
 *
 *   activate <email>
 *       Reactiva un usuario marcado como inactivo.
 *
 * Ejemplos:
 *   docker compose exec backend npx tsx prisma/admin-user.ts list
 *   docker compose exec backend npx tsx prisma/admin-user.ts reset admin@sueldos.uy NuevaClave123!
 *   docker compose exec backend npx tsx prisma/admin-user.ts create-admin jortiz@gro.com.uy MiClave123! Joaquin Ortiz
 */

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function uso(): never {
  console.log(`
Uso: npx tsx prisma/admin-user.ts <comando> [args]

  list
  reset <email> <nuevaPassword>
  create-admin <email> <password> <nombre> <apellido>
  promote <email>
  activate <email>
  rename <email> <nombre> <apellido>
`);
  process.exit(1);
}

async function list() {
  const users = await prisma.user.findMany({
    orderBy: { email: 'asc' },
    select: { email: true, nombre: true, apellido: true, role: true, active: true, lastLoginAt: true },
  });
  if (users.length === 0) {
    console.log('⚠️  No hay usuarios en la base de datos.');
    return;
  }
  console.log(`\n${users.length} usuario(s):\n`);
  for (const u of users) {
    const estado = u.active ? 'activo' : 'INACTIVO';
    const ultimo = u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 16).replace('T', ' ') : 'nunca';
    console.log(`  ${u.email.padEnd(32)} ${u.role.padEnd(10)} ${estado.padEnd(9)} login: ${ultimo}  (${u.nombre} ${u.apellido})`);
  }
  console.log('');
}

async function reset(email: string, password: string) {
  if (!email || !password) uso();
  if (password.length < 8) { console.error('❌ La contraseña debe tener al menos 8 caracteres.'); process.exit(1); }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error(`❌ No existe un usuario con email "${email}". Usá "list" para ver los existentes o "create-admin" para crear uno.`); process.exit(1); }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { email }, data: { passwordHash, active: true } });
  console.log(`✅ Contraseña actualizada para ${email} (usuario activo).`);
}

async function createAdmin(email: string, password: string, nombre: string, apellido: string) {
  if (!email || !password || !nombre || !apellido) uso();
  if (password.length < 8) { console.error('❌ La contraseña debe tener al menos 8 caracteres.'); process.exit(1); }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: UserRole.ADMIN, active: true, nombre, apellido },
    create: { email, passwordHash, role: UserRole.ADMIN, active: true, nombre, apellido },
  });
  console.log(`✅ Usuario ADMIN listo: ${user.email} (ve todas las empresas).`);
}

async function promote(email: string) {
  if (!email) uso();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error(`❌ No existe un usuario con email "${email}".`); process.exit(1); }
  await prisma.user.update({ where: { email }, data: { role: UserRole.ADMIN, active: true } });
  console.log(`✅ ${email} ahora es ADMIN de plataforma (ve todas las empresas).`);
}

async function activate(email: string) {
  if (!email) uso();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error(`❌ No existe un usuario con email "${email}".`); process.exit(1); }
  await prisma.user.update({ where: { email }, data: { active: true } });
  console.log(`✅ ${email} reactivado.`);
}

async function rename(email: string, nombre: string, apellido: string) {
  if (!email || !nombre || !apellido) uso();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error(`❌ No existe un usuario con email "${email}".`); process.exit(1); }
  await prisma.user.update({ where: { email }, data: { nombre, apellido } });
  console.log(`✅ ${email} ahora se llama ${nombre} ${apellido}.`);
}

async function main() {
  const [comando, ...args] = process.argv.slice(2);
  switch (comando) {
    case 'list': await list(); break;
    case 'reset': await reset(args[0], args[1]); break;
    case 'create-admin': await createAdmin(args[0], args[1], args[2], args[3]); break;
    case 'promote': await promote(args[0]); break;
    case 'activate': await activate(args[0]); break;
    case 'rename': await rename(args[0], args[1], args[2]); break;
    default: uso();
  }
}

main()
  .catch((e) => { console.error('❌ Error:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
