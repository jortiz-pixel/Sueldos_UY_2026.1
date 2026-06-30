-- BPC oficial (BPS): 2025 = $6.576, 2026 = $6.864 (vigente desde 01/01/2026).
-- El valor que estaba cargado para 2025 ($7.622) era incorrecto. Afecta el
-- umbral de 2,5 BPC del FONASA y las escalas de IRPF.
INSERT INTO "payroll_parameters" ("id","key","value","description","effectiveDate")
VALUES
  ('seed_2025_BPC', 'BPC', '6576', 'BPC 2025 (oficial $6.576)', '2025-01-01T00:00:00.000Z'),
  ('seed_2026_BPC', 'BPC', '6864', 'BPC 2026 (oficial $6.864)', '2026-01-01T00:00:00.000Z')
ON CONFLICT ("id") DO UPDATE
  SET "value" = EXCLUDED."value",
      "description" = EXCLUDED."description",
      "effectiveDate" = EXCLUDED."effectiveDate";
