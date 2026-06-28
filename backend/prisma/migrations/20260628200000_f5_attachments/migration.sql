-- F5: Adjuntos genéricos (foto, scans, carné de salud, CV, documentos).
-- Migración aditiva.

DO $$ BEGIN
  CREATE TYPE "AttachmentType" AS ENUM ('FOTO', 'CEDULA', 'LIBRETA', 'CARNE_SALUD', 'CV', 'OTRO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "attachments" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "ownerType"    TEXT NOT NULL,
  "ownerId"      TEXT NOT NULL,
  "tipo"         "AttachmentType" NOT NULL DEFAULT 'OTRO',
  "fileName"     TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "storageKey"   TEXT NOT NULL,
  "tamano"       INTEGER NOT NULL,
  "vencimiento"  TIMESTAMP(3),
  "uploadedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "attachments_ownerType_ownerId_idx" ON "attachments"("ownerType", "ownerId");
CREATE INDEX IF NOT EXISTS "attachments_companyId_idx" ON "attachments"("companyId");

DO $$ BEGIN
  ALTER TABLE "attachments" ADD CONSTRAINT "attachments_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
