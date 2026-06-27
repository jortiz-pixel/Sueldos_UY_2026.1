-- Fase 4: Motor de Conceptos parametrizable (GNS Personal)
-- Migración aditiva.

CREATE TABLE "concepts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nombreReducido" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 100,
    "tipoOperacion" "ItemType" NOT NULL DEFAULT 'HABER',
    "tipoCalculo" TEXT NOT NULL DEFAULT 'VALOR_FIJO',
    "baseCalculo" TEXT,
    "valorRate" INTEGER,
    "valorFijo" BIGINT,
    "gravado" BOOLEAN NOT NULL DEFAULT true,
    "codBps" INTEGER,
    "visibleRecibo" BOOLEAN NOT NULL DEFAULT true,
    "incluyeLicencia" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "concepts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "concepts_companyId_codigo_key" ON "concepts"("companyId", "codigo");

ALTER TABLE "concepts" ADD CONSTRAINT "concepts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
