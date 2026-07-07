-- Jornales del laudo de la construcción por categoría y recuadro (incluidos /
-- no incluidos en la ley 14.411), valor hora en centésimos, con vigencia.
CREATE TABLE IF NOT EXISTS "jornales_construccion" (
    "id" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "recuadro" TEXT NOT NULL,
    "valorHora" BIGINT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "jornales_construccion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "jornales_construccion_categoria_recuadro_effectiveDate_key"
  ON "jornales_construccion"("categoria", "recuadro", "effectiveDate");

-- Valores conocidos (recibo GNS 01/2026): Oficial Albañil (incluidos) hora
-- 444,85 · ½ Oficial Albañil (incluidos) jornal día 2.068,80 → hora 258,60
-- (base de ropa 5%, transporte 4,375% y herramientas 2%). El resto se completa
-- desde Parámetros → Jornales construcción.
INSERT INTO "jornales_construccion" ("id", "categoria", "recuadro", "valorHora", "effectiveDate") VALUES
  ('jc_2026_incl_oficial_alba', 'VIII — Oficial Albañil', 'INCLUIDOS', 44485, '2026-01-01T00:00:00.000Z'),
  ('jc_2026_incl_medio_alba',   'V — ½ Oficial Albañil',  'INCLUIDOS', 25860, '2026-01-01T00:00:00.000Z')
ON CONFLICT ("categoria", "recuadro", "effectiveDate") DO NOTHING;
