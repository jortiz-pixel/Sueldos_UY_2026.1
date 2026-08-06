-- Portal de clientes (Fase 2): credenciales RUT + PIN para que la empresa vea y
-- descargue los recibos confirmados de sus empleados. Idempotente.
CREATE TABLE IF NOT EXISTS "company_portal_credentials" (
  "id"             TEXT PRIMARY KEY,
  "companyId"      TEXT NOT NULL,
  "pinHash"        TEXT NOT NULL,
  "mustSetPin"     BOOLEAN NOT NULL DEFAULT true,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"    TIMESTAMP(3),
  "lastLoginAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_portal_credentials_companyId_key"
  ON "company_portal_credentials" ("companyId");
