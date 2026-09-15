-- Asignación de cada contrato a una obra (empresas de construcción CT).
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "obraId" TEXT;
CREATE INDEX IF NOT EXISTS "contracts_obraId_idx" ON "contracts"("obraId");
DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_obraId_fkey"
    FOREIGN KEY ("obraId") REFERENCES "obras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
