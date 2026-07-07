-- Hora laudo del grado VIII (no incluidos): GNS usa jornal día / 8 redondeado
-- (3.371,14 / 8 = 421,39), no el valor hora impreso en el acta (421,38). Se
-- alinea al criterio GNS para que el presentismo salga idéntico al recibo
-- (10,42% de 3.371,12 = 351,27).
UPDATE "jornales_construccion" SET "valorHora" = 42139
WHERE "categoria" LIKE 'VIII%' AND "recuadro" = 'NO_INCLUIDOS' AND "effectiveDate" = '2025-04-01T00:00:00.000Z';
