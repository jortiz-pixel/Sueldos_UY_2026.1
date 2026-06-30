-- Legajo (employeeNumber) único por empresa + CI deja de ser único global y
-- pasa a ser único por empresa (la misma persona puede tener una ficha por
-- empresa). Migración aditiva.

-- 1) Quitar la unicidad global del CI.
DROP INDEX IF EXISTS "employees_ci_key";

-- 2) Agregar la columna de legajo.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "employeeNumber" INTEGER;

-- 3) Backfill: numerar el legajo por empresa (1,2,3…) por orden de creación.
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "createdAt", id) AS rn
  FROM "employees"
)
UPDATE "employees" e SET "employeeNumber" = n.rn
FROM numbered n WHERE e.id = n.id AND e."employeeNumber" IS NULL;

-- 4) Unicidad por empresa: CI y legajo.
CREATE UNIQUE INDEX IF NOT EXISTS "employees_companyId_ci_key"
  ON "employees"("companyId", "ci");
CREATE UNIQUE INDEX IF NOT EXISTS "employees_companyId_employeeNumber_key"
  ON "employees"("companyId", "employeeNumber");
