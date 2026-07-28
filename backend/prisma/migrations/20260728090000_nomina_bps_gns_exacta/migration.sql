-- Nómina BPS igual a GNS (validada contra archivo real N_0126_JOSE_5667352.bps
-- de una empresa de construcción grupo 9 con aportación Industria y Comercio):
--
-- 1) TIPOS DE CONTRIBUYENTE OFICIALES (Codificador BPS v37, Tabla 1
--    "Aportaciones y Tipo de Contribuyente"): el código va POR APORTACIÓN
--    (el mismo número significa cosas distintas en IC, CT, RU...). El catálogo
--    anterior tenía códigos inventados; faltaba p. ej. el 26 IC "Unipersonal
--    con hasta 5 dependientes con cobertura médica" que GNS declara en el
--    registro 4 del cabezal.
--
-- 2) Concepto BPS 5 ("Monto Imponible Adicional IRPF") para las partidas
--    exentas de aportes del laudo de la construcción: GNS las declara sumadas
--    bajo el concepto 5 (medias horas + ropa + transporte + herramientas =
--    457,68 en el archivo real). Se configura vía "codBps" del concepto.

-- ── 1. Catálogo oficial de tipos de contribuyente ─────────────────
ALTER TABLE "tipos_contribuyente" ADD COLUMN IF NOT EXISTS "tipoAporte" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tipos_contribuyente" DROP CONSTRAINT IF EXISTS "tipos_contribuyente_pkey";
DELETE FROM "tipos_contribuyente";
ALTER TABLE "tipos_contribuyente" ADD CONSTRAINT "tipos_contribuyente_pkey" PRIMARY KEY ("tipoAporte", "codigo");

