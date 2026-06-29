---
description: Revisa el diff actual con foco en correctitud fiscal y precisión financiera (centésimos, redondeo DGI, parámetros versionados, multi-tenant).
---

Hacé una revisión del cambio pendiente (`git diff` y archivos sin commitear)
centrada en el dominio de liquidación de sueldos uruguayo. Alcance: $ARGUMENTS
(si está vacío, revisá todo el diff actual).

Checklist de revisión (reportá hallazgos con archivo:línea):

1. **Precisión monetaria**: ¿toda la aritmética monetaria usa centésimos/BigInt
   y los helpers de `utils/money.ts`? Marcá cualquier uso de `number`/float o
   `Math.round` sobre montos. El redondeo fiscal debe ser `divRoundHalfUp`
   (ROUND_HALF_UP), no redondeo por defecto.
2. **Parámetros versionados**: ¿hay tasas, BPC, topes o tramos hardcodeados que
   deberían venir de `payroll_parameters` con fecha de vigencia? ¿La liquidación
   guarda snapshot de los parámetros usados?
3. **Lógica fiscal**: contrastá contra la metodología del README/CLAUDE.md
   (IRPF proyección anual y tramos en BPC; deducciones por cargas; aportes
   obrero/patronal; aguinaldo; licencia; liquidación final). Señalá desviaciones.
4. **Multi-tenant**: ¿todo filtra por `companyId`? ¿Puede filtrarse data entre
   empresas? ¿Respeta roles ADMIN/OPERATOR/VIEWER?
5. **Validación y errores**: entradas validadas con Zod; errores de validación
   devuelven 422 (no 500).
6. **Tests**: ¿el cambio de lógica viene con tests nuevos/actualizados en
   `backend/tests/`? Si no, indicá qué casos faltan (tramos límite, cargas,
   redondeo).

Entregá: lista priorizada (crítico / importante / menor) con la corrección
sugerida. No modifiques código salvo que el usuario lo pida explícitamente.
