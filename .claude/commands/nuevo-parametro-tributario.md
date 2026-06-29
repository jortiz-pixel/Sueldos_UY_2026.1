---
description: Agrega o actualiza un parámetro tributario versionado (BPC, tasa, escala IRPF) con su fecha de vigencia y tests.
---

Vas a registrar o actualizar un parámetro tributario en el sistema. Argumentos
del usuario: $ARGUMENTS (ej. "BPC 2026 = 6000 desde 2026-01-01", o "escala IRPF
2026").

Reglas (ver CLAUDE.md → Reglas de oro):

- Los parámetros NUNCA se hardcodean en código. Viven en la tabla
  `payroll_parameters` con `effectiveDate`. **No edites** el parámetro vigente:
  agregás uno nuevo con la nueva fecha de vigencia (versionado).
- Montos en centésimos (BigInt); tasas en basis points (15% = 1500 bp).
- Redondeo DGI = ROUND_HALF_UP.

Pasos:

1. Identificá el tipo de parámetro pedido y revisá cómo se modela hoy en
   `backend/src/services/parameters.service.ts` y en `schema.prisma`.
2. Si es un valor simple (ej. BPC): agregá el seed/registro con su
   `effectiveDate`. Si es la escala IRPF: usá la estructura de tramos
   (`fromBpc`, `toBpc`, `rate` en bp), validando que los tramos sean continuos y
   sin solapamiento.
3. Confirmá que `parameters.service.ts` resuelve el parámetro vigente por fecha
   correctamente para una liquidación de prueba.
4. Agregá/actualizá tests en `backend/tests/` que verifiquen que una liquidación
   con la nueva fecha usa el parámetro nuevo y una anterior usa el viejo.
5. Corré la definition of done (CLAUDE.md): `npm test`, `npm run build`.
6. Commit: `feat(params): <descripción>`.

Si falta información (valor, fecha de vigencia, empresa o global), preguntá
antes de escribir datos.
