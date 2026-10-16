-- Extracción genérica por documento del expediente (DUA, e-facturas de servicios
-- UY, packing list, pagos locales, recibos, certificado de origen). Idempotente.

CREATE TABLE IF NOT EXISTS "importacion_doc_extracciones" (
  "id"            TEXT NOT NULL,
  "importacionId" TEXT NOT NULL,
  "documentoId"   TEXT,
  "tipo"          TEXT NOT NULL,
  "emisor"        TEXT,
  "rutEmisor"     TEXT,
  "serie"         TEXT,
  "numero"        TEXT,
  "fecha"         TIMESTAMP(3),
  "moneda"        TEXT,
  "total"         BIGINT NOT NULL DEFAULT 0,
  "resumen"       TEXT,
  "datos"         JSONB,
  "confianza"     DOUBLE PRECISION,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importacion_doc_extracciones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "importacion_doc_extracciones_importacionId_idx"
  ON "importacion_doc_extracciones" ("importacionId");

DO $$
BEGIN
  ALTER TABLE "importacion_doc_extracciones"
    ADD CONSTRAINT "importacion_doc_extracciones_importacionId_fkey"
    FOREIGN KEY ("importacionId") REFERENCES "importaciones" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
