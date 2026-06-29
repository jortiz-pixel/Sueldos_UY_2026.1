# Continuidad del proyecto — AsysTax / Sueldos UY

> **Para retomar en una sesión nueva:** leé este archivo y `docs/ARQUITECTURA.md`. Resumen del estado, decisiones, reglas de cálculo validadas y pendientes. El código completo está en la rama `claude/uruguayan-payroll-system-EojHu`.

---

## 0. Cómo retomar

1. El asistente NO tiene acceso al servidor. Trabaja así: edita código → `git push` a la rama → el usuario despliega.
2. El asistente **no puede compilar/instalar localmente** (la red del entorno bloquea `npm install`). El TypeScript se valida recién en el build de Docker del usuario. ⇒ revisar el código con cuidado antes de pushear.
3. **Despliegue manual** (no hay auto-deploy; ver §2). El usuario corre por SSH/Termius:
   ```
   cd /root/Sueldos_UY_2026.1 && git pull origin claude/uruguayan-payroll-system-EojHu && docker compose up -d --build
   ```
   Y si hubo cambios de base de datos (migración nueva):
   ```
   docker compose exec backend npm run prisma:migrate
   ```
4. Branch de trabajo: **`claude/uruguayan-payroll-system-EojHu`** (nunca pushear a otra sin permiso).
5. Repo (GitHub MCP restringido a): `jortiz-pixel/sueldos_uy_2026.1`. Servidor: VPS Hostinger `187.77.6.69`, app en `/root/Sueldos_UY_2026.1`, frontend en `:8080`, backend `:3000`.

---

## 1. Stack y modelo

- **Backend:** Node + Express + TypeScript + Prisma + PostgreSQL. Aritmética en **centésimos (BigInt)** — serializar a string en JSON.
- **Frontend:** React + Vite + Tailwind + react-hook-form + @tanstack/react-query (v5, usa `isPending`) + axios.
- **Docker compose:** postgres, backend, frontend (nginx). Volúmenes: `postgres_data`, `uploads_data` (adjuntos).
- **Modelo plataforma:** `Persona` global (Employee, CI único) + `Contrato` (vínculo persona↔empresa) + `Membership`/`Entitlement` (F1) + `Attachment` (F5) + Motor de Conceptos (`Concepto`).
- **Multi-tenant:** acceso por `Membership` (middleware `assertCompanyAccess`/`requireMembership` en `src/middleware/tenancy.ts`). `User.role==ADMIN` = superadmin de plataforma.

---

## 2. Entorno y despliegue (gotchas)

- **Auto-deploy DESACTIVADO.** Hay un GitHub Action (`.github/workflows/deploy.yml`) pero el **firewall del VPS bloquea el SSH entrante de GitHub** (puerto 22, `i/o timeout`). Se dejó solo `workflow_dispatch`. Para reactivarlo habría que abrir SSH a internet (baja la seguridad) → se decidió NO hacerlo. **Deploy manual por Termius.**
- nginx ya tiene `client_max_body_size 10m` (para subir archivos).
- axios: en uploads `FormData`, el interceptor quita el `Content-Type` para que el navegador ponga el boundary.

### Dominio y HTTPS (Traefik)
- DNS: `sueldos.gro.com.uy` → registro **A** a `187.77.6.69`, creado en **Wix** (el dominio gro.com.uy está delegado a `ns8/ns9.wixdns.net`; DominiosUY es solo el registrador). Ya resuelve OK.
- El VPS ya corre un **Traefik** gestionado por Hostinger (contenedor `traefik-jihh-traefik-1`, red `host`, provider docker, entrypoints `web`:80 / `websecure`:443, redirección http→https, certresolver **`letsencrypt`** ACME httpChallenge).
- Para publicar la app en el dominio se agregaron **labels** al servicio `frontend` en `docker-compose.yml` (router `sueldos`, Host `sueldos.gro.com.uy`, entrypoint websecure, certresolver letsencrypt, loadbalancer port 80). Traefik saca el cert solo. El `/api` sigue resolviéndose dentro del contenedor frontend (nginx → backend:3000), así que no hay tema CORS.
- Aplicar: `git pull && docker compose up -d` (recrea el frontend con las labels). Verificar: `https://sueldos.gro.com.uy`.

