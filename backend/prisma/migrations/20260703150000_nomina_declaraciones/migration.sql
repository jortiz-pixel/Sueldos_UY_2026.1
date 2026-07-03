-- Historial de declaraciones de nómina BPS: foto de lo declarado en cada
-- archivo emitido (N = nómina, R = rectificativa). La rectificativa se
-- calcula como diferencia entre el estado actual y lo ya declarado.
CREATE TABLE IF NOT EXISTS "nomina_declaraciones" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "montoTotal" BIGINT NOT NULL DEFAULT 0,
    "resumen" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nomina_declaraciones_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "nomina_declaraciones_companyId_year_month_idx"
  ON "nomina_declaraciones"("companyId", "year", "month");
