-- Peso bruto/neto en la liquidación del despachante (datos logísticos). Idempotente.
ALTER TABLE "importacion_liquidaciones" ADD COLUMN IF NOT EXISTS "kilosBrutos" DOUBLE PRECISION;
ALTER TABLE "importacion_liquidaciones" ADD COLUMN IF NOT EXISTS "kilosNetos" DOUBLE PRECISION;
