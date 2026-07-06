# AsysTax. Sueldos — Sistema de liquidación de sueldos (Uruguay)

Producto de GRO Consultores & Asociados (jortiz@gro.com.uy). Multiempresa,
para operar la nómina de los clientes del estudio. Marca: **AsysTax. Sueldos**
(manual y tokens en `brand/`).

## Arquitectura

- **Backend**: Node + Express + TypeScript + Prisma + PostgreSQL (`backend/`).
  - Dinero SIEMPRE en **centésimos** con `BigInt`; se serializa a `string` en JSON.
  - Migraciones **SQL a mano** en `backend/prisma/migrations/<timestamp>_<nombre>/migration.sql`
    (idempotentes: `IF NOT EXISTS` / `ON CONFLICT`). Se aplican con `prisma migrate deploy`.
  - `tsconfig` backend permite unused locals; el del **frontend NO**.
- **Frontend**: React + Vite + Tailwind + react-hook-form + TanStack Query v5 (`frontend/`).
  - ⚠️ `noUnusedLocals`/`noUnusedParameters` activos: un import sin uso **rompe el build**.
  - ⚠️ QueryClient con `staleTime` global de 5 min: al mutar, invalidar TODAS las
    query keys afectadas (lista + ficha individual + checklist), si no "no se guarda".
  - Estética: tokens AsysTax en `tailwind.config.js` + `src/index.css`
    (navy `#0B1B3A`, primario `#1E5BFF`, `brand-*`, `ink-*`, `canvas`, `ok/warn/bad`).
    Tipos: Space Grotesk (marca/cifras, clase `figure` = tabular-nums) + Plus Jakarta Sans.
- **Deploy**: AUTOMÁTICO por systemd timer en el VPS (Hostinger). Se instala UNA
  vez: `sudo bash deploy/install-autodeploy.sh`. El timer corre
  `deploy/auto-deploy.sh` cada minuto: si hay commit nuevo en la rama hace
  fetch → reset → build → migrate → up (mantiene la versión anterior si el
  build o la migración fallan; lock anti-solapamiento; solo salida HTTPS a
  GitHub, sin abrir puertos). El asistente NO tiene acceso al servidor: entrega
  por push y el deploy se aplica solo en ~1 minuto. Deploy manual disponible
  como respaldo: `bash deploy/deploy.sh`. Indicador de versión (commit) en el
  pie del sidebar y `/api/version`. Ver deploys: `journalctl -u
  sueldos-deploy.service -f`. Desactivar: `systemctl disable --now
  sueldos-deploy.timer`. Si el build "all CACHED" sirve dist viejo →
  `docker compose build --no-cache`.

## Reglas de trabajo

- Desarrollar y pushear SOLO en la rama `claude/uruguayan-payroll-system-EojHu`.
- El asistente no puede compilar TS localmente: revisar tipos con cuidado
  (balance de llaves, imports usados, enums de Prisma).
- Español rioplatense en UI, comentarios y commits. No crear PRs salvo pedido.

## Dominio (reglas uruguayas implementadas)

- **BPC**: 2026 = $6.864 · 2025 = $6.576 (parámetros por fecha de vigencia).
- **FONASA obrero**: base 3% (≤2,5 BPC) / 4,5% (>2,5 BPC); +1,5% hijos a cargo;
  +2% cónyuge a cargo. Confirmado correcto por el usuario. Son DOS partidas
  SEPARADAS (conceptos distintos, cada una su ítem): `FONASA` = "Seguro por
  Enfermedad" 3% fijo sobre el total de haberes · `FONASA_ADICIONAL` =
  "Adicional FONASA", el complemento según el seguro de salud (escalón >2,5 BPC
  + hijos + cónyuge). Cada parte se redondea aparte (criterio GNS). El adicional
  solo se crea si es > 0. Reportes/Excel suman ambos como "FONASA total".
  Las cargas (hijos/cónyuge) del adicional se derivan del CÓDIGO DE SEGURO DE
  SALUD (Tabla 8) del contrato vigente del mes (`fonasaCargasDeSeguroSalud`):
  familias con 4 variantes hijos/cónyuge (1/15/16/17 y análogos). Si el código
  no lo determina, se usan los datos del empleado. Cambiar el seguro de salud
  del contrato (o crear un contrato nuevo desde una fecha) actualiza el % del
  adicional al regenerar la liquidación de ese mes. Vale para todas las empresas.
