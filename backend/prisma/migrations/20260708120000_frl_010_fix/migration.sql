-- Garantiza que el FRL (obrero y patronal) vigente en 2026 sea 0,10% (10 bp).
-- Corrige cualquier valor previo (0,125% obrero / 0,025% patronal) que hubiera
-- quedado cargado con vigencia 2026 por una migración anterior no aplicada.
UPDATE "payroll_parameters"
   SET "value" = '10', "description" = 'FRL obrero 0,10% (2026)'
 WHERE "key" = 'FRL_OBRERO_RATE_BP' AND "effectiveDate" >= '2026-01-01T00:00:00.000Z';

UPDATE "payroll_parameters"
   SET "value" = '10', "description" = 'FRL patronal 0,10% (2026)'
 WHERE "key" = 'FRL_PATRONAL_RATE_BP' AND "effectiveDate" >= '2026-01-01T00:00:00.000Z';

-- Si por algún motivo no existían, los crea (id estable, idempotente).
INSERT INTO "payroll_parameters" ("id","key","value","description","effectiveDate")
VALUES
  ('frl_2026_obrero',   'FRL_OBRERO_RATE_BP',   '10', 'FRL obrero 0,10% (2026)',   '2026-01-01T00:00:00.000Z'),
  ('frl_2026_patronal', 'FRL_PATRONAL_RATE_BP', '10', 'FRL patronal 0,10% (2026)', '2026-01-01T00:00:00.000Z')
ON CONFLICT ("id") DO UPDATE SET "value" = EXCLUDED."value", "description" = EXCLUDED."description";
