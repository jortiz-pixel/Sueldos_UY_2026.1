-- Clasificación contable por artículo: MERCADERIA (inventario / bien de cambio) o
-- BIEN_DE_USO (activo fijo). El costeo es el mismo; cambia la cuenta de destino.
-- Idempotente.
ALTER TABLE "importacion_items"
  ADD COLUMN IF NOT EXISTS "clasificacion" TEXT NOT NULL DEFAULT 'MERCADERIA';

ALTER TABLE "importacion_factura_articulos"
  ADD COLUMN IF NOT EXISTS "clasificacion" TEXT NOT NULL DEFAULT 'MERCADERIA';
