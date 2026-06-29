# CLAUDE.md — Sueldos UY 2026

Guía para agentes que trabajan en este repositorio. Léela completa antes de
tocar código. Su objetivo es que puedas implementar, validar y commitear una
tarea de forma autónoma sin redescubrir las convenciones del proyecto.

## Qué es este proyecto

Sistema de liquidación de haberes conforme a la normativa laboral y tributaria
uruguaya (BPS, FONASA, FRL, IRPF Cat. II, aguinaldo, licencia, despido).
Multi-empresa (multi-tenant). Producción-ready.

- **Backend**: Node.js 20 + Express + TypeScript, Prisma 5, PostgreSQL 16.
- **Frontend**: React 18 + TypeScript + Vite + Tailwind, React Query, Axios.
- **Auth**: JWT (access + refresh), roles ADMIN / OPERATOR / VIEWER.

## Reglas de oro (no negociables)

1. **Aritmética monetaria SIEMPRE en centésimos con BigInt.** 1 peso = 100
   centésimos. Nunca uses `number`/float para lógica de negocio monetaria. Usá
   los helpers de `backend/src/utils/money.ts`: `toCtms`, `toPesos`,
   `applyRate` (tasas en basis points: 15% = 1500 bp), `divRoundHalfUp`.
2. **Redondeo DGI = ROUND_HALF_UP** en toda operación fiscal. No uses
   `Math.round` sobre montos; usá `divRoundHalfUp`.
3. **Parámetros tributarios NUNCA se hardcodean.** BPC, escala IRPF, tasas y
   topes viven en la tabla `payroll_parameters` con fecha de vigencia
   (versionado). Cada liquidación guarda un *snapshot* de los parámetros usados
   para poder re-ejecutar cálculos históricos. Si una tasa cambia, se agrega un
   parámetro nuevo con `effectiveDate`; no se edita el anterior.
4. **Validación con Zod.** Errores de validación devuelven **422** con mensaje
   claro (no 500). Mantené ese contrato.
5. **Multi-tenant**: casi todo se filtra por `companyId`. Los parámetros
   globales tienen `companyId = null` y pueden sobreescribirse por empresa.
   Nunca devuelvas datos de una empresa a un usuario de otra.
6. **Migraciones Prisma se versionan en git.** Cambios de esquema = nueva
   migración, nunca editar una migración ya aplicada.

## Comandos

Backend (`cd backend`):

```bash
npm install
npm run prisma:generate     # genera el client (tras tocar schema.prisma)
npm run prisma:migrate:dev  # crea/aplica migración en desarrollo
npm run prisma:seed         # datos demo (empresa + empleados)
npm run dev                 # servidor dev, puerto 3000
npm test                    # Jest, unitarios sin BD
npm test -- tests/irpf      # solo IRPF
npm run test:coverage
npm run build               # tsc -> dist/
```

Frontend (`cd frontend`):

```bash
npm install
npm run dev      # Vite, http://localhost:5173
npm run lint     # eslint ts/tsx
npm run build    # tsc && vite build
```

## Antes de commitear (definition of done)

1. `cd backend && npm test` pasa (si tocaste lógica de negocio, **agregá o
   actualizá tests** — especialmente IRPF/BPS).
2. `cd backend && npm run build` compila sin errores de TypeScript.
3. Si tocaste el frontend: `cd frontend && npm run lint && npm run build`.
4. Si cambiaste `schema.prisma`: hay una migración nueva y `prisma:generate`
   corrió.
5. Commit en español, formato `tipo(scope): descripción` siguiendo el historial
   (ej. `feat(F5): ...`, `fix: ...`, `docs: ...`).

## Estructura

```
backend/src/
  services/        ← lógica de negocio (core)
    irpf.service.ts        motor IRPF (proyección anual, tramos, deducciones)
    bps.service.ts         BPS jubilatorio / FONASA / FRL (obrero y patronal)
    liquidation.service.ts nómina mensual
    aguinaldo.service.ts   aguinaldo (Ley 10.449)
    vacation.service.ts    licencia, salario vacacional, liquidación final
    concept.engine.ts      motor de conceptos configurables
    contract.service.ts    contratos
    parameters.service.ts  parámetros versionados
    pdf.service.ts         recibos PDF (PDFKit)
    excel.service.ts       reportes Excel (SheetJS)
    storage.service.ts     adjuntos (foto + documentos)
  routes/          ← controladores REST (uno por recurso)
  middleware/      ← auth.ts (JWT + roles), errorHandler.ts
  utils/           ← money.ts, date.ts (antigüedad, días hábiles), logger.ts
  prisma/          ← schema.prisma, seed.ts, migrations/
frontend/src/
  pages/ components/ services/api.ts hooks/useAuth.tsx types/index.ts
docs/ARQUITECTURA.md   ← decisiones de arquitectura y estrategia de producto
```

## Detalles del dominio fiscal (referencia rápida)

- **IRPF Cat. II**: método de proyección anual (DGI Res. 662/007). Renta neta
  mensual × 12, restar deducciones por cargas (hijos: 13 BPC/año; con
  discapacidad: 26; cónyuge: 6), aplicar escala progresiva por tramos, dividir
  el impuesto anual entre 12 para la retención mensual. Todo en BPC.
- **Aportes obrero**: BPS jubilatorio 15%, FONASA 3% (+2% con familia), FRL
  0.125%.
- **Aportes patronal**: BPS IVS 7.5%, FONASA/DISSE 5%, FRL 0.025%, BSE
  configurable.
- La fuente de verdad de tasas y escalas es `payroll_parameters`, no este
  documento. Si hay discrepancia, gana la BD; corregí el dato en BD, no el
  código.

## Al implementar una tarea

1. Identificá el/los servicio(s) afectados en `backend/src/services/`.
2. Respetá las reglas de oro (centésimos, redondeo, parámetros versionados).
3. Escribí/actualizá tests en `backend/tests/`.
4. Corré la "definition of done" completa.
5. Commit descriptivo. No abras PR salvo que el usuario lo pida.
