-- Código FOCER del estudio (registro 2 de la nómina del Fondo de Cesantía y
-- Retiro de la construcción). Nullable e idempotente.
ALTER TABLE "gestoria_config" ADD COLUMN IF NOT EXISTS "focerCodigo" TEXT;
