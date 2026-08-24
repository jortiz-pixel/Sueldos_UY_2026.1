-- La agenda arranca en agosto 2026: se eliminan los vencimientos PENDIENTES
-- generados para meses anteriores (no deben quedar como pendientes/vencidos).
-- No toca los que ya tengan un estado cargado (procesada/con faltantes/etc).
DELETE FROM "tarea_vencimientos"
 WHERE "fecha" < '2026-08-01'
   AND "estado" = 'PENDIENTE';
