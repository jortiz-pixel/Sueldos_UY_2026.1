-- OBRAS: datos de obra de las empresas de construcción (para las nóminas).
CREATE TABLE IF NOT EXISTS "obras" (
  "id"            TEXT PRIMARY KEY,
  "companyId"     TEXT NOT NULL,
  "numeroObra"    TEXT NOT NULL,
  "nombre"        TEXT NOT NULL,
  "direccion"     TEXT,
  "departamento"  TEXT,
  "localidad"     TEXT,
  "padron"        TEXT,
  "fechaInicio"   TIMESTAMP(3),
  "fechaFin"      TIMESTAMP(3),
  "observaciones" TEXT,
  "activa"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "obras_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "obras_companyId_idx" ON "obras"("companyId");
