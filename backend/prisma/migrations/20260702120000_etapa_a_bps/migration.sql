-- Etapa A: datos requeridos por la declaración nominada de BPS.

-- Catálogos: Tabla 12 (cómputos especiales) y Tabla 15 (conceptos de remuneración)
CREATE TABLE IF NOT EXISTS "computos_especiales" (
    "codigo" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    CONSTRAINT "computos_especiales_pkey" PRIMARY KEY ("codigo")
);
CREATE TABLE IF NOT EXISTS "conceptos_bps" (
    "codigo" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    CONSTRAINT "conceptos_bps_pkey" PRIMARY KEY ("codigo")
);

-- Persona: nombres desdoblados (registro 5 de la nominada exige apellido1,
-- apellido2, nombre1, nombre2), nacionalidad (Tabla 6) y tipo de documento.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "nombre2" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "apellido2" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "nacionalidad" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "tipoDocumento" TEXT NOT NULL DEFAULT 'DO';

-- Backfill: si nombre/apellido tienen exactamente dos palabras, separarlas.
-- No se separan apellidos compuestos con partícula (DE, DEL, DA, ...).
UPDATE "employees" SET
  "nombre2" = split_part("nombre", ' ', 2),
  "nombre"  = split_part("nombre", ' ', 1)
WHERE "nombre2" IS NULL
  AND array_length(string_to_array(trim("nombre"), ' '), 1) = 2;

UPDATE "employees" SET
  "apellido2" = split_part("apellido", ' ', 2),
  "apellido"  = split_part("apellido", ' ', 1)
WHERE "apellido2" IS NULL
  AND array_length(string_to_array(trim("apellido"), ' '), 1) = 2
  AND upper(split_part("apellido", ' ', 1)) NOT IN
      ('DE','DEL','DA','DO','DOS','DAS','LA','LAS','LOS','SAN','SANTA','DI','VAN','VON','MC','MAC');

-- Contrato: bloque "Historia Laboral BPS" (como la pestaña Otros Datos de GNS).
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "vinculoFuncional" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "seguroSalud" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "computosEspeciales" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "exoneracionAporte" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "acumulacionLaboral" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "horasSemanales" INTEGER;

-- Backfill con los valores típicos (los mismos defaults que muestra GNS):
-- vínculo 12 = Empleado · cómputos 99 = sin tratamiento diferencial ·
-- exoneración 9 = no tiene · acumulación 1 = primera actividad.
UPDATE "contracts" SET "vinculoFuncional" = 12 WHERE "vinculoFuncional" IS NULL;
UPDATE "contracts" SET "computosEspeciales" = 99 WHERE "computosEspeciales" IS NULL;
UPDATE "contracts" SET "exoneracionAporte" = 9 WHERE "exoneracionAporte" IS NULL;
UPDATE "contracts" SET "acumulacionLaboral" = 1 WHERE "acumulacionLaboral" IS NULL;

-- Seguro de salud (Tabla 8) derivado de la situación FONASA de la persona:
-- 1 con hijos sin cónyuge · 15 sin hijos sin cónyuge · 16 con hijos con cónyuge ·
-- 17 sin hijos con cónyuge.
UPDATE "contracts" c SET "seguroSalud" = CASE
    WHEN e."hijosACargo" > 0 AND e."conyugeACargo" THEN 16
    WHEN e."hijosACargo" > 0 THEN 1
    WHEN e."conyugeACargo" THEN 17
    ELSE 15
  END
FROM "employees" e
WHERE c."employeeId" = e."id" AND c."seguroSalud" IS NULL;

-- Concepto de liquidación → código BPS (Tabla 15) para el registro 7 de la
-- nominada. La columna codBps ya existe; se completa el default para los
-- haberes gravados que no lo tengan (1 = Monto imponible mensual).
UPDATE "concepts" SET "codBps" = 1
WHERE "codBps" IS NULL AND "gravado" = true AND "tipoOperacion" = 'HABER';

