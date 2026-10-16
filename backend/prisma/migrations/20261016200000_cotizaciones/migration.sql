-- Cotizaciones (tipos de cambio) por fecha/moneda/tipo. Globales. Etapa 2 §6.
-- Idempotente.

DO $$ BEGIN
  CREATE TYPE "CotizacionTipo" AS ENUM ('CONTABLE', 'ADUANERO', 'BANCARIO', 'ANTICIPO', 'OBLIGACION', 'CIERRE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "cotizaciones" (
  "id"            TEXT NOT NULL,
  "fecha"         TIMESTAMP(3) NOT NULL,
  "monedaOrigen"  TEXT NOT NULL,
  "monedaDestino" TEXT NOT NULL DEFAULT 'UYU',
  "tipo"          "CotizacionTipo" NOT NULL DEFAULT 'CONTABLE',
  "valor"         DOUBLE PRECISION NOT NULL,
  "compra"        DOUBLE PRECISION,
  "venta"         DOUBLE PRECISION,
  "fuente"        TEXT NOT NULL DEFAULT 'MANUAL',
  "fechaConsulta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmadoPor" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cotizaciones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cotizaciones_fecha_monedaOrigen_monedaDestino_tipo_key"
  ON "cotizaciones"("fecha", "monedaOrigen", "monedaDestino", "tipo");
CREATE INDEX IF NOT EXISTS "cotizaciones_monedaOrigen_fecha_idx" ON "cotizaciones"("monedaOrigen", "fecha");