- **FONASA en meses con aguinaldo (junio/diciembre)**: el ADICIONAL del aguinaldo
  NO se descuenta en el aguinaldo (ahí va solo el 3%). Se traslada a la
  mensualidad del mes: su adicional se calcula sobre (nominal del mes +
  aguinaldo del semestre). Validado contra recibos GNS (Belén Martínez, junio 2026).
- **Aguinaldo**: bruto = suma del "Total de Haberes" (neto de faltas) de las
  mensuales del semestre / 12. Semestres: junio = Dic(año-1)–May · diciembre =
  Jun–Nov. Toma todas las mensuales GENERADAS del semestre (borrador o
  confirmada, excluye anulada), así suma los 6 importes aunque falte confirmar.
- **FRL**: 0,10% obrero y patronal (2026). Patronales: IVS 7,5%, FONASA 5%, BSE por empresa.
- **IRPF** (auditado contra Comunicado BPS R 5/2026): escala anual en BPC
  0-84:0 · 84-120:10 · 120-180:15 · 180-360:24 · 360-600:25 · 600-900:27 ·
  900-1380:31 · >1380:36. Método de CRÉDITO (art. 38): primario sobre el nominal;
  deducciones (aportes jub+FONASA+FRL + 20 BPC/hijo + 40 discapacidad, SIN
  cónyuge) valorizadas
  al 14% si nominal mensual ≤ 15 BPC, 8% si no.
- **Modelo persona/contrato**: persona global; CI única POR empresa (repetible entre
  empresas); legajo (`employeeNumber`) único por empresa. La liquidación es POR
  CONTRATO: contrato que SOLAPA el mes (altas/bajas a mitad de mes → días
  proporcionales, ficto 30). Baja = cierra contrato + causal BPS (Tabla 9) +
  liquidación final automática. En la FINAL (validada contra recibo GNS Agustín
  Araujo, Amigo Fiel, egreso 9/6 voluntario): licencia NO gozada y salario
  vacacional por egreso = días × jornal nominal (básico/30), EXENTOS; días =
  días_licencia_año × días_trabajados_año/360 − tomados (redondeo 2 decimales).
  Aguinaldo por egreso = 1/12 de los haberes de las mensuales del semestre EN
  CURSO hasta el egreso (el semestre ya cerrado se pagó en junio/diciembre, no
  se re-incluye) — es la ÚNICA partida gravada. Indemnización (IPD) SOLO por
  despido (causal 2); voluntario/término no llevan. PREAVISO NO APLICA en
  Uruguay: no existe esa partida en ninguna liquidación.
