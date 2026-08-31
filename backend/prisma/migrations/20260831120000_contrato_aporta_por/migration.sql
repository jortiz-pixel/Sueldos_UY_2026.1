-- Contrato: "Aporta Por" del titular / socio SIN REMUNERACIÓN (pantalla GNS).
-- NULL/'SUELDO' = empleado normal · 'MAXIMO_SUELDO' = aporta por el mayor sueldo
-- de los dependientes · 'FICTO' = aporta por el ficto de su categoría.
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "aportaPor" TEXT;
