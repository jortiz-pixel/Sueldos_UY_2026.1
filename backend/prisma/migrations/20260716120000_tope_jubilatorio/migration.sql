-- Tope de aportación jubilatoria (art. 7 Ley 16.713): la base del aporte
-- jubilatorio personal se topea en este monto; el aguinaldo topea a la mitad
-- (criterio GNS: MAXAPJ / MAXAPJ/2). FONASA y FRL no tienen tope.
INSERT INTO "payroll_parameters" ("id", "key", "value", "description", "effectiveDate")
VALUES ('tope_jub_2026', 'BPS_TOPE_JUBILATORIO', '272564', 'Tope aportación jubilatoria 2026 ($272.564; aguinaldo: mitad)', '2026-01-01T00:00:00.000Z')
ON CONFLICT ("id") DO UPDATE SET "value" = EXCLUDED."value", "description" = EXCLUDED."description";
