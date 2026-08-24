-- consultas@gro.com.uy debe tener acceso a AMBOS perfiles (Sueldos y Tareas):
-- eso requiere rol de staff. Se sube de VIEWER a OPERATOR (idempotente; no toca
-- la cuenta si ya es ADMIN u OPERATOR, ni si no existe).
UPDATE "users"
   SET "role" = 'OPERATOR'::"UserRole"
 WHERE lower("email") = 'consultas@gro.com.uy'
   AND "role" = 'VIEWER';
