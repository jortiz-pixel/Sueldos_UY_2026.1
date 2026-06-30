-- Pasa los conceptos CONFIGURABLES (no legales) de "del sistema" a conceptos
-- COMUNES editables (companyId NULL): así se pueden editar, ocultar y eliminar.
-- Se crean inactivos (activo=false): no se auto-aplican; quedan disponibles para
-- agregarlos a mano en las liquidaciones (igual que hasta ahora). El usuario
-- puede activarlos si quiere que se apliquen automáticamente.
INSERT INTO "concepts"
  ("id","codigo","nombre","orden","tipoOperacion","tipoCalculo","baseCalculo","valorRate","valorFijo","gravado","activo","createdAt","updatedAt")
VALUES
  ('seed_comun_PRIMA_ANT',   'PRIMA_ANT',   'Prima por antigüedad', 50,  'HABER',            'VALOR_FIJO',  NULL,            NULL, 0,    true,  false, now(), now()),
  ('seed_comun_PRESENTISMO', 'PRESENTISMO', 'Presentismo',          55,  'HABER',            'PORCENTAJE',  'SUELDO_BASICO', 1042, NULL, true,  false, now(), now()),
  ('seed_comun_FERIADO',     'FERIADO',     'Feriado pago',         60,  'HABER',            'VALOR_FIJO',  NULL,            NULL, 0,    true,  false, now(), now()),
  ('seed_comun_FALTAS',      'FALTAS',      'Faltas',               210, 'DESCUENTO_OBRERO', 'VALOR_FIJO',  NULL,            NULL, 0,    false, false, now(), now()),
  ('seed_comun_ADELANTO',    'ADELANTO',    'Adelanto de sueldo',   215, 'DESCUENTO_OBRERO', 'VALOR_FIJO',  NULL,            NULL, 0,    false, false, now(), now())
ON CONFLICT ("id") DO NOTHING;
