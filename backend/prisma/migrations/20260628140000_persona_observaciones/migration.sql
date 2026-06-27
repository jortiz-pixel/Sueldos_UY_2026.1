-- Campo libre de observaciones en la persona (ficha)
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "observaciones" TEXT;
