-- Costo fiscal de adquisición (IRAE), SEPARADO del contable. No altera lo contable.

-- 1) Nuevo tipo de cotización FISCAL (Art. 74 Dec. 150/007: interbancaria comprador
--    billete del día anterior a la operación). Idempotente.
ALTER TYPE "CotizacionTipo" ADD VALUE IF NOT EXISTS 'FISCAL';

-- 2) Detalle y estado del costo fiscal de adquisición en la importación.
ALTER TABLE "importaciones" ADD COLUMN IF NOT EXISTS "costeoFiscalEstado" TEXT;
ALTER TABLE "importaciones" ADD COLUMN IF NOT EXISTS "costeoFiscalMotivo" TEXT;
ALTER TABLE "importaciones" ADD COLUMN IF NOT EXISTS "costeoFiscalDetalle" JSONB;

-- 3) Configuración fiscal (IRAE) por empresa, independiente de la config contable.
CREATE TABLE IF NOT EXISTS "importacion_fiscal_config" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "rut" TEXT,
  "contribuyente" TEXT,
  "regimenTributario" TEXT,
  "fechaCierreEjercicio" TEXT,
  "metodoValuacionInventario" TEXT,
  "procedimientoExistencias" TEXT,
  "actividad" TEXT,
  "tipoBienes" TEXT,
  "tratamientoIva" TEXT,
  "porcentajeIvaNoRecuperable" DOUBLE PRECISION,
  "criterioMonedaExtranjera" TEXT,
  "criterioFechaOperacion" TEXT,
  "validado" BOOLEAN NOT NULL DEFAULT false,
  "validadoPor" TEXT,
  "vigenciaDesde" TIMESTAMP(3),
  "autorizacionDgi" TEXT,
  "notas" TEXT,
  "historial" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importacion_fiscal_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "importacion_fiscal_config_companyId_key" ON "importacion_fiscal_config"("companyId");
DO $$ BEGIN
  ALTER TABLE "importacion_fiscal_config"
    ADD CONSTRAINT "importacion_fiscal_config_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
