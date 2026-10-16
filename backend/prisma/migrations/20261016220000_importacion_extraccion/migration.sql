-- Extracción estructurada de los documentos del expediente (Etapa 1 sub-3):
-- facturas + artículos, liquidaciones + conceptos, transferencias. Idempotente.

CREATE TABLE IF NOT EXISTS "importacion_facturas" (
  "id" TEXT NOT NULL,
  "importacionId" TEXT NOT NULL,
  "documentoId" TEXT,
  "proveedor" TEXT, "cuit" TEXT, "numero" TEXT, "fecha" TIMESTAMP(3),
  "moneda" TEXT NOT NULL DEFAULT 'USD', "incoterm" TEXT,
  "fob" BIGINT NOT NULL DEFAULT 0, "flete" BIGINT NOT NULL DEFAULT 0,
  "seguro" BIGINT NOT NULL DEFAULT 0, "cif" BIGINT NOT NULL DEFAULT 0, "total" BIGINT NOT NULL DEFAULT 0,
  "confianza" DOUBLE PRECISION, "estadoRevision" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importacion_facturas_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "importacion_factura_articulos" (
  "id" TEXT NOT NULL, "facturaId" TEXT NOT NULL, "nro" INTEGER NOT NULL,
  "codigo" TEXT, "descripcion" TEXT NOT NULL,
  "cantidad" DOUBLE PRECISION NOT NULL DEFAULT 0, "precioUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "importacion_factura_articulos_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "importacion_liquidaciones" (
  "id" TEXT NOT NULL, "importacionId" TEXT NOT NULL, "documentoId" TEXT,
  "despachante" TEXT, "carpeta" TEXT, "fecha" TIMESTAMP(3), "aduana" TEXT, "origen" TEXT, "transporte" TEXT,
  "cif" BIGINT NOT NULL DEFAULT 0, "tipoCambio" DOUBLE PRECISION, "moneda" TEXT NOT NULL DEFAULT 'UYU',
  "total" BIGINT NOT NULL DEFAULT 0, "gastosAgenciaExtra" DOUBLE PRECISION,
  "estadoRevision" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importacion_liquidaciones_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "importacion_liquidacion_conceptos" (
  "id" TEXT NOT NULL, "liquidacionId" TEXT NOT NULL, "clave" TEXT NOT NULL, "monto" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "importacion_liquidacion_conceptos_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "importacion_transferencias" (
  "id" TEXT NOT NULL, "importacionId" TEXT NOT NULL,
  "referencia" TEXT, "fecha" TIMESTAMP(3), "moneda" TEXT NOT NULL DEFAULT 'USD',
  "importe" BIGINT NOT NULL DEFAULT 0, "comision" BIGINT NOT NULL DEFAULT 0, "totalDebitado" BIGINT NOT NULL DEFAULT 0,
  "beneficiario" TEXT, "nroDocs" INTEGER NOT NULL DEFAULT 1, "estadoRevision" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importacion_transferencias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "importacion_facturas_importacionId_idx" ON "importacion_facturas"("importacionId");
CREATE INDEX IF NOT EXISTS "importacion_factura_articulos_facturaId_idx" ON "importacion_factura_articulos"("facturaId");
CREATE INDEX IF NOT EXISTS "importacion_liquidaciones_importacionId_idx" ON "importacion_liquidaciones"("importacionId");
CREATE INDEX IF NOT EXISTS "importacion_liquidacion_conceptos_liquidacionId_idx" ON "importacion_liquidacion_conceptos"("liquidacionId");
CREATE INDEX IF NOT EXISTS "importacion_transferencias_importacionId_idx" ON "importacion_transferencias"("importacionId");

DO $$ BEGIN
  ALTER TABLE "importacion_facturas" ADD CONSTRAINT "importacion_facturas_importacionId_fkey" FOREIGN KEY ("importacionId") REFERENCES "importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "importacion_factura_articulos" ADD CONSTRAINT "importacion_factura_articulos_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "importacion_facturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "importacion_liquidaciones" ADD CONSTRAINT "importacion_liquidaciones_importacionId_fkey" FOREIGN KEY ("importacionId") REFERENCES "importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "importacion_liquidacion_conceptos" ADD CONSTRAINT "importacion_liquidacion_conceptos_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "importacion_liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "importacion_transferencias" ADD CONSTRAINT "importacion_transferencias_importacionId_fkey" FOREIGN KEY ("importacionId") REFERENCES "importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