- **Contrato a prueba** = modalidad de 90 días rescindible sin IPD (no es un borrador).
- **FALTAS** (estilo GNS, recibo Belén Martínez): figuran del lado de los
  HABERES como un haber NEGATIVO (días × jornal). Así el "Total de Haberes" ya
  sale NETO de faltas y sobre ese neto se calculan TODOS los descuentos (aportes
  personales, patronales e IRPF). El importe siempre resta (se fuerza negativo).
  Detección por código `FALTAS`; pueden venir cargadas a mano ("otros
  descuentos") o desde el motor de conceptos. NO van en la columna de descuentos.
  Se puede cargar la CANTIDAD de faltas y el monto se calcula solo: valor de una
  falta (mensual = nominal/30, ficto 30; jornalero = jornal) × cantidad.
  Descripción estilo GNS `Faltas N x jornal`.
- **Licencias**: Ley 12.590 (20/25/30 días por antigüedad; proporcional 1er año);
  días sin domingos; anticipos permitidos con confirmación. Al liquidar (estilo
  GNS): la licencia GOZADA se paga en la MENSUALIDAD, desglosando el sueldo en
  'Jornal N x jornal' (días trabajados) + 'Licencia M x jornal' (días de
  licencia), con aportes sobre el total; los días de licencia se toman de las
  licencias del calendario si no se indican. Base = SUELDO BÁSICO del contrato
  (jornal nominal = básico/30), NO promedio de 12 meses. El SALARIO VACACIONAL
  va en una liquidación especial aparte (tipo LICENCIA): jornal LÍQUIDO ((básico
  − aportes personales)/30) × días, EXENTO (sin descuentos). El líquido de la
  licencia gozada (jornal nominal − descuentos) y el del salario vacacional
  (jornal líquido) coinciden por día. Admite días FRACCIONADOS (ej. 8,33): las
  columnas de días (liquidación y saldo de vacaciones) son Float.
- **Nómina BPS (ATYR v3.0)**: generador validado byte a byte contra archivo real
  de GNS (`N_0626_AMIG_8269951`). Registros 1/4/5/6/7/12; en nóminas el mes de
  cargo va NULO en 6/7 (en rectificativas va lleno y el reg. 4 sin mes).
  Conceptos Tabla 15: 1 imponible · 2 aguinaldo · 5 licencia no gozada · 41 salario
  vacacional; IPD/preaviso no se declaran. Rectificativas = diff contra la "foto"
  guardada al descargar (tabla `nomina_declaraciones`), conceptos 1X suma / 2X resta.
- **Codificador BPS v37** cargado como catálogos (tablas 1,2,3,8,9,10,12,15,22)
  con endpoints `/api/catalogs/*`. Recibos estilo GNS (dos copias por hoja).

## Mapa del sistema (menú)

Panel (acciones alta/baja, última declaración, acumulado) · Centro del mes
(ciclo guiado de 7 pasos) · Empresas (representante legal, compartir/ocultar/
eliminar) · Personas (checklist BPS) · Importar (Excel + nómina ATYR para migrar
clientes desde GNS) · Contratos (bloque Historia Laboral BPS, contrato PDF común
y a prueba) · Conceptos · Liquidaciones · Nómina BPS (N y R) · Calendario
(licencias + saldos + vencimientos) · Reportes (pagos del mes, costo de personal,
nómina, BPS, IRPF) · Accesos · Auditoría (solo ADMIN) · Parámetros.

## Seguridad (decisiones tomadas — no revertir)

- PostgreSQL NUNCA publica el 5432 (solo red interna de Docker). Backend 3000
  bindea a 127.0.0.1; frontend 8080 a `${FRONTEND_BIND:-127.0.0.1}` (Traefik
  llega por la red de Docker vía labels). Rollback de emergencia:
  `FRONTEND_BIND=0.0.0.0` en `.env` del servidor.
- Secretos SOLO en `.env` del servidor (no commiteado): `POSTGRES_PASSWORD`
  (parametrizada en compose; la histórica `sueldos_pass` quedó quemada en git
  → debe rotarse con `ALTER USER` en el contenedor), `JWT_SECRET`, etc.
- Backend: `trust proxy 1` (IP real detrás de Traefik/nginx), helmet, rate
  limit global 100/15min + `/api/auth` 20 intentos fallidos/15min,
  `x-powered-by` deshabilitado, errores 500 sin detalle en producción.
- Storage de adjuntos con protección de path traversal (`storage.service.ts`).
- Control de acceso a nivel de objeto (anti-IDOR): TODO endpoint que opera por
  `:id` debe validar la empresa del recurso antes de leer/mutar. Helpers:
  `assertLiquidationAccess` (liquidaciones), `assertPersonaAccess` (personas),
  `assertCompanyAccess` (empresa directa), `assertConceptoScope` (conceptos).
  Nunca confiar en que un ID es del propio tenant.
- Registro de auditoría (`audit_log`): `recordAudit()` en `audit.service.ts` es
  fire-and-forget tolerante (nunca lanza ni bloquea). Se registran login (ok/
  fallido), logout, cambio de contraseña, y acciones sensibles (crear/modificar/
  eliminar empresa, compartir/revocar accesos, alta/baja/reactivar/eliminar
  contratos, eliminar persona, eliminar/anular liquidación, cambio de parámetro).
  Lectura en `GET /api/audit` (solo ADMIN) → menú "Auditoría" (`/audit`).

## Pendientes conocidos (roadmap acordado)

1. Consolidado multi-empresa (fin de mes del estudio en una pantalla).
2. Email de recibos a empleados.
3. ~~Planilla de pagos al banco~~ HECHA (Reportes → "Pagos al banco": Excel
   genérico + TXT multipago BROU + CSV; datos bancarios en la ficha de la
   persona; si un banco exige layout exacto, pedir plantilla y replicar).
   También HECHO el asiento contable del mes (Reportes → "Asiento contable").
4. Multi-aportación por RUT (un RUT con varias aportaciones/números BPS) — hacer
   cuando aparezca el cliente que lo necesite.
5. Archivo D de BPS (deducciones) — completa la familia N/R/D.
6. Conexión licencia→liquidación (tomar días agendados automáticamente).
7. Revisión de la plantilla del contrato por abogado laboralista.
