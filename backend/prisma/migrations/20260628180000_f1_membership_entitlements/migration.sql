-- F1: Backbone de plataforma — Membresía + Entitlements.
-- Migración ADITIVA y NO destructiva. Hace backfill desde los datos actuales
-- para que el comportamiento previo (User.companyId) se preserve exactamente.

-- ----------------------------------------------------------------
-- Enums (idempotentes)
-- ----------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MembershipStatus" AS ENUM ('PENDIENTE', 'ACTIVA', 'REVOCADA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ModuleKey" AS ENUM ('SUELDOS', 'FACTURACION', 'CONTABILIDAD', 'CRM', 'STOCK');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVO', 'TRIAL', 'SUSPENDIDO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ----------------------------------------------------------------
-- Tabla memberships
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "memberships" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "role"        "MembershipRole"   NOT NULL DEFAULT 'OPERATOR',
  "estado"      "MembershipStatus" NOT NULL DEFAULT 'ACTIVA',
  "permisos"    JSONB,
  "invitedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "memberships_userId_companyId_key" ON "memberships"("userId", "companyId");
CREATE INDEX IF NOT EXISTS "memberships_companyId_idx" ON "memberships"("companyId");

DO $$ BEGIN
  ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "memberships" ADD CONSTRAINT "memberships_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ----------------------------------------------------------------
-- Tabla entitlements
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "entitlements" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "module"        "ModuleKey" NOT NULL,
  "plan"          TEXT NOT NULL DEFAULT 'basico',
  "estado"        "EntitlementStatus" NOT NULL DEFAULT 'ACTIVO',
  "vigenciaDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "vigenciaHasta" TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "entitlements_companyId_module_key" ON "entitlements"("companyId", "module");

DO $$ BEGIN
  ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ----------------------------------------------------------------
-- Backfill: una membresía ACTIVA por cada usuario que ya tiene empresa.
--   role del usuario ADMIN -> OWNER de su empresa; el resto mantiene su rol.
--   (User.role sigue siendo el rol de plataforma; ADMIN = superadmin global.)
-- ----------------------------------------------------------------
INSERT INTO "memberships" ("id", "userId", "companyId", "role", "estado")
SELECT
  gen_random_uuid()::text,
  u."id",
  u."companyId",
  (CASE u."role"::text
     WHEN 'ADMIN'    THEN 'OWNER'
     WHEN 'OPERATOR' THEN 'OPERATOR'
     ELSE 'VIEWER'
   END)::"MembershipRole",
  'ACTIVA'::"MembershipStatus"
FROM "users" u
WHERE u."companyId" IS NOT NULL
ON CONFLICT ("userId", "companyId") DO NOTHING;

-- ----------------------------------------------------------------
-- Backfill: cada empresa existente queda con el módulo SUELDOS activo.
-- ----------------------------------------------------------------
INSERT INTO "entitlements" ("id", "companyId", "module", "plan", "estado")
SELECT gen_random_uuid()::text, c."id", 'SUELDOS'::"ModuleKey", 'basico', 'ACTIVO'::"EntitlementStatus"
FROM "companies" c
ON CONFLICT ("companyId", "module") DO NOTHING;
