-- Laudo Grupo 9 Subgrupo 01 — 11a ronda, vigencia 01-04-2026 (acta 14/08/2026).
-- Jornales (valor HORA, centésimos) por categoría y recuadro + valores FIJOS
-- por jornal de las partidas del laudo. Idempotente.

INSERT INTO "jornales_construccion" ("id","categoria","recuadro","valorHora","effectiveDate","createdAt") VALUES
  (md5(random()::text||clock_timestamp()::text||'1'), 'II — Sereno', 'INCLUIDOS', 21730, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'2'), 'II — Sereno', 'NO_INCLUIDOS', 26480, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'3'), 'III — Peón común o Canchero', 'INCLUIDOS', 23068, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'4'), 'III — Peón común o Canchero', 'NO_INCLUIDOS', 28114, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'5'), 'IV — Peón práctico', 'INCLUIDOS', 25134, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'6'), 'IV — Peón práctico', 'NO_INCLUIDOS', 30611, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'7'), 'V — Guinchero', 'INCLUIDOS', 27203, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'8'), 'V — Guinchero', 'NO_INCLUIDOS', 33134, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'9'), 'V — ½ Oficial Albañil', 'INCLUIDOS', 27203, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'10'), 'V — ½ Oficial Albañil', 'NO_INCLUIDOS', 33134, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'11'), 'V — ½ Oficial Hierro', 'INCLUIDOS', 27203, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'12'), 'V — ½ Oficial Hierro', 'NO_INCLUIDOS', 33134, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'13'), 'VI — ½ Oficial Madera', 'INCLUIDOS', 29437, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'14'), 'VI — ½ Oficial Madera', 'NO_INCLUIDOS', 35862, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'15'), 'VII — Chofer de camión', 'INCLUIDOS', 31719, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'16'), 'VII — Chofer de camión', 'NO_INCLUIDOS', 38629, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'17'), 'VIII — Oficial Albañil', 'INCLUIDOS', 36386, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'18'), 'VIII — Oficial Albañil', 'NO_INCLUIDOS', 44317, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'19'), 'VIII — Oficial Hierro', 'INCLUIDOS', 36386, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'20'), 'VIII — Oficial Hierro', 'NO_INCLUIDOS', 44317, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'21'), 'IX — Oficial Madera', 'INCLUIDOS', 38776, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'22'), 'IX — Oficial Madera', 'NO_INCLUIDOS', 47235, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'23'), 'IX — Oficial Finalista', 'INCLUIDOS', 38776, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'24'), 'IX — Oficial Finalista', 'NO_INCLUIDOS', 47235, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'25'), 'X — Oficial Escalerista', 'INCLUIDOS', 41127, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'26'), 'X — Oficial Escalerista', 'NO_INCLUIDOS', 50088, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'27'), 'XI — Oficial Maquinista', 'INCLUIDOS', 41127, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'28'), 'XI — Oficial Maquinista', 'NO_INCLUIDOS', 50088, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'29'), 'XII — Mecánico', 'INCLUIDOS', 43518, '2026-04-01', now()),
  (md5(random()::text||clock_timestamp()::text||'30'), 'XII — Mecánico', 'NO_INCLUIDOS', 52990, '2026-04-01', now())
ON CONFLICT ("categoria","recuadro","effectiveDate") DO UPDATE SET "valorHora" = EXCLUDED."valorHora";

-- Partidas del laudo como VALORES FIJOS por JORNAL (día), acta 2026:
UPDATE "concepts" SET "valorFijo" = 10879 WHERE "codigo" = 'DESGASTE_ROPA' AND "companyId" IS NOT NULL;
UPDATE "concepts" SET "valorFijo" = 9518  WHERE "codigo" = 'GASTOS_TRANSPORTE' AND "companyId" IS NOT NULL;
UPDATE "concepts" SET "valorFijo" = 4350  WHERE "codigo" = 'DESGASTE_HERRAMIENTAS' AND "companyId" IS NOT NULL;
UPDATE "concepts" SET "valorFijo" = 19368 WHERE "codigo" = 'TICKET_ALIMENTACION' AND "companyId" IS NOT NULL;
-- Hora laudo del presentismo (fallback): Oficial Albañil VIII NO INCLUIDOS = 443,17.
UPDATE "concepts" SET "valorFijo" = 44317 WHERE "codigo" IN ('PRESENTISMO_OBRA','PRES_MES_COMPLETO') AND "companyId" IS NOT NULL;
