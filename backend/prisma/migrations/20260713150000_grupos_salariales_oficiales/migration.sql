-- Grupos de los Consejos de Salarios (numeración oficial MTSS, 3ª ronda 2008):
-- corrige los nombres corridos (4 Textil, 5 Cuero/Vestimenta/Calzado, 7 Química,
-- 8 Metálicos, 9 Construcción, 15/16/18/19) y agrega Doméstico (21) y Rural (22-24).
INSERT INTO "grupos_actividad" ("numero", "nombre") VALUES
  (1, 'Procesamiento y conservación de alimentos, bebidas y tabaco'),
  (2, 'Industria frigorífica'),
  (3, 'Pesca'),
  (4, 'Industria Textil'),
  (5, 'Industrias del Cuero, Vestimenta y Calzado'),
  (6, 'Industria de la madera, celulosa y papel'),
  (7, 'Industria química, del medicamento, farmacéutica, de combustibles y anexos'),
  (8, 'Industria de productos metálicos, maquinarias y equipo'),
  (9, 'Industria de la construcción y actividades complementarias'),
  (10, 'Comercio en general'),
  (11, 'Comercio minorista de la alimentación'),
  (12, 'Hoteles, restoranes y bares'),
  (13, 'Transporte y almacenamiento'),
  (14, 'Intermediación financiera, seguros y pensiones'),
  (15, 'Servicios de salud y anexos'),
  (16, 'Servicios de enseñanza'),
  (17, 'Industria gráfica'),
  (18, 'Servicios culturales, de esparcimiento y comunicaciones'),
  (19, 'Servicios profesionales, técnicos, especializados y aquellos no incluidos en otros grupos'),
  (20, 'Entidades gremiales, sociales y deportivas'),
  (21, 'Servicio doméstico'),
  (22, 'Ganadería, Agricultura y actividades conexas'),
  (23, 'Viñedos, fruticultura, horticultura, floricultura, criaderos de aves, suinos, apicultura y otras actividades no incluidas en el grupo 22'),
  (24, 'Forestación (incluido bosques, montes y turberas)')
ON CONFLICT ("numero") DO UPDATE SET "nombre" = EXCLUDED."nombre";
