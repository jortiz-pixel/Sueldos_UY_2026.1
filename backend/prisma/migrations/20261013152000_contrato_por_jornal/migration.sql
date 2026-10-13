-- Construcción: modalidad de pago POR JORNAL (día). Cuando es true, el jornal
-- del contrato se interpreta como valor por DÍA (base = días × jornal; valor
-- hora = jornal ÷ 8). Default false = modelo por HORA (jornal = valor hora).
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "construccionPorJornal" BOOLEAN NOT NULL DEFAULT false;
