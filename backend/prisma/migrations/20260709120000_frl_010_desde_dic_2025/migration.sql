-- FRL (Fondo de Reconversión Laboral) a 0,10% (10 bp) para obrero y patronal
-- con VIGENCIA desde diciembre 2025.
--
-- Por qué: la búsqueda de parámetros toma el de mayor "effectiveDate" <= fecha de
-- la liquidación. Los FRL a 0,10% que ya existían tenían vigencia 2026-01-01, por
-- lo que una liquidación de diciembre 2025 caía en el parámetro con vigencia
-- 2024-01-01 (que en producción podía seguir en 0,125%/0,025%). Al insertar el
-- valor correcto con vigencia 1/12/2025, cualquier reemisión de diciembre 2025 en
-- adelante queda con el 0,10% correcto, sin alterar el historial previo.
INSERT INTO "payroll_parameters" ("id","key","value","description","effectiveDate")
VALUES
  ('frl_2025_12_obrero',   'FRL_OBRERO_RATE_BP',   '10', 'FRL obrero 0,10% (desde 12/2025)',   '2025-12-01T00:00:00.000Z'),
  ('frl_2025_12_patronal', 'FRL_PATRONAL_RATE_BP', '10', 'FRL patronal 0,10% (desde 12/2025)', '2025-12-01T00:00:00.000Z')
ON CONFLICT ("id") DO UPDATE SET "value" = EXCLUDED."value", "description" = EXCLUDED."description";
