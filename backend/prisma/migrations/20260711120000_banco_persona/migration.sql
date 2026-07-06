-- Datos bancarios de la persona para la planilla de pagos al banco.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "banco" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "bancoSucursal" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "bancoCuenta" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "bancoMoneda" TEXT NOT NULL DEFAULT 'UYU';
