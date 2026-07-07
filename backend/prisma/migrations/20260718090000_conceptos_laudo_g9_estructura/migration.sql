-- Los conceptos del laudo Grupo 9 creados antes de esta versión quedaron con
-- la estructura vieja (el camino rápido de ensureConceptosConstruccion no la
-- refrescaba): el Fondo Social y el Fondo de Vivienda sin la base
-- FONDO_CONSTRUCCION (tomaban los haberes gravados), la lluvia sin HORA_PAGADA,
-- las medias horas sin MEDIA_HORA y nombres/orden anteriores. Sincroniza la
-- estructura con la espec. vigente SIN tocar valorRate/valorFijo (que el
-- operador puede haber ajustado). Idempotente.

UPDATE "concepts" SET "nombre" = 'Horas de espera por Lluvia', "orden" = 60, "tipoCalculo" = 'CANTIDAD_VALOR', "baseCalculo" = 'HORA_PAGADA', "activo" = true
WHERE "codigo" = 'HORAS_LLUVIA' AND "companyId" IS NOT NULL;

UPDATE "concepts" SET "nombre" = 'Incentivo Presentismo', "orden" = 61, "tipoCalculo" = 'PORCENTAJE', "baseCalculo" = 'HORAS_LAUDO', "activo" = true
WHERE "codigo" = 'PRESENTISMO_OBRA' AND "companyId" IS NOT NULL;

UPDATE "concepts" SET "nombre" = 'Presentismo por Trabajo Completo en el Mes', "orden" = 62, "tipoCalculo" = 'PORCENTAJE', "baseCalculo" = 'HORAS_LAUDO', "activo" = true
WHERE "codigo" = 'PRES_MES_COMPLETO' AND "companyId" IS NOT NULL;

UPDATE "concepts" SET "nombre" = 'Ticket Alimentación Gravado', "orden" = 63, "tipoCalculo" = 'CANTIDAD_VALOR', "baseCalculo" = NULL, "activo" = true
WHERE "codigo" = 'TICKET_ALIMENTACION' AND "companyId" IS NOT NULL;

UPDATE "concepts" SET "nombre" = 'Desgaste De Ropa', "orden" = 65, "tipoCalculo" = 'CANTIDAD_VALOR', "baseCalculo" = NULL, "activo" = true
WHERE "codigo" = 'DESGASTE_ROPA' AND "companyId" IS NOT NULL;

UPDATE "concepts" SET "nombre" = 'Gastos De Transporte', "orden" = 66, "tipoCalculo" = 'CANTIDAD_VALOR', "baseCalculo" = NULL, "activo" = true
WHERE "codigo" = 'GASTOS_TRANSPORTE' AND "companyId" IS NOT NULL;

UPDATE "concepts" SET "nombre" = 'Desgaste De Herramientas', "orden" = 67, "tipoCalculo" = 'CANTIDAD_VALOR', "baseCalculo" = NULL, "activo" = true
WHERE "codigo" = 'DESGASTE_HERRAMIENTAS' AND "companyId" IS NOT NULL;

UPDATE "concepts" SET "nombre" = 'Medias Horas', "orden" = 68, "tipoCalculo" = 'CANTIDAD_VALOR', "baseCalculo" = 'MEDIA_HORA', "activo" = true
WHERE "codigo" = 'MEDIAS_HORAS' AND "companyId" IS NOT NULL;

UPDATE "concepts" SET "nombre" = 'Fondo Social', "orden" = 220, "tipoCalculo" = 'PORCENTAJE_CIENMIL', "baseCalculo" = 'FONDO_CONSTRUCCION', "activo" = true
WHERE "codigo" = 'FONDO_SOCIAL' AND "companyId" IS NOT NULL;

UPDATE "concepts" SET "nombre" = 'Fondo de Vivienda', "orden" = 221, "tipoCalculo" = 'PORCENTAJE_CIENMIL', "baseCalculo" = 'FONDO_CONSTRUCCION', "activo" = true
WHERE "codigo" = 'FONDO_VIVIENDA' AND "companyId" IS NOT NULL;
