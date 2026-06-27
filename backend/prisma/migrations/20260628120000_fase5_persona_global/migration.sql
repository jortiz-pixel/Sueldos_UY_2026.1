-- Fase 5: Persona global (CI único) + el contrato lleva la empresa.
-- Migración aditiva y de relajación de restricciones (no borra datos).

-- Employee.companyId pasa a ser opcional (la persona ya no pertenece directo a una empresa)
ALTER TABLE "employees" ALTER COLUMN "companyId" DROP NOT NULL;

-- CI único global (reemplaza el unique compuesto (companyId, ci))
DROP INDEX IF EXISTS "employees_companyId_ci_key";
CREATE UNIQUE INDEX IF NOT EXISTS "employees_ci_key" ON "employees"("ci");

-- Contrato gana la empresa empleadora (el vínculo)
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

-- Backfill: la empresa del contrato = la empresa actual de la persona
UPDATE "contracts" c SET "companyId" = e."companyId"
FROM "employees" e WHERE e."id" = c."employeeId" AND c."companyId" IS NULL;

CREATE INDEX IF NOT EXISTS "contracts_companyId_idx" ON "contracts"("companyId");

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
