-- Jornales del laudo (construcción): el valor AUTORITATIVO pasa a ser el JORNAL
-- (valor diario que publica el acta del MTSS). La hora se deriva = round(jornal/8)
-- y se mantiene en valorHora para no tocar el motor (presentismo, hora laudo,
-- autocompletado del contrato). Backfill del jornal desde la hora ya cargada (×8).
ALTER TABLE "jornales_construccion" ADD COLUMN IF NOT EXISTS "valorJornal" BIGINT;
UPDATE "jornales_construccion" SET "valorJornal" = "valorHora" * 8 WHERE "valorJornal" IS NULL;
ALTER TABLE "jornales_construccion" ALTER COLUMN "valorJornal" SET NOT NULL;
