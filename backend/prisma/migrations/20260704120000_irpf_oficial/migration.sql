-- Auditoría IRPF (Comunicado BPS R 5/2026 y escala vigente de DGI, Título 7).
--
-- Correcciones:
--  1. La escala tenía los tramos corridos a partir del 4º:
--       mal:  180-600 @24 · 600-900 @25 · 900-1380 @27 · 1380-2100 @31 · >2100 @36
--       bien: 180-360 @24 · 360-600 @25 · 600-900 @27 · 900-1380 @31 · >1380 @36
--     (escala mensual oficial: 7/10/15/30/50/75/115 BPC × 12)
--  2. Deducción por hijo: 20 BPC/año (era 13) · con discapacidad: 40 (era 26).
--  3. No existe deducción por cónyuge en IRPF (era 6 BPC) → 0.
--  4. Tasa de valoración de deducciones: 14% si el nominal mensual ≤ 15 BPC,
--     8% si lo supera (el motor pasa a usar el método de crédito oficial).

-- 1) Escala correcta (en BPC anuales), única y vigente desde 2024.
DELETE FROM "irpf_brackets";
INSERT INTO "irpf_brackets" ("id", "fromBpc", "toBpc", "rate", "effectiveDate") VALUES
  ('irpf24_t1', 0,    84,   0,    '2024-01-01'),
  ('irpf24_t2', 84,   120,  1000, '2024-01-01'),
  ('irpf24_t3', 120,  180,  1500, '2024-01-01'),
  ('irpf24_t4', 180,  360,  2400, '2024-01-01'),
  ('irpf24_t5', 360,  600,  2500, '2024-01-01'),
  ('irpf24_t6', 600,  900,  2700, '2024-01-01'),
  ('irpf24_t7', 900,  1380, 3100, '2024-01-01'),
  ('irpf24_t8', 1380, NULL, 3600, '2024-01-01');

-- 2) Deducciones por cargas de familia + tasa de valoración.
INSERT INTO "payroll_parameters" ("id", "key", "value", "description", "effectiveDate") VALUES
  ('irpf_hijos_2024',        'IRPF_HIJOS_BPC',                '20',   'Deducción anual por hijo a cargo (BPC)', '2024-01-01'),
  ('irpf_hijos_disc_2024',   'IRPF_HIJOS_DISCAPACITADOS_BPC', '40',   'Deducción anual por hijo con discapacidad (BPC)', '2024-01-01'),
  ('irpf_conyuge_2024',      'IRPF_CONYUGE_BPC',              '0',    'IRPF no tiene deducción por cónyuge', '2024-01-01'),
  ('irpf_ded_baja_2024',     'IRPF_TASA_DEDUCCION_BAJA_BP',   '1400', 'Tasa deducciones si nominal mensual <= 15 BPC (14%)', '2024-01-01'),
  ('irpf_ded_alta_2024',     'IRPF_TASA_DEDUCCION_ALTA_BP',   '800',  'Tasa deducciones si nominal mensual > 15 BPC (8%)', '2024-01-01'),
  ('irpf_ded_umbral_2024',   'IRPF_UMBRAL_DEDUCCION_BPC',     '180',  'Umbral anual (15 BPC/mes x 12) para la tasa de deducciones', '2024-01-01')
ON CONFLICT ("id") DO UPDATE SET "value" = EXCLUDED."value", "description" = EXCLUDED."description";