---

## 3. Estado del producto (qué está hecho)

### Plataforma (cimientos)
- **F1** ✅ Backbone multi-empresa: `Membership` + `Entitlement`, switch de control de acceso a membresías, pantalla **Accesos** (compartir empresa, roles), **selector global de empresa** en la cabecera.
- **F5** ✅ Adjuntos + `StorageService` (volumen local): foto de persona (retrato arriba-derecha en Editar Persona), documentos (cédula/libreta/carné de salud con vencimiento). Componentes `PersonPhoto`, `AttachmentsPanel`.
- **F6** ✅ Panel + Calendario: agenda "Próximos eventos 45 días" (cumpleaños, vencimientos de carné/libreta, altas/bajas). `calendar.service.ts`.
- **F3** ✅ Importación de **personas** desde Excel/CSV (auto-mapeo de columnas, validación dry-run, plantilla descargable). `import.service.ts`, página **Importar**.

### Liquidación de sueldos (núcleo — foco actual)
- ✅ **Confirmar / Desconfirmar** liquidación (botón ↺; bloqueado si período CERRADO).
- ✅ **Recibo PDF** se ve/descarga (se bajaba con token; antes daba 401). Helper `frontend/src/utils/file.ts`.
- ✅ **Liquidaciones especiales** accesibles desde la UI (botón "Especial" → Aguinaldo / Licencia / Egreso). El listado del período muestra **todos los tipos** (antes filtraba solo MENSUAL → invisibles).
- ✅ **Aguinaldo corregido** (ver §4).
- ✅ **Licencia + Salario vacacional corregidos** (ver §4).
- ✅ **Conceptos del sistema** visibles (tabla de solo lectura en pantalla Conceptos).
- ✅ **Agregar/quitar conceptos manuales** (suman/restan) a una liquidación en BORRADOR, con recálculo del líquido. Endpoints `POST/DELETE /api/liquidation/:id/item` (concepto marcado como `AJUSTE`).

---

## 4. Reglas de cálculo VALIDADAS (fuente: "Manual profesional de liquidación de sueldos en Uruguay" provisto por el usuario + GNS)

### Aguinaldo (`aguinaldo.service.ts`) ✅
- **Semestre LEGAL:** el de **junio** cubre **Dic(año-1)–May**; el de **diciembre** cubre **Jun–Nov**.
- Base = **suma de los haberes (`totalHaberes`) de las liquidaciones MENSUALES CONFIRMADAS del semestre ÷ 12**. (NO estima por nominal.)
- Si no hay mensuales confirmadas en el semestre → aborta con mensaje (no inventa).
- Validado: 1 mes confirmado de $45.000 → aguinaldo bruto $3.750. 6 meses → $22.500.

### Licencia + Salario vacacional (`vacation.service.ts` → `calcularLiquidacionLicencia`) ✅
- **Base de licencia** = **promedio mensual de los haberes reales de los últimos 12 meses trabajados** (12 últimas liquidaciones MENSUALES confirmadas). Sin historial → nominal del contrato.
- **Importe de licencia** (GRAVADO) = `base / 30 × días tomados`. Aportes BPS/FONASA/FRL + IRPF **solo sobre la licencia**.
- **Salario vacacional** = **100% del jornal LÍQUIDO** = `importe licencia − aportes personales`. **EXENTO de aportes (CESS)**.
- Validado contra el manual: sueldo $70.000, 9,37 días → licencia **$21.863,33**, vacacional **$17.578,12** (= licencia × (1 − 19,6%); 19,6% = 15% jub + 4,5% FONASA + 0,1% FRL).

### Pendiente de revisar con el mismo criterio
- **Egreso / liquidación final** (`calcularLiquidacionFinal` en `vacation.service.ts`): todavía usa lógica vieja para licencia no gozada / vacacional / preaviso. Aplicar el mismo criterio (promedio 12m, vacacional líquido exento). El manual da el ejemplo (despido, líneas del caso 70.000, 4a7m → 5 meses indemnización).

