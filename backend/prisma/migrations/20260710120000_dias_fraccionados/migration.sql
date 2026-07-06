-- Permitir días FRACCIONADOS (p. ej. 8,33) en el salario vacacional / licencia y
-- en el saldo de vacaciones. Se cambian las columnas de días de entero a doble
-- precisión. La conversión de datos existentes es directa (n → n.0).
ALTER TABLE "liquidations"     ALTER COLUMN "diasTrabajados" TYPE double precision;
ALTER TABLE "liquidations"     ALTER COLUMN "diasHabiles"    TYPE double precision;
ALTER TABLE "vacation_accrual" ALTER COLUMN "diasCorresponden" TYPE double precision;
ALTER TABLE "vacation_accrual" ALTER COLUMN "diasTomados"      TYPE double precision;
ALTER TABLE "vacation_accrual" ALTER COLUMN "diasPendientes"   TYPE double precision;
