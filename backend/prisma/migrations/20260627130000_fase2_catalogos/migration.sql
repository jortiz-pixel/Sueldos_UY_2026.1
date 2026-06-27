-- Fase 2: Catálogos (BPS/MTSS) y campos de empresa GNS
-- Migración aditiva: no elimina ni modifica datos existentes.

-- CreateTable
CREATE TABLE "tipos_aporte" (
    "codigo" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    CONSTRAINT "tipos_aporte_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "tipos_contribuyente" (
    "codigo" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    CONSTRAINT "tipos_contribuyente_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "grupos_actividad" (
    "numero" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    CONSTRAINT "grupos_actividad_pkey" PRIMARY KEY ("numero")
);

-- CreateTable
CREATE TABLE "subgrupos_actividad" (
    "id" TEXT NOT NULL,
    "grupoNumero" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    CONSTRAINT "subgrupos_actividad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subgrupos_actividad_grupoNumero_numero_key" ON "subgrupos_actividad"("grupoNumero", "numero");

-- AddForeignKey
ALTER TABLE "subgrupos_actividad" ADD CONSTRAINT "subgrupos_actividad_grupoNumero_fkey" FOREIGN KEY ("grupoNumero") REFERENCES "grupos_actividad"("numero") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable companies (campos nuevos GNS)
ALTER TABLE "companies" ADD COLUMN "numeroBps" TEXT;
ALTER TABLE "companies" ADD COLUMN "numeroBse" TEXT;
ALTER TABLE "companies" ADD COLUMN "tipoAporte" INTEGER;
ALTER TABLE "companies" ADD COLUMN "tipoContribuyente" INTEGER;
ALTER TABLE "companies" ADD COLUMN "grupoActividadNum" INTEGER;
ALTER TABLE "companies" ADD COLUMN "subgrupo" TEXT;
ALTER TABLE "companies" ADD COLUMN "naturalezaJuridica" TEXT;
ALTER TABLE "companies" ADD COLUMN "convenioColectivo" TEXT;
ALTER TABLE "companies" ADD COLUMN "inicioActividadMtss" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "fechaInscripcionBps" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "exoApoJub" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN "exoFonasa" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN "exoFrl" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN "exoCcm" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN "diasLicenciaAnio" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "companies" ADD COLUMN "primerDiaExtraDesdeAnio" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "companies" ADD COLUMN "maxDiasExtras" INTEGER NOT NULL DEFAULT 35;
ALTER TABLE "companies" ADD COLUMN "diasTrabajadosMes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "companies" ADD COLUMN "observaciones" TEXT;
