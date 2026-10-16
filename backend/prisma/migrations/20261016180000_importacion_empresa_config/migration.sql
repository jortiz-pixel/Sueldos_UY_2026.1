-- Configuración fiscal y contable de la empresa para importaciones (Etapa 2 §3).
-- Una por empresa; plan de cuentas configurable (JSON). Idempotente.

CREATE TABLE IF NOT EXISTS "importacion_empresa_config" (
  "id"                     TEXT NOT NULL,
  "companyId"              TEXT NOT NULL,
  "iraeRegimen"            TEXT,
  "ivaRegimen"             TEXT,
  "grupoCede"              TEXT,
  "formularioDgi"          TEXT,
  "tipoActividad"          TEXT,
  "porcentajeDeduccionIva" DOUBLE PRECISION,
  "marcoContable"          TEXT,
  "metodoCosteo"           TEXT,
  "politicaDistribucion"   TEXT,
  "tratamientoMoneda"      TEXT,
  "monedaFuncional"        TEXT NOT NULL DEFAULT 'UYU',
  "monedaPresentacion"     TEXT NOT NULL DEFAULT 'UYU',
  "cierreEjercicio"        TEXT,
  "inicioActividad"        TIMESTAMP(3),
  "planCuentas"            JSONB,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importacion_empresa_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "importacion_empresa_config_companyId_key" ON "importacion_empresa_config"("companyId");

DO $$ BEGIN
  ALTER TABLE "importacion_empresa_config"
    ADD CONSTRAINT "importacion_empresa_config_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
