-- Fecha de fin de contrato (vigencia explícita / terminación)
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "fechaFin" TIMESTAMP(3);