INSERT INTO "tipos_contribuyente" ("tipoAporte", "codigo", "nombre") VALUES
  -- Aportación 1 — IC (Industria y Comercio)
  (1, 1,  'Propietario individual o Empresa Unipersonal'),
  (1, 2,  'Sociedad de Responsabilidad Limitada'),
  (1, 3,  'Sociedad Anónima'),
  (1, 4,  'Sociedad de Hecho'),
  (1, 5,  'Sociedad Colectiva'),
  (1, 6,  'Sociedad en Comandita'),
  (1, 7,  'Sociedad de Capital e Industria'),
  (1, 8,  'Sociedad Civil'),
  (1, 9,  'Asociación'),
  (1, 10, 'Cooperativa de Consumo'),
  (1, 11, 'Cooperativa de Ahorro y Crédito no incluidas en Caja Bancaria'),
  (1, 12, 'Cooperativa de Producción'),
  (1, 13, 'Sucursal Empresa Extranjera'),
  (1, 14, 'Sociedad de Fomento Rural'),
  (1, 15, 'Cooperativa Agropecuaria'),
  (1, 16, 'Organismo Paraestatal'),
  (1, 17, 'Sucesión con dependientes'),
  (1, 18, 'Organizaciones Sociales sin Personería Jurídica'),
  (1, 19, 'Cooperativa de Vivienda y Ayuda Mutua'),
  (1, 20, 'Fundaciones, Corporaciones'),
  (1, 21, 'Edificio en Propiedad Horizontal, Consorcio'),
  (1, 22, 'Turf con hasta 5 dependientes con cobertura de salud por esta empresa'),
  (1, 23, 'Mutualista'),
  (1, 24, 'Sociedad Accidental'),
  (1, 25, 'Seguros Convencionales'),
  (1, 26, 'Unipersonal con hasta 5 dependientes con cobertura médica'),
  (1, 27, 'Casas Bancarias y otras empresas incluidas en Caja Bancaria'),
  (1, 30, 'Empresa extranjera'),
  (1, 31, 'Unipersonal con hasta 5 dependientes sin cobertura médica'),
  (1, 32, 'Monotributo unipersonal con más de un dependiente'),
  (1, 33, 'Unipersonal con un dependiente, monotributo, sin cuota mutual'),
  (1, 34, 'Unipersonal con un dependiente, monotributo, con cuota mutual (titular y cónyuge)'),
  (1, 35, 'Unipersonal con un dependiente, monotributo, con cuota mutual (titular o cónyuge)'),
  (1, 36, 'Cooperativas incluidas en Caja Bancaria'),
  (1, 37, 'Grupo de Interés Económico'),
  (1, 40, 'Cooperativa Social'),
  (1, 41, 'Unipersonal sin dependientes, sin cuota mutual'),
  (1, 42, 'Empresa Constructora Unipersonal sin personal administrativo, con hasta 5 dependientes en obra'),
  (1, 43, 'Unipersonal sin dependientes, monotributo, sin cuota mutual'),
  (1, 44, 'Unipersonal sin dependientes, monotributo, con cuota mutual (titular y cónyuge)'),
  (1, 45, 'Unipersonal sin dependientes, monotributo, con cuota mutual (titular o cónyuge)'),
  (1, 46, 'Unipersonal sin dependientes e integrante con actividad de una sociedad'),
  (1, 47, 'Fideicomiso'),
  (1, 50, 'Sucesión sin dependientes'),
  (1, 51, 'Vendedor de Diarios'),
  (1, 52, 'Turf sin dependientes con cobertura de salud'),
  (1, 53, 'Personal de Stud + 8%'),
  (1, 54, 'Turf con más de 5 dependientes'),
  (1, 55, 'Personal de Embajadas'),
  (1, 56, 'Chofer con automóvil'),
  (1, 57, 'Unipersonal Monotributo Mides'),
  (1, 58, 'Sociedad de Hecho Monotributo Mides'),
  (1, 59, 'Unipersonal Plan Dignidad Laboral PPL'),
  (1, 60, 'Sociedad de Hecho Plan Dignidad Laboral PPL'),
  (1, 67, 'Organismo Público, BPS subsidio – Apoyo inserción laboral'),
  (1, 70, 'Sucesión sin dependientes, con exoneración y/o servicios bonificados'),
  (1, 71, 'Unipersonal sin dependientes, con cobertura médica, con exoneración o servicios bonificados'),
  (1, 72, 'Sociedad con contrato sin dependientes, con exoneración, servicios bonificados o aporte por remuneración real'),
  (1, 73, 'Unipersonal sin dependientes, sin cobertura médica, con exoneración o servicios bonificados'),
  (1, 74, 'Sociedad de Hecho sin dependientes con exoneración y/o servicios bonificados'),
  (1, 81, 'Unipersonal con cónyuge colaborador sin dependientes'),
  (1, 83, 'Turf con hasta 5 dependientes con cobertura de salud por otra empresa'),
  (1, 84, 'Sociedad Accionista Simplificada con dependientes'),
  (1, 85, 'Sociedad Accionista Simplificada sin dependientes'),
  (1, 86, 'Turf sin dependientes con cobertura de salud por otra empresa'),
  (1, 87, 'Programa oportunidad laboral – Ley 19.952'),
  (1, 91, 'Empresa Unipersonal sin dependientes con cuota mutual'),
  (1, 92, 'Sociedad de Responsabilidad Limitada (sin dependientes)'),
  (1, 94, 'Sociedad de Hecho (sin dependientes)'),
  (1, 95, 'Sociedad Colectiva (sin dependientes)'),
  (1, 96, 'Sociedad en Comandita (sin dependientes)'),
  (1, 97, 'Sociedad de Capital e Industria (sin dependientes)'),
  (1, 98, 'Sociedad Civil (sin dependientes)'),
  (1, 99, 'Personal de organismo internacional sin FRL e IRP'),
  -- Aportación 2 — CI (Civil)
  (2, 61, 'Organismo Público con tasa aporte patronal jubilatorio 7,5%'),
  (2, 62, 'Organismo Público con tasa aporte patronal jubilatorio 19,5%'),
  (2, 63, 'Organismo Público con tasa aporte patronal jubilatorio 19,5%'),
  (2, 64, 'Organismo Público con tasa aporte patronal jubilatorio 16,5%'),
  (2, 66, 'Organismo Público (Ley 5143) aporte patronal jubilatorio 19,5% e IRP patronal 1%'),
  (2, 67, 'Organismo Público BPS Aporte subsidio y Licencia y Aguinaldo Construcción y Trabajo a Domicilio'),
  (2, 68, 'Organismo Público BPS – Subsidio Transitorio por Incapacidad Parcial'),
  (2, 69, 'Organismo Público – Bancos (BROU, BHU y BSE)'),
  (2, 75, 'Organismo Público – IMM Aporte Patronal Jubilatorio Ley 18083 art. 89'),
  (2, 76, 'Organismo Público con tasa de aporte patronal jubilatorio 19,5% y aporte al SNIS'),
  (2, 77, 'Organismo Público con tasa aporte patronal jubilatorio 19,5% Juntas Departamentales'),
  -- Aportación 3 — RU (Rural)
  (3, 1,  'Empresa Rural'),
  (3, 2,  'Empresa Contratista Rural'),
  (3, 3,  'Empresa Rural S.A.'),
  (3, 4,  'Rural Usuario de Servicios'),
  (3, 6,  'Sucesión Empresa Rural'),
  (3, 7,  'Sucesión Empresa Contratista'),
  (3, 8,  'Empresa Contratista Rural S.A.'),
  (3, 9,  'Empresa sin padrón rural asociado, con dependientes'),
  (3, 10, 'Empresa Rural sin dependientes'),
  (3, 11, 'Empresa Contratista Rural sin dependientes'),
  (3, 12, 'Empresa Rural S.A. sin dependientes'),
  (3, 13, 'Sucesión Empresa Rural sin dependientes'),
  (3, 14, 'Sucesión Empresa Contratista sin dependientes'),
  (3, 15, 'Empresa Contratista Rural S.A. sin dependientes'),
  (3, 16, 'Empresa sin padrón rural asociado, sin dependientes'),
  (3, 39, 'IRPF'),
  (3, 86, 'Empresa Rural SAS sin dependientes'),
  (3, 87, 'Empresa Contratista Rural SAS sin dependientes'),
  -- Aportación 4 — CT (Construcción)
  (4, 1,  'Administración total (titular)'),
  (4, 2,  'Obra por Contrato'),
  (4, 10, 'Regularización por Administración (titular)'),
  (4, 17, 'Obra de Menor Cuantía'),
  (4, 20, 'Parte de Administración de Subcontratista (titular)'),
  (4, 22, 'Parte de IR (contratista)'),
  (4, 23, 'Art. 7 e IR (contratista)'),
  (4, 31, 'Contrato total privado (titular)'),
  (4, 38, 'IRPF Empresa Contratista de construcción'),
  (4, 39, 'IRPF excepto contratistas de construcción'),
  (4, 50, 'Contrato total público por avance certificado'),
  (4, 51, 'Contrato sobre real planillas'),
  (4, 55, 'Administración Delegada'),
  (4, 60, 'Contribuyente sin obra (uso exclusivo interno de BPS)'),
  -- Aportaciones 5 Notarial · 6 Bancaria · 11 Servicios Personales
  (5, 78, 'Instituto de Previsión Social/Aseguradora – Pasivos'),
  (5, 79, 'Organismo o empresa que tributa aportes solo al SNIS'),
  (6, 78, 'Instituto de Previsión Social/Aseguradora – Pasivos'),
  (6, 79, 'Organismo o empresa que tributa aportes solo al SNIS'),
  (11, 78, 'Instituto de Previsión Social/Aseguradora – Pasivos'),
  (11, 79, 'Organismo o empresa que tributa aportes solo al SNIS'),
  (11, 80, 'Servicios Personales Profesionales y No Profesionales aporte mínimo CPE')
ON CONFLICT ("tipoAporte", "codigo") DO UPDATE SET "nombre" = EXCLUDED."nombre";

-- ── 2. Partidas exentas del laudo G9 → concepto BPS 5 ─────────────
-- GNS declara la suma de medias horas + ropa + transporte + herramientas bajo
-- el concepto 5 "Monto Imponible Adicional IRPF" (gravadas IRPF, no CESS).
UPDATE "concepts" SET "codBps" = 5
WHERE "codigo" IN ('MEDIAS_HORAS', 'DESGASTE_ROPA', 'GASTOS_TRANSPORTE', 'DESGASTE_HERRAMIENTAS')
  AND "companyId" IS NOT NULL;