### Regla general del manual (clave)
- Para **licencia, aguinaldo y egresos**, los rubros salariales **variables** (horas extra, comisiones, etc.) integran la base **mediante promedios** — no el nominal pelado. (Confirmado por el usuario y el manual.)

---

## 5. Parámetros 2026 del manual (PENDIENTE de cargar — corrige IRPF/FONASA/BPS/FRL)

El sistema hoy tiene BPC 2024/2025 y **FRL 0,125% (tasa vieja)**. El manual da los valores vigentes 2026:

- **BPC 2026 = $6.864** · BFC = $1.847,96 · 2,5 BPC = $17.160.
- **Aportes dependiente:** Jubilatorio 15% · FONASA básico 3% (personal) · **FRL 0,10% personal + 0,10% patronal** (desde 2019) · FONASA patronal 5% · FGCL 0,025% patronal · Jubilatorio patronal 7,5%.
- **FONASA escalonado:** hasta 2,5 BPC → 3% (o 5% con cónyuge a cargo). Sobre 2,5 BPC → 4,5% (sin cargas), 6% (con hijos), 6,5% (cónyuge sin hijos), 8% (hijos + cónyuge). Para la franja 2,5 BPC se consideran las remuneraciones gravadas del mes, **excluido el aguinaldo**.
- **Topes Ley 16.713:** A $96.279 · B $144.418 · C $288.836.
- **Escala IRPF mensual 2026** (BPC $6.864): 0% hasta $48.048 · 10% hasta $68.640 · 15% hasta $102.960 · 24% hasta $205.920 · 25% hasta $343.200 · 27% hasta $514.800 · 31% hasta $789.360 · 36% en adelante. Tasa deducciones: 14% si ingresos ≤ 15 BPC ($102.960), 8% si superan. Deducción por hijo: $11.440 (menor) / $22.880 (discapacidad) mensual.
- **Aguinaldo (Decreto 113/026):** medio generado hasta 31/5 se paga en junio; el de 1/6 a 30/11 hasta el 20/12.

> Parámetros se cargan en pantalla **Parámetros** / tablas `PayrollParameter` + `IrpfBracket`, o vía seed. Revisar `parameters.service.ts` y el seed.

---

## 6. Conceptos del manual GNS aún por modelar (concepto por concepto, con ejemplo numérico)

Catálogo (ver doc fuente del usuario "Formulas_CONCEPTOS_LIQUIDACION_DE_SUELDOS"). Pendientes de implementar/ajustar:
- **Haberes:** horas comunes/nocturnas/extra (diurnas +100%, nocturno +20%), feriado pago, faltas (descuento), **prima por antigüedad** (escala, mín. 3 años, tope 10), **presentismo** (10,42% / 5%), medias horas.
- **Construcción** (si aplica el sector): ticket alimentación, desgaste de ropa (0,05), transporte (0,043745), desgaste de herramientas (0,02). ⚠️ Definir con el usuario si el foco es **construcción** o **régimen general** (la mitad del doc GNS es construcción).
- **Descuentos:** aporte jubilatorio con **tope** considerando acumulado del mes + aguinaldo aparte; FONASA + adicional; IRPF (ajuste diciembre); fondo de vivienda (0,025%); fondo social (0,5809%).

**Método acordado:** ir **de a uno**, el usuario da la regla en palabras + un ejemplo numérico, se implementa y se valida el número. (Así se hizo con aguinaldo y licencia.)

---

## 7. Pendientes inmediatos / próximos pasos

1. **(En curso) Cambios de DISPOSICIÓN/UI** que el usuario quiere hacer en la ficha de liquidación (lo iba a detallar). — *próximo tema al retomar.*
2. **Egreso / liquidación final** con el criterio validado (§4).
3. **Parámetros 2026** (§5) — corrige FRL, IRPF, FONASA, BPC de una.
4. Resto de **conceptos del manual** (§6), de a uno.
5. (Diferido) Cimientos de plataforma F2 (registro de módulos + datos maestros Tercero/Producto) y F4 (motor data-driven / internacionalización). Ver `docs/ARQUITECTURA.md`.

---

## 8. Decisiones clave tomadas

