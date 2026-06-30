-- Visibilidad de empresa: "ocultar" la saca del selector de trabajo sin eliminarla.
-- Distinto de "active" (que es la baja/eliminación lógica).
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false;
