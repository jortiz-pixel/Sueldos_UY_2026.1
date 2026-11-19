-- Participación por módulo: la empresa se carga una vez y se habilita en
-- Importaciones con un toggle (como soloTareas hace para Sueldos). Idempotente.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "enImportaciones" BOOLEAN NOT NULL DEFAULT false;

-- Las empresas que YA tienen importaciones quedan habilitadas (no desaparecen del
-- selector al pasar a filtrar por el flag).
UPDATE "companies" SET "enImportaciones" = true
WHERE id IN (SELECT DISTINCT "companyId" FROM "importaciones");
