# BACKLOG — Sueldos UY / AsysTax

Lista accionable de tareas para construcción autónoma. Derivada del plan por
fases de `docs/ARQUITECTURA.md §15`. El agente toma **la primera tarea no
bloqueada y no hecha**, la implementa entera (con tests), y la marca como hecha.

## Cómo se usa

- Estados: `[ ]` pendiente · `[~]` en progreso · `[x]` hecha · `[!]` bloqueada.
- **Una tarea = un PR.** No mezclar tareas en un mismo PR.
- Regla de oro: si una tarea depende de una **decisión estratégica** (marcadas
  con 🛑 abajo), el agente NO la inventa: **pausa y le pregunta al usuario**.
- Antes de empezar una tarea, verificá el estado real en el código (puede haber
  avanzado más que este archivo). Si ya está hecha, marcala `[x]` y seguí.
- Al terminar: actualizar este archivo en el mismo commit/PR de la tarea.

## ⚠️ Deuda técnica / bugs detectados

- [!] **Tests `irpf.test.ts` y `bps.test.ts` desactualizados (preexistente).**
      El interface `PayrollParameters` evolucionó a un modelo FONASA por tramos
      (`fonasaBasicRate` 3% si ingreso ≤ 2.5 BPC, `fonasaBasicHighRate` 4.5% si
      lo supera, + `fonasaHijosRate`/`fonasaConyugeRate`), pero las fixtures de
      estos tests no incluyen los campos nuevos (no compilan) y sus aserciones
      esperan el FONASA viejo (3% plano). 🛑 **Requiere decisión fiscal del
      usuario**: confirmar que el modelo por tramos (3%/4.5% + adicionales) es
      el correcto para UY antes de actualizar los valores esperados. El agente
      NO debe inventar los montos. Afecta: `tests/irpf.test.ts`,
      `tests/bps.test.ts`, `src/services/bps.service.ts`,
      `src/services/parameters.service.ts`.

## 🛑 Decisiones del usuario (NO las decide el agente)

Estas condicionan el orden de abajo. Si una tarea las necesita, preguntar:

- **D1 — Escala objetivo**: SaaS multi-cliente vs. interno. (Recomendado en doc:
  SaaS multi-cliente.) Condiciona todo.
- **D3 — Segundo país** (AR/CL): necesario *antes* de F4 (motor data-driven).
- **D10 — Punta de entrada comercial**: decisión de negocio, no técnica.

---

## Fases

### F1 — Backbone: Membresía + Permisos + Entitlements  `[x]` (verificar)
Reemplaza `User.companyId`. Ya implementado (Membership, Entitlements, pantalla
Accesos, selector de empresa). **Tareas residuales:**
- [x] D9: propiedad del tenant transferible + regla de revocación de OWNER (otro
      ADMIN asume). Implementado como policy pura `membership.policy.ts`
      (`evaluateOwnerChange`) con traspaso automático al ADMIN activo más
      antiguo, cableada en `PATCH /memberships/:id` (transacción) + 9 tests.
- [ ] Middleware `requireMembership(companyId, permiso)` aplicado de forma
      consistente en TODAS las rutas company-scoped (auditar ruta por ruta).
- [ ] Cobertura de tests de aislamiento multi-tenant (un usuario de empresa A no
      ve datos de empresa B).

### F5 — Attachments + StorageService  `[x]` (verificar)
Ya implementado (backend + UI de adjuntos). **Tareas residuales:**
- [ ] URLs firmadas con expiración para archivos sensibles (nunca públicos).
- [ ] Campo `vencimiento` en adjuntos (carné de salud, libreta) que alimente el
      calendario (prepara F6).

### F2 — Registro de módulos + datos maestros + bus de eventos  `[ ]`
- [ ] Definir `ModuleManifest` (key, entidades, emite, consume, permisos,
      importadores, entitlement) y un registro donde los módulos se publican.
- [ ] Bus de eventos interno (in-process): publicar/suscribir eventos de dominio
      (ej. `liquidacion.confirmada`). Tests del bus.
- [ ] Emitir `liquidacion.confirmada` al confirmar una liquidación (sin
      consumidor todavía; prepara F10).
- [ ] Datos maestros compartidos: confirmar que `Persona` ya es global; diseñar
      `Tercero` (cliente/proveedor) y `Producto` como entidades del backbone
      (schema + migración aditiva, sin UI todavía).

### F3 — Framework de migración / importación (genérico Excel/CSV)  `[ ]`
- [ ] Modelo `MigrationJob` (estados CARGADO→MAPEADO→VALIDADO→CONFIRMADO/ERROR).
- [ ] Pipeline: subir archivo (usa StorageService) → mapear columnas → validar
      en **dry-run** (errores por fila, no escribe) → confirmar → importar.
- [ ] Importador genérico de **Personas** desde Excel/CSV con mapeo manual,
      reutilizando la validación de cédula existente. Tests del dry-run.
- [ ] UI mínima del asistente de importación (4 pasos).

### F4 — Motor de cálculo data-driven (UY como primer country pack)  `[!]`
**Bloqueada por D3 (definir segundo país antes de generalizar).**
- [!] Migrar IRPF/FONASA/BPS desde código TS hacia el Motor de Conceptos.
- [!] Modelar `JurisdictionPack` (UY) con catálogos versionados por fecha.

### F6 — Eventos + Calendario + Dashboard  `[ ]`
- [ ] `EventoCalendario` (ALTA|BAJA|SUSPENSION|LICENCIA|EVALUACION|RECORDATORIO).
- [ ] `CalendarService.getEventos(companyId, rango)` = almacenados + calculados
      (cumpleaños desde `Persona.fechaNacimiento`, vencimientos desde adjuntos).
- [ ] Dashboard consume `CalendarService` (próximos eventos, recordatorios).

### F7 — EmailService + cola de jobs  `[ ]`
- [ ] Interfaz `EmailService` (impl. SMTP Workspace al inicio).
- [ ] `Notification` genérica + cola simple (cron) detrás de interfaz.
- [ ] Invitaciones de membresía por email (conecta con F1).

### F8 — Login Google (Identity) + dominio  `[ ]`
- [ ] Modelo `Identity` (LOCAL|GOOGLE), un User con varias Identities.
- [ ] OAuth2 Google con validación opcional de dominio (`hd=gro.com.uy`).

### F9 — Marcas/Asistencias + pipeline de novedades  `[ ]`
- [ ] Modelos `Marca` (fichadas crudas) y `JornadaReal` (jornada computada).
- [ ] Pipeline novedades → previsualización editable → cálculo, alimentando el
      motor de conceptos con `diasTrabajados`/`horasExtra` reales.

### F10 — 2.º módulo: Contabilidad + contrato de *asiento*  `[!]`
**Bloqueada por F2 (bus de eventos).**
- [!] Contrato del evento *asiento contable* (cuentas, importes, fecha, ref).
- [!] Consumir `liquidacion.confirmada` → generar asiento de sueldos.

### F11 — Segundo country pack (AR o CL)  `[!]`
**Bloqueada por D3 y F4.**

### F12+ — Facturación → CRM → Stock; Selección/Evaluaciones/DatosPago  `[ ]`
Detallar cuando F2–F4 estén firmes.

---

## Orden recomendado de ataque

Mientras D1/D3/D10 no se decidan, el agente avanza por lo **no bloqueado**:
**F1 residuales → F5 residuales → F2 → F3 → F6 → F7 → F8 → F9.**
F4/F10/F11 quedan bloqueadas hasta resolver sus dependencias.
