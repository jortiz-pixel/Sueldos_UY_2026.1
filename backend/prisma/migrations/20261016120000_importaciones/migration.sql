-- Módulo IMPORTACIONES (comercio exterior). Migración ADITIVA e idempotente.
-- Registra operaciones de importación de mercadería por empresa (multiempresa),
-- con costeo, tributos, gastos e ítems. Dinero en centésimos de peso (BIGINT).
-- Ver docs/importaciones-diseno.md.

-- ----------------------------------------------------------------
-- Enums (idempotentes)
-- ----------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "ImportacionEstado" AS ENUM ('BORRADOR', 'EN_TRAMITE', 'NACIONALIZADA', 'CERRADA', 'ANULADA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ImportacionRegimen" AS ENUM ('DEFINITIVA', 'ADMISION_TEMPORARIA', 'DEPOSITO', 'TRANSITO', 'ZONA_FRANCA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TributoImportacionTipo" AS ENUM ('ARANCEL_TEC', 'TASA_SERVICIOS', 'IMESI', 'IVA_IMPORTACION', 'ANTICIPO_IVA', 'ANTICIPO_IRAE', 'RECARGO', 'OTRO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "GastoImportacionConcepto" AS ENUM ('HONORARIOS_DESPACHANTE', 'DEPOSITO', 'MOVILIZACION', 'GASTOS_BANCARIOS', 'FLETE_INTERNO', 'SEGURO_LOCAL', 'OTRO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ----------------------------------------------------------------
-- Tabla importaciones (cabezal)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "importaciones" (
  "id"                    TEXT NOT NULL,
  "companyId"             TEXT NOT NULL,
  "estado"                "ImportacionEstado"  NOT NULL DEFAULT 'BORRADOR',
  "regimen"               "ImportacionRegimen" NOT NULL DEFAULT 'DEFINITIVA',
  "proveedorExterior"     TEXT,
  "paisOrigen"            TEXT,
  "incoterm"              TEXT,
  "monedaOrigen"          TEXT NOT NULL DEFAULT 'USD',
  "tipoCambio"            DOUBLE PRECISION NOT NULL DEFAULT 1,
  "facturaComercialNro"   TEXT,
  "facturaComercialFecha" TIMESTAMP(3),
  "duaNumero"             TEXT,
  "duaFecha"              TIMESTAMP(3),
  "despachante"           TEXT,
  "aduana"                TEXT,
  "transporteDoc"         TEXT,
  "certificadoOrigen"     BOOLEAN NOT NULL DEFAULT false,
  "fechaEmbarque"         TIMESTAMP(3),
  "fechaArribo"           TIMESTAMP(3),
  "fechaNacionalizacion"  TIMESTAMP(3),
  "fob"                   BIGINT NOT NULL DEFAULT 0,
  "flete"                 BIGINT NOT NULL DEFAULT 0,
  "seguro"                BIGINT NOT NULL DEFAULT 0,
  "cif"                   BIGINT NOT NULL DEFAULT 0,
  "totalTributos"         BIGINT NOT NULL DEFAULT 0,
  "totalGastos"           BIGINT NOT NULL DEFAULT 0,
  "costoMercaderia"       BIGINT NOT NULL DEFAULT 0,
  "creditoFiscalIva"      BIGINT NOT NULL DEFAULT 0,
  "anticipos"             BIGINT NOT NULL DEFAULT 0,
  "notas"                 TEXT,
  "creadoPor"             TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importaciones_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "importaciones"
    ADD CONSTRAINT "importaciones_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "importaciones_companyId_idx" ON "importaciones"("companyId");
CREATE INDEX IF NOT EXISTS "importaciones_estado_idx"    ON "importaciones"("estado");

-- ----------------------------------------------------------------
-- Tabla importacion_items
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "importacion_items" (
  "id"               TEXT NOT NULL,
  "importacionId"    TEXT NOT NULL,
  "descripcion"      TEXT NOT NULL,
  "ncm"              TEXT,
  "cantidad"         DOUBLE PRECISION NOT NULL DEFAULT 1,
  "fobUnitario"      BIGINT NOT NULL DEFAULT 0,
  "fobTotal"         BIGINT NOT NULL DEFAULT 0,
  "costoProrrateado" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "importacion_items_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "importacion_items"
    ADD CONSTRAINT "importacion_items_importacionId_fkey"
    FOREIGN KEY ("importacionId") REFERENCES "importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "importacion_items_importacionId_idx" ON "importacion_items"("importacionId");

-- ----------------------------------------------------------------
-- Tabla importacion_tributos
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "importacion_tributos" (
  "id"             TEXT NOT NULL,
  "importacionId"  TEXT NOT NULL,
  "tipo"           "TributoImportacionTipo" NOT NULL,
  "baseImponible"  BIGINT NOT NULL DEFAULT 0,
  "tasa"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "monto"          BIGINT NOT NULL DEFAULT 0,
  "recuperable"    BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "importacion_tributos_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "importacion_tributos"
    ADD CONSTRAINT "importacion_tributos_importacionId_fkey"
    FOREIGN KEY ("importacionId") REFERENCES "importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "importacion_tributos_importacionId_idx" ON "importacion_tributos"("importacionId");

-- ----------------------------------------------------------------
-- Tabla importacion_gastos
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "importacion_gastos" (
  "id"             TEXT NOT NULL,
  "importacionId"  TEXT NOT NULL,
  "concepto"       "GastoImportacionConcepto" NOT NULL,
  "descripcion"    TEXT,
  "monto"          BIGINT NOT NULL DEFAULT 0,
  "gravadoIva"     BOOLEAN NOT NULL DEFAULT false,
  "ivaGasto"       BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "importacion_gastos_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "importacion_gastos"
    ADD CONSTRAINT "importacion_gastos_importacionId_fkey"
    FOREIGN KEY ("importacionId") REFERENCES "importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "importacion_gastos_importacionId_idx" ON "importacion_gastos"("importacionId");
