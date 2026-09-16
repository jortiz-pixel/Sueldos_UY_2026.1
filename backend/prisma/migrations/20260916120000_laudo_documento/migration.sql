-- PDF de respaldo del convenio/laudo de la construcción, por fecha de vigencia.
CREATE TABLE IF NOT EXISTS "laudo_documentos" (
  "id"            TEXT PRIMARY KEY,
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "nombre"        TEXT NOT NULL,
  "filename"      TEXT NOT NULL,
  "mime"          TEXT NOT NULL,
  "size"          INTEGER NOT NULL,
  "storageKey"    TEXT NOT NULL,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "laudo_documentos_effectiveDate_idx" ON "laudo_documentos"("effectiveDate");
