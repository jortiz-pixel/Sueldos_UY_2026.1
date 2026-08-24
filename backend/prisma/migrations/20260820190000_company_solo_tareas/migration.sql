-- Cliente exclusivo de la Agenda del estudio (Tareas), no de Sueldos.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "soloTareas" BOOLEAN NOT NULL DEFAULT false;
