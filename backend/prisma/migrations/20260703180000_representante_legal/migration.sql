-- Representante legal de la empresa: quién comparece y firma los contratos
-- de trabajo en nombre del empleador (validez ante juzgado laboral).
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "representanteLegal" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "representanteCi" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "representanteCargo" TEXT;
