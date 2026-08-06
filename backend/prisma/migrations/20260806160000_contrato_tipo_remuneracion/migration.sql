-- Tipo de remuneración BPS (Tabla 2) por contrato: 1 Mensual · 2 Jornalero ·
-- 3 Destajista · 4 A comisión · 5 Mixta · 6 Sin remuneración. Idempotente.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "tipoRemuneracion" INTEGER NOT NULL DEFAULT 1;

-- Backfill: los jornaleros existentes quedan en 2; el resto en 1 (mensual).
UPDATE "contracts" SET "tipoRemuneracion" = 2 WHERE "salaryType" = 'JORNALERO';