-- Gestoría (registro 12 de la nominada): datos del estudio contable.
CREATE TABLE IF NOT EXISTS "gestoria_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "telefono" TEXT,
    "fax" TEXT,
    "contacto" TEXT,
    "email" TEXT,
    CONSTRAINT "gestoria_config_pkey" PRIMARY KEY ("id")
);
INSERT INTO "gestoria_config" ("id", "nombre", "direccion", "telefono", "contacto", "email")
VALUES ('default', 'gro consultores', 'Benito Blanco 780', '097382581', 'GROconsultores', 'consultas@gro.com.uy')
ON CONFLICT ("id") DO NOTHING;

-- computos_especiales (63 códigos)
INSERT INTO "computos_especiales" ("codigo", "nombre") VALUES
  (1, 'Radiaciones ionizantes - Bonificación 3x2 (Decreto 502/84 de 12/11/84) (ver también códigos 50 y 51)'),
  (2, 'Exposición permanente al dióxido de silicio. (Decreto 502/84 de 12/11/84)'),
  (3, 'Temperaturas de 20º bajo cero. (Decreto 502/84 de 12/11/84)'),
  (4, 'Pilotos y copilotos que realicen actividad profesional remunerada, en aeronaves al servicio de empresas nacionales (Decreto 502/84 de 12/11/84)'),
  (5, 'Telefonistas larga distancia, operador telefónico nac. y operador gral de ANTEL (Dec.502/84 de 12/11/84)'),
  (6, 'Industrias que procesan asbesto. (Decreto 11/92 de 14/1/92)'),
  (7, 'Personal de Refinería de la Planta ANCAP, técnicos y personal de manten. y lab. (Dec.699/91 de 23/12/91)'),
  (9, 'Técnicos profesionales de Casinos Municipales de Montevideo. (Decreto 270/93 de 14/6/93)'),
  (10, 'Func. del Serv. de Enfermedades Infectocontagiosas "Dr. José Scosería" (Dec. 520/93 del 24/11/93)'),
  (11, 'Controladores de tránsito aéreo. (Decreto 558/93 de 8/12/93).'),
  (12, 'Unidad de vigilancia y protección de ANCAP. (Ley 13793 de 24/11/69)'),
  (13, 'Personal contratado por Misiones Diplomáticas y Oficinas Consulares de la República en el exterior (incluye Cancilleres). (Ley 15.851 art.75).'),
  (14, 'Empleado permanente del Jockey Club Montevideo'),
  (15, 'Empleado por reunión del Jockey Club Montevideo'),
  (16, 'Cuerpo de baile del S.O.D.R.E. (Ley 16.462 art. 93) *** Vigencia hasta 30/09/2015'),
  (20, 'Docente Enseñanza Primaria (Dec.502/84 de 12/11/84)'),
  (21, 'Doc. Enseñanza Secundaria y profesores civiles de los Liceos Militares (Decreto 502/84 de 12/11/84).'),
  (22, 'Docente de Educación Técnico Profesional. (Decreto 502/84 de 12/11/84).'),
  (23, 'Docente de Educación Física. (Decreto 502/84 de 12/11/84).'),
  (24, 'Docente de Instituto de Formación Docente. (Decreto 502/84 de 12/11/84)'),
  (25, 'Doc. Universitario y profesores civiles de las Esc. Militares y la Esc. Nac. de Policía (Dec.502/84 de 12/11/84)'),
  (26, 'Docente de Enseñanza Primaria a Sordomudos, Ciegos, Deficitarios Mentales, Irregulares de Carácter y Anormales Psíquicos. (Decreto 502/84 de 12/11/84)'),
  (27, 'Docentes de Discapacitados del Consejo de Educación Técnico Profesional. (Dec.813/88 de 16/11/88)'),
  (28, 'Docentes Escuela de Danza del M.E.C. (Ley 15851 de 24/12/86 Art. 100)'),
  (29, 'Docente Escuela Opera del M.E.C. (Ley 15851 de 24/12/86 Art.100)'),
  (30, 'Docente del Centro de Capacitación y Producción del M.E.C. (Ley 15851 de 24/12/86 Art. 100)'),
  (31, 'Docente Escuela Municipal de Arte Dramático. (Ley 15851 de 24/12/86 Art. 100)'),
  (32, 'Docente Escuela Municipal de Música. (Ley 15851 de 24/12/86 Art. 100)'),
  (33, 'Docente con título o certificado en Casas de la Cultura. (Ley 15851 de 24/12/86 Art. 100)'),
  (34, 'Docente con título o certificado en Biblioteca Estatal. (Ley 15851 de 24/12/86 Art. 100)'),
  (35, 'Docente con título o certificado en Biblioteca Municipal. (Ley 15851 de 24/12/86 Art. 100)'),
  (37, 'Personal doc.de escuelas rurales que desempeñen func. y se domicilien en la esc. Rural (Dec.563/94 22/12/94)'),
  (38, 'Personal de salas de máqs de serv. de dragados y marítima de Adm.Nac.de Puertos (Dec.40/95 - 24/1/95)'),
  (39, 'Serv. desempeñados por func. turnantes de la Dirección de Alcoholes -ANCAP (Dec.59/95 de 8/2/95)'),
  (40, 'Docente civil del Instituto de Adiestramiento Aeronáutico (Decreto 502/84 del 12/11/84)'),
  (41, 'Empleados administrativos - Planilla 18 – Sub escalafón Fiscalización y Vigilancia de Sala y Recaudación de Sala de Juegos (excluidos boleteros) de los Casinos Municipales de Montevideo (Dec. 351/96 - 04/09/96)'),
  (42, 'Docente con título habilitante en institución no habilitada (se incluyen guarderías, jardines de infantes y docentes en Instituciones Autorizadas, según Decreto que así lo determine)'),
  (43, 'Técnicos electricistas y en electrónica de la Dirección General de Infraestructura Aeronáutica'),
  (44, 'Trabajadores de centros asistencia Psiq. del MSP, Colonias Etchepare y S.Rossi y Hospital Vilardebo (4x3) Dec.356/05 del 03/10/05'),
  (45, 'Choferes y choferes Cobradores del Transporte Colectivo de pasajeros (CUTCSA) sin aporte asociado. Art.39 Ley 16713'),
  (46, 'Trab.de la Central Térmica José Batlle y Ordoñez tengan o no la calidad de funcionarios de UTE'),
  (47, 'Trabajadores de la pesca embarcados Categoría 6 (3x2) Decreto 159/2010'),
  (48, 'Funcionarios del Sub escalafón ejecutivo art.18 inc. 1ero. y art. 56 de la Ley 18.405'),
  (49, 'Funcionarios en transición según lo dispuesto en el art. 38 lit. c) Ley 18.405 (5x4)'),
  (50, 'Radiaciones ionizantes - Bonificación 4x3 (Decreto301/97 Vig.07/1997.)'),
  (51, 'Radiaciones ionizantes-Bonificación 9x8 (Dec.285/98 del 14/10/98)'),
  (52, 'Trabajadores de la pesca embarcados, Categoría 1 a 5 (4x3). Decreto 159/2010'),
  (53, 'Médico Radiólogo – Solo Aportación Policial (2x1)'),
  (54, 'Licencia sin goce de sueldo – Solo aportación Policial'),
  (55, 'Suspensión de actividad – Solo aportación Policial'),
  (56, 'No bonificable. A los efectos de la compatibilidad de pasividad servida por I y C, con actividad remunerada docente - Ley 18.721'),
  (57, 'Compatibilidad Dietas con Pasividad Civil (Ley 15809 del 1/1/1986 art. 136)'),
  (58, 'Radiaciones Ionizantes Ancap – Bonificación 4x3 – Decreto 217/12 del 29/06/2012'),
  (59, 'Docente Escuela Nacional de Administración Pública e INAU CENFORES (Ley 19.149 Art.62y Ley 19355 Art.583) No bonificable Vigencia 01/01/2016'),
  (60, 'Artistas registrados Leyes 18.384 y 19.154 No bonificable. (Vig. 01/12/2013)'),
  (61, 'No bonificable. A los efectos de la compatibilidad de jubilación servida por Ind. y C. con actividad en la ANII (art.'),
  (62, 'Trabajadores de la pesca embarcados Categoría 1 a 5 (5X4) Dec. 105/026 Vig. 29/05/2026 hasta 1/11/2026'),
  (63, 'Radiaciones ionizantes. Instrumentista quirúrgico en cirugía con arco en C en MUCAM. Bonificación 4x3 - Decreto 423/021 del 17/12/2021'),
  (64, 'Trabajadores del departamento de medicina forense del Poder Judicial (7x6) decreto 202/025'),
  (67, 'Trabajadores de la pesca embarcados Categoría 6 (4X3) Dec. 105/026 Vig. 29/05/2026 hasta 1/11/2026'),
  (68, 'Período no computable para trabajador no dependiente Art. 222 Ley 20.130'),
  (99, 'No cumple servicios objeto de un tratamiento diferencial'),
  (187, 'Ley 19438). Vigencia 01/01/2017')
