-- Estado del costeo documental (OK/PENDIENTE) y tipos de cambio usados.
ALTER TABLE "importaciones" ADD COLUMN IF NOT EXISTS "costeoEstado" TEXT;
ALTER TABLE "importaciones" ADD COLUMN IF NOT EXISTS "costeoMotivo" TEXT;
ALTER TABLE "importaciones" ADD COLUMN IF NOT EXISTS "tcContable" DOUBLE PRECISION;
ALTER TABLE "importaciones" ADD COLUMN IF NOT EXISTS "tcAduanero" DOUBLE PRECISION;
