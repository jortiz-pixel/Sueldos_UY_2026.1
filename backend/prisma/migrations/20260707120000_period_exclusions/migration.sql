-- Exclusión de personas por período: una persona con contrato vigente que
-- NO se liquida en ese mes (subsidio, licencia sin goce, etc.). Reversible.
CREATE TABLE IF NOT EXISTS "period_exclusions" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "period_exclusions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "period_exclusions_periodId_employeeId_key"
  ON "period_exclusions"("periodId", "employeeId");
ALTER TABLE "period_exclusions"
  ADD CONSTRAINT "period_exclusions_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
