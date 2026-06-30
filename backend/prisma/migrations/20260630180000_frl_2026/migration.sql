-- FRL (Fondo de Reconversión Laboral) 2026: 0,10% para el obrero y 0,10% para
-- el patrón (antes 0,125% obrero y 0,025% patronal). Vigente desde 2026-01-01.
-- Valor en la convención del sistema: 10 = 0,10% (12.5 = 0,125%).
INSERT INTO "payroll_parameters" ("id","key","value","description","effectiveDate")
VALUES
  ('seed_2026_FRL_OBRERO_RATE_BP',   'FRL_OBRERO_RATE_BP',   '10', 'FRL obrero 0,10% (2026)',   '2026-01-01T00:00:00.000Z'),
  ('seed_2026_FRL_PATRONAL_RATE_BP', 'FRL_PATRONAL_RATE_BP', '10', 'FRL patronal 0,10% (2026)', '2026-01-01T00:00:00.000Z')
ON CONFLICT ("id") DO UPDATE
  SET "value" = EXCLUDED."value",
      "description" = EXCLUDED."description",
      "effectiveDate" = EXCLUDED."effectiveDate";
