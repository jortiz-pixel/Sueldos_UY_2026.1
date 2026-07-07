-- Tipo de contribuyente 1 — Empresa Unipersonal (faltaba en el catálogo).
INSERT INTO "tipos_contribuyente" ("codigo", "nombre")
VALUES (1, 'Empresa Unipersonal')
ON CONFLICT ("codigo") DO UPDATE SET "nombre" = EXCLUDED."nombre";
