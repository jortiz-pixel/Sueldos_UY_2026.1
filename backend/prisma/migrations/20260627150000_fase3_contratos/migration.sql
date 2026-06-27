-- Fase 3: Contratos versionados (GNS Personal)
-- Migración aditiva con backfill: crea un contrato inicial por empleado existente.

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL DEFAULT 1,
    "vigenciaDesde" TIMESTAMP(3) NOT NULL,
    "vigenciaHasta" TIMESTAMP(3),
    "fechaIngreso" TIMESTAMP(3) NOT NULL,
    "tipoContrato" TEXT,
    "cargo" TEXT,
    "sector" TEXT,
    "categoria" TEXT,
    "nivel" TEXT,
    "salaryType" "SalaryType" NOT NULL DEFAULT 'MENSUAL',
    "cobra" TEXT,
    "salarioNominal" BIGINT NOT NULL,
    "jornal" BIGINT,
    "horasDia" INTEGER,
    "regimenHorario" TEXT,
    "sucursal" TEXT,
    "moneda" TEXT NOT NULL DEFAULT 'UYU',
    "grupoActividadNum" INTEGER,
    "subgrupo" TEXT,
    "observacion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contracts_employeeId_vigenciaDesde_idx" ON "contracts"("employeeId", "vigenciaDesde");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: un contrato inicial por empleado existente (a partir de sus datos actuales)
INSERT INTO "contracts" (
    "id", "employeeId", "numero", "vigenciaDesde", "fechaIngreso",
    "cargo", "categoria", "nivel", "salaryType", "salarioNominal", "jornal",
    "moneda", "activo", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text, "id", 1, "fechaIngreso", "fechaIngreso",
    "cargo", "categoria", "nivel", "salaryType", "salarioNominal", "jornal",
    'UYU', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "employees";
