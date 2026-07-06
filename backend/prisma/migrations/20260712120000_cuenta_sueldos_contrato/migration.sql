-- Cuenta contable / centro de costos del contrato: permite separar los sueldos
-- por unidad de negocio (Producción, Administración, sucursal, etc.) en el
-- asiento contable.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "cuentaSueldos" TEXT;
