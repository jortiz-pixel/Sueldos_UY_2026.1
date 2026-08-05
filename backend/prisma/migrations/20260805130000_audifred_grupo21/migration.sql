-- AUDIFRED BUSIELLO WALTER ALFREDO (servicio doméstico): clasificar en el
-- Grupo de Actividad 21 (Consejo de Salarios — Servicio Doméstico), para que
-- la PRIMA POR ANTIGÜEDAD se calcule automáticamente en la mensualidad
-- (0,5% del sueldo básico por año completo desde la fecha de ingreso, tope 5%).
-- Idempotente; match tolerante a mayúsculas/espacios por el apellido distintivo.
UPDATE "companies"
SET "grupoActividadNum" = 21
WHERE upper("razonSocial") LIKE '%BUSIELLO%';
