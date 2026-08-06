-- Portal de empleados (Fase 1): credenciales CI + PIN para ver/descargar
-- recibos confirmados. Idempotente.
CREATE TABLE IF NOT EXISTS "employee_portal_credentials" (
  "id"             TEXT PRIMARY KEY,
  "ci"             TEXT NOT NULL,
  "pinHash"        TEXT NOT NULL,
  "mustSetPin"     BOOLEAN NOT NULL DEFAULT true,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"    TIMESTAMP(3),
  "lastLoginAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_portal_credentials_ci_key"
  ON "employee_portal_credentials" ("ci");
