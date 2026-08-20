-- Fecha de pago por recibo (figura en el recibo PDF). Idempotente.
ALTER TABLE "liquidations" ADD COLUMN IF NOT EXISTS "fechaPago" TIMESTAMP(3);
