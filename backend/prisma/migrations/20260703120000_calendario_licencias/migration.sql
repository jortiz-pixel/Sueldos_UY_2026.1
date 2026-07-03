-- Calendario: día de vencimiento de presentación/pago de nómina BPS por empresa
-- (depende de la aportación y el cronograma de ATyR; configurable, default 20).
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "diaVencimientoBps" INTEGER NOT NULL DEFAULT 20;
