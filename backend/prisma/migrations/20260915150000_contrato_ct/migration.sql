-- Datos CT (construcción) por trabajador para nómina reg 6 y FOCER.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "categoriaCtCod" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "cajaActividad" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "asignacionFamiliar" BOOLEAN;
