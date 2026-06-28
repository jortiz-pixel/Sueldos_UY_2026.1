# Documento de Arquitectura — Sueldos UY 2026

> **Estado:** Borrador para discusión. No es plan de implementación inmediata.
> **Dimensionado para:** *Producto multi-cliente* (decenas a cientos de empresas de distintos clientes).
> Las decisiones marcadas con 🔵 son **fundacionales**: baratas de hacer ahora, caras de retrofitear.

---

## 1. Objetivo y principios rectores

Construir una base que soporte el roadmap (compartir empresas, marcas/asistencias, procesos de selección, calendario, notificaciones) **sin reescrituras**. Principios:

1. **Dos planos de datos**: lo que es de la *persona* es global; lo que es *operativo* es por empresa (tenant).
2. **Aislamiento de tenant estricto**: ningún dato de una empresa es accesible sin una membresía válida verificada en el backend.
3. **Genérico antes que específico**: adjuntos, eventos y permisos como mecanismos reutilizables, no soluciones puntuales.
4. **La liquidación es un *pipeline* con entradas**: novedades → previsualización → cálculo → recibo. Las marcas son una fuente de entradas más.
5. **Todo lo sensible se audita y se encripta** (cuentas bancarias, documentos).
6. **Aritmética en centésimos (BigInt)** — ya vigente, se mantiene.

---

## 2. Modelo de datos en dos planos

| Plano | Entidades | Clave |
|---|---|---|
| **GLOBAL** | `Persona` (padrón, candidatos, empleados), CVs/experiencia, `Catalogo` (Consejos de Salarios, grupos MTSS, BPC, tasas IRPF/FONASA) | Únicas en el sistema (Persona por CI) |
| **POR EMPRESA (tenant)** | `Empresa`, `Membership`, `Contrato`, `Liquidacion`, `Marca`/`JornadaReal`, `LibroTrabajo`, `Evaluacion`, `Proceso`, `EventoCalendario` | `companyId` obligatorio + filtro por membresía |

**Estado actual:** ya implementado el núcleo correcto — `Persona` global (CI único) + `Contrato` como vínculo persona↔empresa. **No requiere cambios**; el resto se construye encima.

Regla de oro: una **Persona** existe antes de ser empleada (puede ser candidata). El **Contrato** la convierte en empleada de una empresa. Esto habilita CVs, procesos de selección y movilidad entre empresas sin duplicar gente.

---

## 3. 🔵 Multi-tenancy y permisos (la pieza fundacional #1)

**Problema:** hoy `User.companyId` ata un usuario a UNA empresa. No soporta *compartir empresa* ni un usuario operando varias.

**Solución — tabla de membresía:**

```
Membership
  id
  userId          -> User
  companyId       -> Company
  role            OWNER | ADMIN | OPERATOR | VIEWER
  permisos        Json   // overrides granulares por módulo
  invitedBy       -> User
  estado          PENDIENTE | ACTIVA | REVOCADA
  createdAt
  @@unique([userId, companyId])
```

- **Compartir empresa** = crear `Membership` (estado PENDIENTE) + email de invitación. Al aceptar → ACTIVA.
- **Niveles de acceso**: `role` define el preset; `permisos` permite afinar por módulo (ej. "ve liquidaciones pero no las confirma").
- **Empresa activa**: el front mantiene la empresa seleccionada; el backend valida `Membership(userId, companyId, estado=ACTIVA)` en **cada** request company-scoped.
- **OWNER**: quien creó la base; único que puede compartir/revocar y transferir propiedad.

**Migración:** crear `Membership` a partir de los `User.companyId` actuales (1 membership OWNER/ADMIN por usuario con empresa). `User.companyId` queda como "última empresa usada" (UX) o se elimina.

**Impacto en el código:** un middleware `requireMembership(companyId, permiso)` reemplaza el `checkCompanyAccess` actual. Es el cambio de mayor alcance, por eso va primero.

---

## 4. 🔵 Autenticación con múltiples proveedores (Google + local)

**Objetivo:** login con Google (Gmail/Workspace) restringible a `gro.com.uy`, sin romper el login local.

```
Identity
  id
  userId        -> User
  provider      LOCAL | GOOGLE
  providerUserId   // sub de Google, o null para local
  email
  @@unique([provider, providerUserId])
```