ON CONFLICT ("codigo") DO UPDATE SET "nombre" = EXCLUDED."nombre";

-- conceptos_bps (43 códigos)
INSERT INTO "conceptos_bps" ("codigo", "nombre") VALUES
  (1, 'Monto imponible mensual'),
  (2, 'Aguinaldo'),
  (3, 'Complemento por laudo/pago de haberes posteriores al cese'),
  (5, 'Monto Imponible Adicional IRPF'),
  (6, 'Retroactividad Monto Imponible Adicional IRPF'),
  (7, 'Partidas con aporte patronal jubilatorio gradual'),
  (8, 'Partidas exclusivas de Contribuciones Especiales de Seguridad Social'),
  (9, 'Complemento por laudo de partidas con aporte patronal jubilatorio gradual'),
  (11, 'Rectificación que suma monto imponible mensual'),
  (12, 'Rectificación que suma aguinaldo'),
  (13, 'Rectificación que suma complemento por laudo'),
  (15, 'Rectificación que suma Monto Imponible Adicional IRPF'),
  (16, 'Rectificación que suma retroactividad Monto Imponible Adicional IRPF'),
  (17, 'Suma partida gravada con aporte patronal gradual'),
  (18, 'Rectificación que suma partidas exclusivas de Contribuciones Especiales de Seguridad Social'),
  (19, 'Suma complemento por laudo de partidas con aporte patronal gradual'),
  (21, 'Rectificación que resta monto imponible mensual'),
  (22, 'Rectificación que resta aguinaldo'),
  (23, 'Rectificación que resta complemento por laudo'),
  (25, 'Rectificación que resta Monto Imponible Adicional IRPF'),
  (26, 'Rectificación que resta retroactividad Monto Imponible Adicional IRPF'),
  (27, 'Resta partida gravada con aporte patronal gradual'),
  (28, 'Rectificación que resta partidas exclusivas de Contribuciones Especiales de Seguridad Social'),
  (29, 'Resta complemento por laudo de partidas con aporte patronal gradual'),
  (41, 'Salario Vacacional Obligatorio'),
  (42, 'Retroactividad Aguinaldo'),
  (43, 'Retroactividad Salario Vacacional'),
  (44, 'Monto imponible subsidio por enfermedad civil'),
  (45, 'Retroactividad del subsidio por enfermedad civil'),
  (46, 'Ahorro voluntario individual - Ley 20130'),
  (60, 'Profesionales y/o Técnicos de la Actividad Rural.'),
  (141, 'Rectificación que suma Salario Vacacional Obligatorio'),
  (142, 'Rectificación que suma retroactividad Aguinaldo'),
  (143, 'Rectificación que suma retroactividad Salario Vacacional'),
  (144, 'Rectificación que suma al subsidio por enfermedad civil'),
  (145, 'Rectificación que suma retroactividad al subsidio por enfermedad civil'),
  (146, 'Rectificación que suma ahorro voluntario individual - Ley 20130'),
  (241, 'Rectificación que resta Salario Vacacional Obligatorio'),
  (242, 'Rectificación que resta retroactividad Aguinaldo'),
  (243, 'Rectificación que resta retroactividad Salario Vacacional Obligatorio'),
  (244, 'Rectificación que resta subsidio por enfermedad civil'),
  (245, 'Rectificación que resta retroactividad subsidio por enfermedad civil'),
  (246, 'Rectificación que resta ahorro voluntario individual - Ley 20130')
ON CONFLICT ("codigo") DO UPDATE SET "nombre" = EXCLUDED."nombre";
