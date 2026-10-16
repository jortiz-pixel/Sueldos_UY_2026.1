-- Detalle del costeo histórico (anticipos, gastos, asientos, conciliaciones).
ALTER TABLE "importaciones" ADD COLUMN IF NOT EXISTS "costeoDetalle" JSONB;
