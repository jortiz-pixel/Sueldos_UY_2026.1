-- Agenda del estudio: tareas y vencimientos (uso interno). Idempotente.
CREATE TABLE IF NOT EXISTS "tareas" (
  "id" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "descripcion" TEXT,
  "categoria" TEXT,
  "companyId" TEXT,
  "responsableId" TEXT,
  "tipo" TEXT NOT NULL DEFAULT 'RECURRENTE',
  "recurrencia" TEXT,
  "diaVencimiento" INTEGER,
  "mesAncla" INTEGER,
  "fechaVencimiento" TIMESTAMP(3),
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tareas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tareas_companyId_idx" ON "tareas"("companyId");
CREATE INDEX IF NOT EXISTS "tareas_activa_idx" ON "tareas"("activa");

CREATE TABLE IF NOT EXISTS "tarea_vencimientos" (
  "id" TEXT NOT NULL,
  "tareaId" TEXT NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "completadoPor" TEXT,
  "completadoAt" TIMESTAMP(3),
  "nota" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tarea_vencimientos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tarea_vencimientos_tareaId_fecha_key" ON "tarea_vencimientos"("tareaId", "fecha");
CREATE INDEX IF NOT EXISTS "tarea_vencimientos_fecha_idx" ON "tarea_vencimientos"("fecha");
CREATE INDEX IF NOT EXISTS "tarea_vencimientos_estado_idx" ON "tarea_vencimientos"("estado");

DO $$ BEGIN
  ALTER TABLE "tareas" ADD CONSTRAINT "tareas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "tareas" ADD CONSTRAINT "tareas_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "tarea_vencimientos" ADD CONSTRAINT "tarea_vencimientos_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "tareas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
