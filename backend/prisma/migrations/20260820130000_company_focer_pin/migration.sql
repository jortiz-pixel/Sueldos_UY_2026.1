-- PIN FOCER por empresa (registro 2 de la nómina del Fondo de Cesantía y Retiro
-- de la construcción). Idempotente. Se elimina el intento previo en gestoria.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "focerPin" TEXT;
ALTER TABLE "gestoria_config" DROP COLUMN IF EXISTS "focerCodigo";
