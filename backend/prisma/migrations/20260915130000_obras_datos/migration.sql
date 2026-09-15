-- Datos de obra adicionales (pantalla "Datos de Obra" de GNS).
ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "numeroIdentificador" TEXT;
ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "fRealizacion" TEXT;
ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "estado" TEXT;
ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "aportePatronal" TEXT;
ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "cajaActividad" TEXT;
ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "nroAutorizacion" TEXT;
