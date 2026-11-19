-- TRÁNSITO / trading (re-exportación): valor de la venta de exportación para el
-- encuadre de IRAE (margen venta − compra; ficto Res. DGI 51/997 y régimen general).
-- En centésimos de la moneda de la operación. Idempotente.
ALTER TABLE "Importacion" ADD COLUMN IF NOT EXISTS "valorVentaExportacion" BIGINT NOT NULL DEFAULT 0;
