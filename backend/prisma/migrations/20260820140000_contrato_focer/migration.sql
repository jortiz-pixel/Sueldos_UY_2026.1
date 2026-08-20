-- FOCER por contrato (construcción Grupo 9.1). Idempotente.
-- focerTipo: 1 = declara 0,5% · 2 = declara 5%.
-- focerTipoContrato: 1 indefinido · 2 a prueba · 3 a término · 4 suplencia.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "focerTipo" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "focerTipoContrato" INTEGER;