- Foco actual: **que la liquidación de sueldos calcule bien** (el usuario lo priorizó sobre la infra de plataforma).
- Aguinaldo: semestre **legal** + **solo confirmadas** + base real (no estimar).
- Licencia: base = **promedio 12 meses trabajados**; salario vacacional = **líquido, exento**.
- Validar **número por número** cada cálculo y, cuando se pueda, fijarlo con test (tests aún no montados; `jest` está configurado pero requiere DB).
- Conceptos manuales suman/restan directo al líquido (no regeneran aportes) — variante "gravada" pendiente si se necesita.
- Modelo `claude-opus-4-8` NO debe aparecer en commits/PR/código (solo en chat).

---

## 9. Conceptos: comunes vs propios (implementado)

- `Concepto.companyId` ahora es **nullable**: `null` = **común** (visible/aplicable en todas las empresas), con valor = **propio** (solo esa empresa). Migración `20260629220000_conceptos_comunes` (DROP NOT NULL + columna `ocultoEn TEXT[]` + índice único parcial de código entre comunes). **Requiere** `docker compose exec backend npm run prisma:migrate` al deployar.
- **Permisos:** crear/editar/borrar **común** → solo ADMIN de plataforma; **propio** → ADMIN u OPERATOR con acceso a la empresa (`assertConceptoScope`).
- **Ocultar por empresa:** `ocultoEn` lista companyIds que ocultaron un concepto; endpoint `POST /api/concepts/:id/visibilidad {companyId, oculto}`. El motor de liquidación (`liquidation.service.ts`) ahora trae comunes+propios y excluye `ocultoEn`.
- **Copiar/duplicar:** la pantalla Conceptos permite duplicar cualquier concepto (precarga el form como propio de la empresa activa) y "usar como plantilla" los del sistema. Pantalla dividida en 3 secciones: Comunes / Propios / Del sistema.
- Auth: bug de login en prod era **CORS** (faltaba el dominio en `ALLOWED_ORIGINS`); fijado en `docker-compose.yml` (env `ALLOWED_ORIGINS`, override por `.env`). CLI `npm run user` (prisma/admin-user.ts) para listar/resetear/crear admin. Branding GRO via `components/GroLogo.tsx` (SVG) en login y sidebar.

---

## 10. Login con Google (implementado)

- Flujo **ID token** (Google Identity Services), NO authorization code → **no requiere Client Secret**. Solo el **Client ID** (público): `452392392541-o8r6toecbd4s09iccfaiaehtfvt9oq6l.apps.googleusercontent.com`.
- Backend: `POST /api/auth/google {credential}` verifica el ID token con `google-auth-library` (audience = `GOOGLE_CLIENT_ID`). Si el email existe → emite sesión; si no existe → alta automática **solo** si el dominio está en `GOOGLE_ALLOWED_DOMAINS` (vacío por defecto = solo usuarios ya dados de alta). Usuarios Google quedan con passwordHash aleatorio (sin migración).
- Config en `docker-compose.yml` (backend env): `GOOGLE_CLIENT_ID` (default puesto) y `GOOGLE_ALLOWED_DOMAINS` (vacío). Para habilitar auto-alta de gro: `GOOGLE_ALLOWED_DOMAINS=gro.com.uy` en `.env`.
- Frontend: botón oficial en `LoginPage` (carga `accounts.google.com/gsi/client`), `useAuth.loginWithGoogle`, `authApi.google`. Client ID en `constants/google.ts` (override `VITE_GOOGLE_CLIENT_ID`).
- **Requisito Google Cloud:** Authorized JS origin `https://sueldos.gro.com.uy`. GIS solo funciona sobre HTTPS (el dominio), no sobre `http://IP:8080`.
- Dep nueva: `google-auth-library` en backend → el rebuild corre `npm install`, no hace falta tocar lock.

---

*Última actualización: sesión con acceso arreglado (CORS + CLI usuarios), logo GRO, conceptos comunes/propios + copiar + ocultar, y login con Google (ID token, sin secret). Pendiente: bug de membership al crear empresas (§ pendientes), egreso/final y parámetros 2026.*
