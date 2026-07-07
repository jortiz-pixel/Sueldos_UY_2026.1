-- Jornales del Acta de Ajuste CS Grupo 9 Subgrupo 01 (22/4/2025, MTSS):
-- valores hora vigentes desde el 1/4/2025 (convenio hasta 31/07/2026).
-- Reemplaza los valores precargados provisorios (que además tenían el Oficial
-- Albañil "incluidos" con el valor pagado por Lambrechts, no el laudo).
DELETE FROM "jornales_construccion" WHERE "id" IN ('jc_2026_incl_oficial_alba', 'jc_2026_incl_medio_alba');

INSERT INTO "jornales_construccion" ("id", "categoria", "recuadro", "valorHora", "effectiveDate") VALUES
  -- NO INCLUIDOS en la ley 14.411 (empresas grupo 9 con aportación Industria y Comercio)
  ('jc25_ni_ii',    'II — Sereno',                 'NO_INCLUIDOS', 25178, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_iii',   'III — Peón común o Canchero', 'NO_INCLUIDOS', 26732, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_iv',    'IV — Peón práctico',          'NO_INCLUIDOS', 29106, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_v1',    'V — Guinchero',               'NO_INCLUIDOS', 31505, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_v2',    'V — ½ Oficial Albañil',       'NO_INCLUIDOS', 31505, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_v3',    'V — ½ Oficial Hierro',        'NO_INCLUIDOS', 31505, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_vi',    'VI — ½ Oficial Madera',       'NO_INCLUIDOS', 34099, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_vii',   'VII — Chofer de camión',      'NO_INCLUIDOS', 36730, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_viii1', 'VIII — Oficial Albañil',      'NO_INCLUIDOS', 42138, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_viii2', 'VIII — Oficial Hierro',       'NO_INCLUIDOS', 42138, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_ix1',   'IX — Oficial Madera',         'NO_INCLUIDOS', 44913, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_ix2',   'IX — Oficial Finalista',      'NO_INCLUIDOS', 44913, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_x',     'X — Oficial Escalerista',     'NO_INCLUIDOS', 47626, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_xi',    'XI — Oficial Maquinista',     'NO_INCLUIDOS', 47626, '2025-04-01T00:00:00.000Z'),
  ('jc25_ni_xii',   'XII — Mecánico',              'NO_INCLUIDOS', 50385, '2025-04-01T00:00:00.000Z'),
  -- INCLUIDOS en la ley 14.411 (aportación Construcción CT; BPS paga aguinaldo/licencia/vacacional)
  ('jc25_in_ii',    'II — Sereno',                 'INCLUIDOS', 20662, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_iii',   'III — Peón común o Canchero', 'INCLUIDOS', 21934, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_iv',    'IV — Peón práctico',          'INCLUIDOS', 23898, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_v1',    'V — Guinchero',               'INCLUIDOS', 25866, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_v2',    'V — ½ Oficial Albañil',       'INCLUIDOS', 25866, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_v3',    'V — ½ Oficial Hierro',        'INCLUIDOS', 25866, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_vi',    'VI — ½ Oficial Madera',       'INCLUIDOS', 27990, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_vii',   'VII — Chofer de camión',      'INCLUIDOS', 30160, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_viii1', 'VIII — Oficial Albañil',      'INCLUIDOS', 34597, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_viii2', 'VIII — Oficial Hierro',       'INCLUIDOS', 34597, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_ix1',   'IX — Oficial Madera',         'INCLUIDOS', 36870, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_ix2',   'IX — Oficial Finalista',      'INCLUIDOS', 36870, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_x',     'X — Oficial Escalerista',     'INCLUIDOS', 39105, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_xi',    'XI — Oficial Maquinista',     'INCLUIDOS', 39105, '2025-04-01T00:00:00.000Z'),
  ('jc25_in_xii',   'XII — Mecánico',              'INCLUIDOS', 41379, '2025-04-01T00:00:00.000Z')
ON CONFLICT ("categoria", "recuadro", "effectiveDate") DO UPDATE SET "valorHora" = EXCLUDED."valorHora";
