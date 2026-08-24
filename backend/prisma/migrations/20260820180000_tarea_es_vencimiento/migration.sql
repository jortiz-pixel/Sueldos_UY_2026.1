-- Marca de vencimiento fiscal (impuesto/DDJJ) para mostrar en el calendario.
ALTER TABLE "tareas" ADD COLUMN IF NOT EXISTS "esVencimiento" BOOLEAN NOT NULL DEFAULT false;
