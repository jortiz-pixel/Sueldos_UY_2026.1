-- Titular de empresa unipersonal: categoría de aportación ficta del contrato
-- (1.ª a 10.ª = 11/15/20/25/30/36/42/48/54/60 BFC). El titular (vínculo
-- funcional 1) no se liquida como dependiente: aporta sobre el sueldo ficto de
-- su categoría — jubilatorio patronal unificado 22,5% + FRL 0,10% + cuota fija
-- FONASA/SNIS según seguro de salud (tabla BPS 2026).
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "fictoCategoria" INTEGER;
