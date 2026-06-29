-- Conceptos comunes (companyId NULL = visible en todas las empresas) vs
-- propios (companyId con valor = visible solo en esa empresa), más la
-- posibilidad de ocultar un común por empresa. Migración aditiva.

-- 1) companyId pasa a ser opcional (NULL = común).
ALTER TABLE "concepts" ALTER COLUMN "companyId" DROP NOT NULL;

-- 2) Lista de empresas que ocultaron el concepto de sus listados.
ALTER TABLE "concepts" ADD COLUMN IF NOT EXISTS "ocultoEn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 3) Unicidad de código entre los conceptos comunes (companyId IS NULL).
--    Los propios ya quedan cubiertos por el índice único (companyId, codigo).
CREATE UNIQUE INDEX IF NOT EXISTS "concepts_common_codigo_key"
  ON "concepts"("codigo") WHERE "companyId" IS NULL;