- OAuth2 con Google → se valida el `hd` (hosted domain) = `gro.com.uy` cuando se requiere dominio corporativo.
- El `User` puede tener varias `Identity` (login local + Google).
- La capa de **sesión/JWT actual no cambia**: tras autenticar por cualquier proveedor, se emiten los mismos access/refresh tokens.
- 2FA opcional como capa adicional para roles OWNER/ADMIN.

---

## 5. 🔵 Adjuntos y almacenamiento (la pieza fundacional #2)

**Un solo mecanismo** para foto de persona, scan de cédula/libreta, carné de salud, CVs, documentos de empresa, etc.

```
Attachment
  id
  ownerType     PERSONA | EMPRESA | CONTRATO | EVALUACION | ...
  ownerId
  tipo          FOTO | CEDULA | LIBRETA | CARNE_SALUD | CV | OTRO
  fileName
  mimeType
  storageKey    // ruta en el storage
  tamano
  vencimiento   DateTime?   // p.ej. carné de salud, libreta
  uploadedBy
  createdAt
```

- **Abstracción de storage** (`StorageService`): hoy volumen local del contenedor; mañana S3-compatible (MinIO/AWS) cambiando solo la implementación. **Importante para multi-cliente**: definir esta interfaz ahora aunque la impl. sea local.
- `vencimiento` alimenta directamente el **calendario** y las alertas (carné de salud, libreta).
- Archivos sensibles → URLs firmadas con expiración; nunca públicos.

---

## 6. 🔵 Eventos, Calendario y Dashboard (la pieza fundacional #3)

El calendario mezcla **eventos almacenados** y **eventos calculados**. Diseñar una **capa de agregación** evita tocar el calendario por cada fuente nueva.

```
EventoCalendario        // SOLO los eventos "duros" que se persisten
  id, companyId
  tipo      ALTA | BAJA | SUSPENSION | LICENCIA | EVALUACION | RECORDATORIO
  fecha, fechaFin?
  personaId?, contratoId?
  titulo, descripcion
```

**Eventos calculados** (no se almacenan; los deriva un servicio al consultar el calendario):
- Cumpleaños ← `Persona.fechaNacimiento`
- Vencimiento carné de salud / libreta ← `Attachment.vencimiento`
- Vencimiento BPS / Consejos de Salarios ← fechas de parámetros/empresa

**`CalendarService.getEventos(companyId, rango)`** = unión de (almacenados) + (calculados). El **Dashboard** consume el mismo servicio para sus widgets: calendario, total empleados, costo total mensual, próximo vencimiento BPS, botones alta/baja.

---

## 7. Marcas / Asistencias y liquidación por datos reales

Subsistema más grande. Separar **fichadas crudas** de **jornada computada**.

```
Marca                    // fichada cruda (reloj, app, manual)
  id, companyId, personaId
  timestamp, tipo (ENTRADA|SALIDA), origen, editadaPor?

JornadaReal              // computada por día (editable antes de liquidar)
  id, companyId, personaId, fecha
  horasTrabajadas, horasExtraDiurnas, horasExtraNocturnas
  ausencia (FALTA|LICENCIA|...), aprobada
```

**Integración con la liquidación (pipeline):**

```
NovedadesPeriodo (entradas)  ->  Previsualización (editable)  ->  Cálculo  ->  Recibo
       ▲                                  ▲
   marcas reales (JornadaReal)        ajustes manuales / novedades
```

- Se introduce un objeto **`NovedadesPeriodo`** (días/horas reales, faltas, horas extra, comisiones, ajustes) que es la entrada del motor.
- "Liquidar en base a marcas reales o modificarlas antes de calcular" = el operador ve las novedades derivadas de las marcas, las edita si hace falta, y recién ahí se calcula.
- El **motor de conceptos actual ya encaja**: hoy recibe `diasTrabajados`/`horasExtra`; se extiende para tomarlos de `NovedadesPeriodo`.

---

## 8. Selección (ATS-lite), CVs y Evaluaciones

Todo se apoya en la **Persona global**.

```
Persona  += experienciaLaboralPrevia (Json), + Attachments tipo CV

Proceso (por empresa)        Candidatura                 Evaluacion (por empresa)
  id, companyId                id, procesoId, personaId    id, companyId
  titulo, etapas[]             etapaActual                 personaId, contratoId
  contratoFinalId?             estado, notas               puntaje, criterios(Json), fecha
```

- Un **Proceso** tiene etapas; las **Candidaturas** mueven personas por las etapas; el desenlace es un **Contrato** (la persona pasa a ser empleada).
- **Evaluaciones** quedan ligadas a persona + contrato (desempeño en un empleo concreto).

