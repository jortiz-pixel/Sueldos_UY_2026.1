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
- **Deploy**: MANUAL por el usuario en su VPS (Hostinger):
  `bash /root/Sueldos_UY_2026.1/deploy/deploy.sh` (fetch → reset → build → migrate → up).
  El asistente NO tiene acceso al servidor: entrega por push y el usuario deploya.
  Indicador de versión (commit) en el pie del sidebar y `/api/version`.
  Si el build "0.8s all CACHED" sirve un dist viejo → `docker compose build --no-cache`.

## Reglas de trabajo

- Desarrollar y pushear SOLO en la rama `claude/uruguayan-payroll-system-EojHu`.
- El asistente no puede compilar TS localmente: revisar tipos con cuidado
  (balance de llaves, imports usados, enums de Prisma).
- Español rioplatense en UI, comentarios y commits. No crear PRs salvo pedido.

## Dominio (reglas uruguayas implementadas)

- **BPC**: 2026 = $6.864 · 2025 = $6.576 (parámetros por fecha de vigencia).
- **FONASA obrero**: base 3% (≤2,5 BPC) / 4,5% (>2,5 BPC); +1,5% hijos a cargo;
  +2% cónyuge a cargo. Confirmado correcto por el usuario.
- **FRL**: 0,10% obrero y patronal (2026). Patronales: IVS 7,5%, FONASA 5%, BSE por empresa.
- **IRPF** (auditado contra Comunicado BPS R 5/2026): escala anual en BPC
  0-84:0 · 84-120:10 · 120-180:15 · 180-360:24 · 360-600:25 · 600-900:27 ·
  900-1380:31 · >1380:36. Método de CRÉDITO (art. 38): primario sobre el nominal;
  deducciones (aportes + 20 BPC/hijo + 40 discapacidad, SIN cónyuge) valorizadas
  al 14% si nominal mensual ≤ 15 BPC, 8% si no.
- **Modelo persona/contrato**: persona global; CI única POR empresa (repetible entre
  empresas); legajo (`employeeNumber`) único por empresa. La liquidación es POR
  CONTRATO: contrato que SOLAPA el mes (altas/bajas a mitad de mes → días
  proporcionales, ficto 30). Baja = cierra contrato + causal BPS (Tabla 9) +
  liquidación final automática (aguinaldo/licencia/vacacional proporcionales; IPD).
- **Contrato a prueba** = modalidad de 90 días rescindible sin IPD (no es un borrador).
- **Licencias**: Ley 12.590 (20/25/30 días por antigüedad; proporcional 1er año);
  días sin domingos; anticipos permitidos con confirmación.
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
nómina, BPS, IRPF) · Accesos · Parámetros.

## Pendientes conocidos (roadmap acordado)

1. Consolidado multi-empresa (fin de mes del estudio en una pantalla).
2. Email de recibos a empleados.
3. Planilla de pagos al banco (y formatos BROU/Abitab).
4. Multi-aportación por RUT (un RUT con varias aportaciones/números BPS) — hacer
   cuando aparezca el cliente que lo necesite.
5. Archivo D de BPS (deducciones) — completa la familia N/R/D.
6. Conexión licencia→liquidación (tomar días agendados automáticamente).
7. Revisión de la plantilla del contrato por abogado laboralista.
