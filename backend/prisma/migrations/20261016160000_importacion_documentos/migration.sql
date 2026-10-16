-- Expediente de importación: documentos (archivos originales + hash + tipo +
-- estado de procesamiento). Migración ADITIVA e idempotente. Etapa 1 de lectura
-- y conciliación. Ver docs/importaciones-diseno.md.

DO $$ BEGIN
  CREATE TYPE "TipoDocumentoImportacion" AS ENUM (
    'FACTURA_COMERCIAL', 'DUA', 'LIQUIDACION_DESPACHANTE', 'SOLICITUD_FONDOS',
    'FACTURA_SERVICIOS_DESPACHANTE', 'SWIFT', 'DEBITO_BANCARIO', 'FACTURA_FLETE',
    'FACTURA_SEGURO', 'PAGO_TRIBUTOS', 'PACKING_LIST', 'DOC_TRANSPORTE',
    'NOTA_CREDITO_DEBITO', 'OTRO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "EstadoProcesamientoDoc" AS ENUM ('PENDIENTE', 'PROCESANDO', 'PROCESADO', 'ERROR', 'DUPLICADO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "importacion_documentos" (
  "id"             TEXT NOT NULL,
  "importacionId"  TEXT NOT NULL,
  "fileName"       TEXT NOT NULL,
  "mimeType"       TEXT NOT NULL,
  "storageKey"     TEXT NOT NULL,
  "hash"           TEXT NOT NULL,
  "tamano"         INTEGER NOT NULL,
  "paginas"        INTEGER,
  "tipoDetectado"  "TipoDocumentoImportacion",
  "tipoConfirmado" "TipoDocumentoImportacion",
  "confianzaTipo"  DOUBLE PRECISION,
  "estadoProc"     "EstadoProcesamientoDoc" NOT NULL DEFAULT 'PENDIENTE',
  "errorProc"      TEXT,
  "subidoPor"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importacion_documentos_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "importacion_documentos"
    ADD CONSTRAINT "importacion_documentos_importacionId_fkey"
    FOREIGN KEY ("importacionId") REFERENCES "importaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "importacion_documentos_importacionId_idx" ON "importacion_documentos"("importacionId");
CREATE INDEX IF NOT EXISTS "importacion_documentos_importacionId_hash_idx" ON "importacion_documentos"("importacionId", "hash");