---

## 9. Datos de la persona: pago y geolocalización

- **Forma de pago / banco / cuenta**: dato sensible. Tabla `DatosPago(personaId, formaPago, banco, nroCuenta_encriptado)` — encriptado en reposo, acceso auditado. Si el banco puede variar por empresa/contrato, se mueve a nivel contrato.
- **Dirección geolocalizable**: campos estructurados `calle, nro, localidad, departamento, lat, lng, placeId`. Validación con **Google Geocoding/Places** al cargar; se guardan coordenadas + `placeId`.

---

## 10. Notificaciones y trabajos programados

- **`EmailService`** (SMTP de Google Workspace `@gro.com.uy` o proveedor transaccional) detrás de una interfaz.
- **`Notification`** (genérica) + **cola de jobs** para envíos asíncronos y **recordatorios programados** (vencimientos de carné/BPS/consejos, cumpleaños).
- Lo usan: compartir empresa (aviso al invitado), alertas de calendario, futuros reportes.
- En *multi-cliente* conviene una cola real (ej. BullMQ/Redis) desde el inicio; en *interno* puede arrancar con cron simple.

---

## 11. Seguridad (transversal)

- Aislamiento por tenant verificado **siempre en backend** (middleware de membresía).
- **Menor privilegio** por membresía + permisos granulares.
- **Auditoría** poblada (ya existe `AuditLog`): logins, cambios sensibles, compartir/revocar, confirmaciones de liquidación.
- **Encriptación** de datos sensibles (cuentas bancarias, documentos) y URLs firmadas para archivos.
- OAuth + 2FA opcional; rotación de refresh tokens (ya implementada); rate limiting (ya implementado).
- Backups y plan de recuperación del volumen de datos y archivos.

---

## 12. Diagrama de relaciones (resumen)

```
Usuario ──< Identity                         (login local / Google)
Usuario ──< Membership >── Empresa           (compartir + permisos)

Persona (GLOBAL) ──< Contrato >── Empresa     (vínculo laboral)
Persona ──< Attachment                        (foto, cédula, carné salud, CV)
Persona ──< Candidatura >── Proceso (Empresa)
Persona ──< DatosPago

Empresa ──< Liquidacion >── Persona
       ──< Marca / JornadaReal
       ──< LibroTrabajo
       ──< Evaluacion >── Contrato
       ──< EventoCalendario
       ──< Concepto / Parametros

Catalogos (GLOBAL): ConsejoSalarios, GrupoMTSS, BPC, Escala IRPF...
```

---

## 13. Plan de migración por fases (orden sugerido)

| Fase | Entrega | Desbloquea |
|---|---|---|
| **F1** 🔵 | Membresía + permisos (reemplaza `User.companyId`) | Compartir empresa, multi-empresa, seguridad |
| **F2** 🔵 | Attachments + StorageService | Foto, scans, carné de salud (con vencimiento), CVs |
| **F3** 🔵 | Eventos + Calendario + Dashboard | Panel principal, recordatorios |
| **F4** | EmailService + cola de jobs | Avisos de F1/F3 |
| **F5** | Login Google (Identity) + dominio | UX de acceso |
| **F6** | Marcas/Asistencias + pipeline de novedades | Liquidación por datos reales |
| **F7** | Procesos de selección + Evaluaciones + DatosPago + geolocalización | ATS, desempeño, pagos |
| **F8** | Consejos de Salarios (catálogo ampliado) | No prioritario |

Cada fase es desplegable y no rompe lo anterior (igual que venimos trabajando con migraciones aditivas).

---

## 14. Decisiones abiertas (para definir juntos)

1. **Escala objetivo** → fija storage (local vs S3) y cola (cron vs Redis/BullMQ).
2. **Infra** → ¿seguir en Hostinger o mover a nube (AWS/GCP) para storage + colas + escalado?
3. **Email** → ¿SMTP de Google Workspace `@gro.com.uy` o proveedor transaccional (mejor entregabilidad/escala)?
4. **Datos de pago** → ¿a nivel persona o contrato? (¿la misma persona cobra distinto según empresa?)
5. **Propiedad de la base compartida** → ¿transferible? ¿qué pasa al revocar al OWNER?

---

*Próximo paso sugerido:* arrancar por **F1 (Membresía/Permisos)** cuando decidas implementar, ya que es la fundación del resto y la más costosa de postergar.
