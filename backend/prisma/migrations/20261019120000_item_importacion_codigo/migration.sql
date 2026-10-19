-- Código original del artículo (vínculo con la factura del proveedor).
ALTER TABLE "importacion_items" ADD COLUMN IF NOT EXISTS "codigo" TEXT;
