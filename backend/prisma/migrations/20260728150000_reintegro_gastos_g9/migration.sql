-- REINTEGRO DE GASTOS para las empresas del grupo 9 (construcción) EXISTENTES.
-- El concepto ya está en el catálogo del laudo (ensureConceptosConstruccion lo
-- crea al liquidar o al editar la empresa), pero acá se inserta directo para
-- que aparezca en el desplegable de haberes sin esperar a la próxima
-- liquidación. Marcador de empresa G9: ya tiene el concepto FONDO_SOCIAL.
-- Haber NO GRAVADO: suma al total a percibir, fuera de la base de aportes,
-- IRPF y ApliAFondos; no se declara en la nómina BPS. Idempotente.

INSERT INTO "concepts" (
  "id", "companyId", "codigo", "nombre", "orden", "tipoOperacion",
  "tipoCalculo", "baseCalculo", "valorRate", "valorFijo", "gravado",
  "codBps", "activo", "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || f."companyId"),
  f."companyId", 'REINTEGRO_GASTOS', 'Reintegro de Gastos', 69, 'HABER',
  'VALOR_FIJO', NULL, NULL, 0, false,
  NULL, true, CURRENT_TIMESTAMP
FROM "concepts" f
WHERE f."codigo" = 'FONDO_SOCIAL' AND f."companyId" IS NOT NULL
ON CONFLICT ("companyId", "codigo") DO NOTHING;
