-- MI CASA SOCIEDAD ANONIMA: grupo de actividad (Consejo de Salarios) = 10 y
-- subgrupo = 2, para que el recibo refleje "Grupo/Sub: 10/2".
-- Idempotente: un UPDATE fija el mismo valor si se corre otra vez. El match
-- tolera acentos (ANONIMA/ANÓNIMA), puntos (S.A.) y espacios.
UPDATE "companies"
SET "grupoActividadNum" = 10,
    "subgrupo" = '2'
WHERE upper(regexp_replace(trim("razonSocial"), '\s+', ' ', 'g')) LIKE 'MI CASA SOCIEDAD AN_NIMA'
   OR upper(regexp_replace(trim(replace("razonSocial", '.', '')), '\s+', ' ', 'g')) IN ('MI CASA SA', 'MI CASA S A');
