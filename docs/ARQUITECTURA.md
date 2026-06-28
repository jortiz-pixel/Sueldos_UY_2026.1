# Documento de Arquitectura — AsysTax

> **Estado:** Borrador para discusión. No es plan de implementación inmediata.
> **Producto:** **AsysTax Sueldos** — primer módulo de la plataforma **AsysTax** (suite extensible: sueldos, facturación, contabilidad, CRM, stock…).
> **Visión:** plataforma **extensible**, multi-empresa e **internacional**, con crecimiento *land-and-expand* y **migración fácil** como diferenciador. Meta: ser líder en Latinoamérica.
> Las decisiones marcadas con 🔵 son **fundacionales**: baratas de hacer ahora, caras de retrofitear.

---

## 0. La visión en una página

AsysTax no es un sistema de sueldos: es una **plataforma** sobre la que viven varios módulos (Sueldos, Facturación, Contabilidad…) que comparten una base común y se integran entre sí. Esa plataforma debe ser:

- **Multi-empresa (multi-tenant):** una instalación sirve a muchas empresas, con aislamiento estricto y posibilidad de compartir empresas entre usuarios.
- **Internacional:** un **núcleo común** agnóstico al país + un **paquete de país** que aporta las reglas locales (impuestos, aportes, documentos, moneda). El valor durable es el motor regulatorio mantenido al día — eso es lo que la IA *no* abarata y lo que ninguna empresa se construye sola.
- **Multi-módulo e *extensible*:** Sueldos, Facturación, Contabilidad — y a futuro **CRM, Control de Stock** y los que vengan — son **módulos enchufables** sobre un backbone común. La plataforma no está cableada a un conjunto fijo de módulos: nuevos módulos se *registran*, no se incrustan.
- **Land-and-expand:** el cliente entra por **cualquier** módulo (uno llega por Facturación, otro por Sueldos) y suma los demás **sin re-onboarding**, porque sus datos (empresa, personas, clientes, productos) ya viven en el backbone. Cada módulo es a la vez **puerta de entrada** y **objetivo de venta cruzada**.
- **Migración fácil como diferenciador:** importar desde *cualquier* software previo con mínima fricción es un **subsistema de primera clase** y la principal palanca para ganar usuarios. Bajar el costo de cambiarse a AsysTax es la ventaja competitiva.

> **Norte:** ser el software **líder en Latinoamérica**. Eso no se logra con features sueltas sino con **cimientos firmes**: un backbone extensible, datos maestros compartidos, integración por eventos y migración sin dolor.

Decisiones fundacionales que se derivan de esto y conviene tomar antes de seguir construyendo:

1. 🔵 **Backbone de plataforma extensible** (identidad + empresa + datos maestros + eventos + **registro de módulos**) compartido por todos los módulos.
2. 🔵 **Membresía y permisos** de plataforma (reemplaza `User.companyId`): habilita compartir empresas y multi-empresa.
3. 🔵 **Entitlements por módulo**: qué módulos tiene contratada cada empresa (la base económica del land-and-expand).
4. 🔵 **Motor de cálculo data-driven**: la lógica fiscal vive como datos/conceptos por país, no cableada en el código.
5. 🔵 **Framework de migración/importación**: importadores por sistema de origen, con validación y *dry-run*.

El estado actual ya tiene piezas correctas para esto (Persona global, Contrato como vínculo, Motor de Conceptos, aritmética en centésimos). El trabajo es **completarlas y elevarlas a nivel plataforma**, no reescribir.

---

## A · Discusión estratégica (contexto para decidir)

Esta sección resume el razonamiento detrás de las decisiones. Sirve para que cada elección técnica tenga su porqué de negocio.

### A.1 ¿Las empresas se construirán su propio software y dejarán de comprar?

Postura: **parcialmente cierto, pero no para este producto.**

- Lo que abarata la IA es **escribir** software (el v1). Lo que *no* abarata es **mantenerlo y responder por él**: corrección continua, cumplimiento regulatorio, seguridad, responsabilidad legal, conocimiento institucional.
- La nómina es el **peor candidato** para "hágalo usted mismo": no es código difícil, es **mantenimiento regulatorio difícil** (BPC, escalas IRPF, FONASA, aportes, Consejos de Salarios… que cambian permanentemente y donde un error es una multa, no un bug feo). Un proveedor amortiza ese trabajo entre todos sus clientes; una empresa sola, no.
- "No compartir datos" no implica construir: una empresa chica corriendo su propio software suele ser **menos** segura (sin equipo de seguridad, sin backups probados). El riesgo se mitiga del lado del proveedor (on-premise, residencia de datos, encriptación).

**Conclusión:** habrá más software a medida en lo **no regulado y diferencial**; en lo **horizontal y regulado** (sueldos, impuestos, contabilidad) sigue ganando comprar. El competidor real no es el "hágalo usted mismo", es **otro proveedor con mejor producto y el mismo motor regulatorio**.

### A.2 ¿Por qué SaaS / multi-cliente y no solo interno de Gro?

El valor durable es el **motor regulatorio mantenido al día**. Ese costo de mantenimiento permanente **solo se justifica amortizándolo entre varios clientes**. Si fuera solo para Gro, sería difícil de sostener en el tiempo. → empuja a **producto/SaaS**.

### A.3 ¿Por qué plataforma multi-módulo (no productos sueltos)?

Sueldos, Facturación y Contabilidad comparten identidad, empresa y padrón de personas, y convergen en el asiento contable. Si nacen como apps separadas, "interconectarlas" después es pegar con cinta tres logins y tres padrones. Diseñar el **backbone una sola vez** es barato ahora y carísimo de retrofitear. → **plataforma AsysTax**, Sueldos como primer módulo.

### A.4 ¿Por qué "núcleo común + país" y no un motor tributario universal?

Cada país difiere demasiado para un motor único; pero la mayor parte del sistema es **agnóstica al mercado** (sección 3). Lo único realmente local es la matemática fiscal. La estrategia correcta es **base común + paquete de país**, validada con un segundo país antes de declararla genérica. → internacionalización sin sobre-ingeniería.

### A.5 Estrategia de crecimiento: land-and-expand + migración

La forma de **ganar el mercado** no es vender un producto grande, sino **entrar por una punta y expandirse**:

- **Cada módulo es una puerta de entrada.** Uno llega por Facturación; otro por Sueldos; mañana por CRM. El producto debe ser excelente *por módulo*, no solo como suite.
- **La venta cruzada es casi sin fricción** *si y solo si* los datos maestros están compartidos. Quien ya cargó su empresa, sus personas y sus clientes para Facturación, activa Sueldos con un clic y la mitad de los datos ya están. Eso **solo funciona si el backbone es común desde el día uno** — es la justificación económica de gastar en cimientos.
- **La migración es la palanca de adquisición.** El mayor freno para cambiarse de software es el miedo a migrar los datos. Si AsysTax importa desde cualquier sistema previo con un proceso guiado y confiable, **baja la barrera de entrada** y se vuelve el diferenciador comercial. Es tan importante como las features.

> Modelo mental: **no vendemos software, bajamos costos de cambio.** Costo de cambio de *venir* (migración fácil) + costo de cambio de *expandirse* (datos ya cargados) ≈ 0. Ahí está el liderazgo.

### A.6 Extensibilidad: módulos previstos pero no incrustados

Para que CRM, Stock y futuros módulos **encajen sin reescribir el núcleo**, la plataforma se diseña con un **registro de módulos**: cada módulo declara sus entidades, los eventos que emite/consume, sus permisos y sus importadores. El backbone no "sabe" qué módulos existen; los descubre. Esto es lo que separa una **plataforma** de "tres apps que comparten login".

### A.7 Resumen de la postura

> AsysTax es una **plataforma extensible, internacional y multi-módulo** cuyo valor es el **motor regulatorio confiable y mantenido** + **datos maestros compartidos** + **migración sin dolor**. Se crece por *land-and-expand* (entrar por una punta, expandir a las otras). Lo barato-ahora/caro-después (backbone extensible, membresía, entitlements, motor data-driven, framework de migración) se decide primero; el cálculo de Uruguay que ya funciona no se toca hasta decidir implementar.

---

## 1. Principios rectores

1. **Plataforma antes que producto:** identidad, empresa y datos maestros existen una sola vez para toda la suite, no una por módulo.
2. **Extensible por diseño:** módulos enchufables vía registro/manifiesto; agregar uno nuevo no toca el núcleo.
3. **Datos maestros compartidos:** Persona, Tercero (cliente/proveedor) y Producto en el backbone — es lo que hace barata la venta cruzada.
4. **Dos planos de datos:** lo de la *persona/maestro* es global; lo *operativo* es por empresa (tenant).
5. **Núcleo común vs. país:** cero lógica de un país en el código de la aplicación; lo local vive en datos.
6. **Integración por contratos, no por tablas:** los módulos se hablan por eventos/APIs bien definidos; cada uno es dueño de su dominio.
7. **Migración como diferenciador:** importar desde cualquier SW previo es un subsistema central, no un extra.
8. **Bajar costos de cambio:** fácil *venir* (migración) y fácil *expandirse* (datos ya cargados) — es la estrategia de crecimiento.
9. **Genérico antes que específico:** adjuntos, eventos, permisos, importadores como mecanismos reutilizables.
10. **Todo lo sensible se audita y se encripta** (cuentas bancarias, documentos).
11. **Aritmética en centésimos (BigInt)** — ya vigente, agnóstica a la moneda, se mantiene.

---

## 2. AsysTax como plataforma extensible (la decisión de mayor alcance)

AsysTax se diseña como **monolito modular**, no como microservicios: una sola plataforma, una sola base de datos con **contextos acotados** (cada módulo dueño de su esquema), backbone compartido e integración por un **bus de eventos interno**. Se opera como un sistema; los módulos están desacoplados por contratos, de modo que el día que uno necesite separarse, ya está aislado.

> **Por qué no microservicios (todavía):** para el tamaño de equipo, triplicar infra, despliegues y sincronización antes de tener clientes es contraproducente. El monolito modular da el desacople sin el costo operativo. Es una puerta que se deja abierta, no una que se cierra.

### 2.1 Backbone compartido (existe UNA sola vez)

Lo crítico para el land-and-expand: los **datos maestros viven en el backbone**, no dentro de un módulo. Así, activar un segundo módulo reutiliza lo ya cargado.

| Pieza | Compartida por | Nota |
|---|---|---|
| **Identidad / login / sesión** | Todos los módulos | Login único; se cambia de módulo sin re-loguearse |
| **Membresía + permisos** | Todos los módulos | Membresía a la *empresa en AsysTax*, no a "la empresa en Sueldos" |
| **Entitlements** (módulos contratados) | Todos los módulos | Qué módulos ve/usa cada empresa (base del land-and-expand) |
| **Empresa (tenant)** | Todos los módulos | RUT, razón social, domicilio fiscal: una sola vez |
| **Persona (padrón de personas físicas)** | Sueldos, RR.HH., CRM | Empleado, candidato, contacto |
| **Tercero (cliente / proveedor)** | Facturación, Contabilidad, CRM, Stock | Persona o empresa con la que se opera |
| **Producto / Ítem (bienes y servicios)** | Facturación, Stock, Contabilidad | Catálogo de lo que se vende/mueve |
| **Catálogos, auditoría, almacenamiento, notificaciones, calendario** | Todos los módulos | Mecanismos comunes |
| **Bus de eventos + registro de módulos** | Todos los módulos | Canal e infraestructura de extensibilidad |

**Implicación clave:** como Sueldos es el primer módulo, su base de identidad/empresa/datos-maestros debe **nacer pensada como la base de la plataforma**, no como la de una app aislada. Retrofitear esto con varios productos ya en producción es carísimo.

### 2.2 Registro de módulos (cómo se enchufa un módulo nuevo)

El backbone **no conoce** la lista de módulos: la descubre. Cada módulo se *registra* declarando un manifiesto:

```
ModuleManifest
  key            SUELDOS | FACTURACION | CONTABILIDAD | CRM | STOCK | ...
  entidades      esquema propio (contexto acotado)
  emite          eventos que publica (ej. "liquidacion.confirmada")
  consume        eventos que escucha (ej. "factura.emitida")
  permisos       acciones que expone para el sistema de roles
  importadores   migradores que aporta (ver §2.6)
  entitlement    cómo se licencia/activa
```

Agregar CRM o Stock = publicar su manifiesto + su esquema; **no se toca el núcleo ni los otros módulos**. Esto es lo que vuelve a AsysTax una plataforma y no "apps que comparten login".

### 2.3 Módulos previstos

| Módulo | Estado | Se apoya en (backbone) | Converge en |
|---|---|---|---|
| **Sueldos** | En producción (UY) | Persona, Empresa, Contrato | Contabilidad (asiento) |
| **Facturación** | Previsto | Tercero, Producto, Empresa | Contabilidad (asiento) + Stock (movimiento) |
| **Contabilidad** | Previsto | Empresa, plan de cuentas | — (sumidero de asientos) |
| **CRM** | Previsto | Persona, Tercero (clientes/leads) | Facturación (oportunidad → factura) |
| **Control de Stock** | Previsto | Producto, Empresa | Facturación (venta descuenta stock) |
| *(futuros)* | Abierto | Backbone + registro de módulos | según corresponda |

La existencia de **Tercero** y **Producto** como datos maestros compartidos es lo que hace que CRM, Facturación y Stock se integren naturalmente (un *lead* de CRM se vuelve *cliente* de Facturación; un *producto* facturado descuenta de *Stock*).

### 2.4 Integración entre módulos (eventos, no tablas compartidas)

Los módulos **no leen ni escriben las tablas del otro**. Se integran por contratos. El punto de convergencia natural es **Contabilidad**, sumidero de los demás:

```
AsysTax Sueldos      ──(liquidación confirmada)──►  Asiento     ──►  AsysTax Contabilidad
AsysTax Facturación  ──(factura emitida)─────────►  Asiento     ──►  AsysTax Contabilidad
AsysTax Facturación  ──(venta confirmada)────────►  Movimiento  ──►  AsysTax Stock
AsysTax CRM          ──(oportunidad ganada)──────►  Pre-factura ──►  AsysTax Facturación
```

- **Sueldos → Contabilidad:** cada liquidación confirmada emite un evento que genera el **asiento de sueldos** (gasto de remuneraciones, aportes patronales, deudas con BPS/DGI, líquido a pagar).
- **Facturación → Contabilidad:** cada factura emite su asiento (ventas, IVA débito fiscal).
- **Facturación → Stock:** una venta descuenta inventario; una compra lo aumenta.
- **CRM → Facturación:** una oportunidad ganada se convierte en pre-factura (el cliente ya existe como *Tercero*).
- **El *asiento contable* (y, análogamente, el *movimiento de stock*) es la moneda de integración.** Definido bien el contrato (cuentas/ítems, importes, fecha, referencia al documento origen), ningún módulo necesita saber del interior de otro.

Esto encaja con el pipeline actual: la liquidación ya termina en un recibo; ahora ese mismo final **emite un evento** que otros módulos consumen.

### 2.5 🔵 Entitlements y land-and-expand (cómo se monetiza y se expande)

Qué módulos tiene contratada cada empresa vive en el backbone, no en cada módulo:

```
Entitlement
  id, companyId
  module     SUELDOS | FACTURACION | CONTABILIDAD | CRM | STOCK | ...
  plan       (free / básico / pro …)
  estado     ACTIVO | TRIAL | SUSPENDIDO
  vigenciaDesde / vigenciaHasta
  @@unique([companyId, module])
```

- **Entrar por una punta:** el cliente activa un módulo (ej. Facturación) → un `Entitlement`. El resto de la plataforma queda visible pero "no contratado".
- **Expandir sin fricción:** activar Sueldos = crear otro `Entitlement`. **Los datos maestros ya están cargados** (empresa, personas, terceros) → onboarding casi nulo. Ese es el corazón del modelo de crecimiento.
- **El frontend** muestra/oculta módulos según entitlements; el **backend** los exige en cada request (igual que la membresía). Un módulo sin entitlement no procesa, aunque la UI se filtre.
- Habilita **trials por módulo** como táctica de venta cruzada ("probá Sueldos 30 días").

### 2.6 🔵 Migración / Importación — el diferenciador competitivo

El mayor freno para cambiarse de software es el miedo a migrar los datos. AsysTax lo convierte en ventaja: **importar desde cualquier sistema previo con un proceso guiado, validado y reversible.**

```
MigrationJob
  id, companyId, targetModule
  sourceSystem   EXCEL_GENERICO | <competidor> | API_EXTERNA | ...
  fileRef        archivo subido (usa StorageService)
  mapping        Json   // columnas origen → campos destino
  dryRun         bool   // valida sin escribir
  estado         CARGADO | MAPEADO | VALIDADO | CONFIRMADO | ERROR
  resultados     Json   // filas OK / con error, detalle por fila
```

**Pipeline de importación** (reutiliza el motor de validaciones existente — ej. dígito verificador de cédula):

```
Subir archivo → Detectar/Mapear columnas → Validar (dry-run, muestra errores por fila) → Confirmar → Importar
```

- **Importadores por origen**, registrados por cada módulo (§2.2): un *importador genérico* (Excel/CSV con mapeo manual) cubre el caso universal; importadores específicos por competidor dan experiencia "un clic".
- **Dry-run obligatorio:** nunca se escribe sin previsualizar qué entra y qué falla. Reduce el riesgo percibido, que es lo que frena la decisión de cambiarse.
- **Datos maestros primero:** se migran al backbone (empresas, personas, terceros, productos) y quedan disponibles para *todos* los módulos — refuerza el land-and-expand.
- Es un **subsistema de primera clase**, no una utilidad: es la principal palanca de adquisición de usuarios.

---

## 3. Internacionalización: núcleo común + paquete de país

La intención no es un "motor tributario universal" (eso es sobre-ingeniería), sino **una base común desde la cual partir**, especializada por país. La mayor parte del sistema es **agnóstica al mercado**; lo único genuinamente local es la *matemática fiscal concreta*.

| **Núcleo común** (igual en todos los países) | **Paquete de país** (lo que cambia) |
|---|---|
| Persona, Empresa, Contrato, multi-tenant, membresía, permisos | Reglas concretas de impuestos y aportes |
| Motor de conceptos (el evaluador genérico) | Escalas, topes, tasas, conceptos locales |
| Aritmética en centésimos (BigInt) | Validación del documento de identidad |
| Pipeline novedades → cálculo → recibo → asiento | Moneda, locale, idioma, feriados |
| Catálogos versionados por fecha (el *mecanismo*) | Formatos de recibos y libros oficiales |
| Auth, adjuntos, calendario, notificaciones, bus de eventos | — |

### 3.1 "Country Pack" (paquete por jurisdicción)

La **jurisdicción** es una dimensión de primer nivel. Un *country pack* es autocontenido por país:

```
JurisdictionPack (ej: UY, AR, CL)
  ├── catálogos        BPC/UVT/UF, escalas de impuesto, topes de aportes (versionados por fecha)
  ├── conceptos        definiciones de cálculo (sueldo, aportes, IRPF, aguinaldo…) en el motor
  ├── validaciones     formato y dígito verificador del documento de identidad
  ├── calendario       feriados, fechas de vencimiento
  ├── moneda/locale    redondeo, formato, idioma
  └── reportes         formatos de recibo y libros oficiales
```

La empresa pertenece a una jurisdicción; el motor carga el pack correspondiente; **el código de cálculo es el mismo para todos los países**, solo cambian los datos. La aritmética en centésimos ya es agnóstica a la moneda.

### 3.2 El único refactor estructural que pide esta visión

Hoy IRPF, FONASA, BPS y las escalas están **cableados en código TypeScript** (`payroll.service.ts`). Eso es perfecto para Uruguay pero es exactamente lo que no puede ser específico de un país. El camino:

> **Migrar la lógica fiscal de UY adentro del Motor de Conceptos**, hasta que Uruguay sea el **primer *country pack*** y no un caso especial hardcodeado. El motor ya existe; el trabajo es moverle la lógica de cálculo que hoy vive afuera.

**La trampa a evitar:** hacer el motor "genérico para N países" en abstracto, sin dos países reales delante. El camino correcto: (1) diseñar la abstracción ahora; (2) hacer **UY profundo** como pack de referencia; (3) **validar con un segundo país** (AR o CL, los más cercanos) antes de declarar genérica la abstracción. El segundo país es el que confirma el diseño.

> **Nota honesta:** cada país nuevo no es "agregar un pack", es un proyecto de modelado regulatorio (leer la ley, modelarla, validarla con un experto local, mantenerla). La arquitectura hace *posible* escalar; el costo real está en el conocimiento normativo de cada mercado.

### 3.3 Marca

- **AsysTax** = marca paraguas / suite. Internacional, pronunciable, no atada a un idioma ni país.
- **Sueldos** = el módulo dentro de la suite. Habilita una familia (AsysTax Sueldos, AsysTax Facturación, AsysTax Contabilidad) sin renombrar nada.
- **Matiz:** "Sueldos" es español — perfecto para LatAm (UY, AR, CL…). Para mercados no hispanohablantes el *nombre del módulo* se localizaría ("AsysTax Payroll"), pero la marca **AsysTax se mantiene intacta**.

---

## 4. Modelo de datos en planos

| Plano | Entidades | Clave |
|---|---|---|
| **GLOBAL (backbone)** | `Persona`, `Tercero` (cliente/proveedor), `Producto`, CVs/experiencia, `Catalogo`, `JurisdictionPack` | Únicas en el sistema (Persona/Tercero por documento) |
| **PLATAFORMA (tenant)** | `Empresa`, `Membership`, `Entitlement` (módulos contratados), `EventoCalendario`, `Attachment` | `companyId` obligatorio + filtro por membresía |
| **POR MÓDULO (tenant)** | Sueldos: `Contrato`, `Liquidacion`, `Marca`/`JornadaReal`, `LibroTrabajo`, `Evaluacion`, `Proceso` · Facturación: `Factura` · Contabilidad: `Asiento` · CRM: `Lead`/`Oportunidad` · Stock: `Deposito`/`Movimiento` | `companyId` + contexto acotado del módulo |

**Estado actual:** ya implementado el núcleo correcto — `Persona` global + `Contrato` como vínculo persona↔empresa. No requiere cambios; el resto se construye encima.

Regla de oro: una **Persona** existe antes de ser empleada (puede ser candidata). El **Contrato** la convierte en empleada de una empresa. Esto habilita CVs, selección y movilidad entre empresas sin duplicar gente — y, a nivel plataforma, que la misma persona sea proveedor/cliente en Facturación.

---

## 5. 🔵 Multi-tenancy y permisos (pieza fundacional)

**Problema:** hoy `User.companyId` ata un usuario a UNA empresa. No soporta compartir empresa, ni un usuario operando varias, ni membresía a nivel plataforma.

```
Membership
  id
  userId          -> User
  companyId       -> Company
  role            OWNER | ADMIN | OPERATOR | VIEWER
  permisos        Json   // overrides granulares por módulo (Sueldos / Facturación / Contabilidad)
  invitedBy       -> User
  estado          PENDIENTE | ACTIVA | REVOCADA
  createdAt
  @@unique([userId, companyId])
```

- **Compartir empresa** = crear `Membership` (PENDIENTE) + email de invitación. Al aceptar → ACTIVA.
- **Permisos por módulo:** la membresía es de plataforma; `permisos` afina qué puede hacer en cada módulo.
- **Empresa activa:** el backend valida `Membership(userId, companyId, estado=ACTIVA)` en **cada** request company-scoped.
- **Migración:** crear `Membership` desde los `User.companyId` actuales. Un middleware `requireMembership(companyId, permiso)` reemplaza el chequeo actual.

---

## 6. 🔵 Autenticación con múltiples proveedores (Google + local)

```
Identity
  id
  userId        -> User
  provider      LOCAL | GOOGLE
  providerUserId   // sub de Google, o null para local
  email
  @@unique([provider, providerUserId])
```

- OAuth2 con Google, con validación opcional de `hd` (dominio corporativo, ej. `gro.com.uy`).
- Un `User` puede tener varias `Identity` (local + Google). La capa de JWT actual no cambia.
- 2FA opcional para roles OWNER/ADMIN.

---

## 7. 🔵 Adjuntos y almacenamiento

Un solo mecanismo para foto de persona, scan de cédula/libreta, carné de salud, CVs, documentos de empresa.

```
Attachment
  id, ownerType (PERSONA|EMPRESA|CONTRATO|EVALUACION|...), ownerId
  tipo (FOTO|CEDULA|LIBRETA|CARNE_SALUD|CV|OTRO)
  fileName, mimeType, storageKey, tamano
  vencimiento DateTime?   // carné de salud, libreta → alimenta el calendario
  uploadedBy, createdAt
```

- **`StorageService`**: hoy volumen local; mañana S3-compatible cambiando solo la implementación. Definir la interfaz ahora.
- Archivos sensibles → URLs firmadas con expiración; nunca públicos.

---

## 8. 🔵 Eventos, Calendario y Dashboard

El calendario mezcla **eventos almacenados** y **calculados**; una capa de agregación evita tocarlo por cada fuente nueva.

```
EventoCalendario   // solo eventos "duros" persistidos
  id, companyId, tipo (ALTA|BAJA|SUSPENSION|LICENCIA|EVALUACION|RECORDATORIO)
  fecha, fechaFin?, personaId?, contratoId?, titulo, descripcion
```

**Calculados** (no se almacenan): cumpleaños ← `Persona.fechaNacimiento`; vencimientos de carné/libreta ← `Attachment.vencimiento`; vencimientos BPS/Consejos ← parámetros.

**`CalendarService.getEventos(companyId, rango)`** = almacenados + calculados. El **Dashboard** consume el mismo servicio.

---

## 9. Marcas / Asistencias y liquidación por datos reales

Separar **fichadas crudas** de **jornada computada**.

```
Marca         id, companyId, personaId, timestamp, tipo (ENTRADA|SALIDA), origen, editadaPor?
JornadaReal   id, companyId, personaId, fecha, horasTrabajadas, horasExtra*, ausencia, aprobada
```

**Pipeline:**

```
NovedadesPeriodo (entradas)  ->  Previsualización (editable)  ->  Cálculo  ->  Recibo  ->  Asiento
        ▲                                  ▲
   marcas reales (JornadaReal)        ajustes manuales / novedades
```

El motor de conceptos actual ya encaja: hoy recibe `diasTrabajados`/`horasExtra`; se extiende para tomarlos de `NovedadesPeriodo`.

---

## 10. Selección (ATS-lite), CVs y Evaluaciones

Todo se apoya en la **Persona global**.

```
Proceso (empresa)        Candidatura                 Evaluacion (empresa)
  titulo, etapas[]         procesoId, personaId        personaId, contratoId
  contratoFinalId?         etapaActual, estado, notas  puntaje, criterios(Json), fecha
```

Un **Proceso** tiene etapas; las **Candidaturas** mueven personas; el desenlace es un **Contrato**. Las **Evaluaciones** se ligan a persona + contrato.

---

## 11. Datos de la persona: pago y geolocalización

- **Forma de pago / banco / cuenta:** `DatosPago` con `nroCuenta` encriptado, acceso auditado. Si el banco varía por empresa, se mueve a nivel contrato.
- **Dirección geolocalizable:** `calle, nro, localidad, departamento, lat, lng, placeId`; validación con Google Geocoding/Places.

---

## 12. Notificaciones y trabajos programados

- **`EmailService`** detrás de una interfaz (SMTP de Workspace o proveedor transaccional).
- **`Notification`** genérica + **cola de jobs** para envíos asíncronos y recordatorios (vencimientos, cumpleaños).
- En multi-cliente conviene cola real (BullMQ/Redis) desde el inicio.

---

## 13. Seguridad (transversal)

- Aislamiento por tenant verificado **siempre en backend** (middleware de membresía + entitlement).
- Menor privilegio por membresía + permisos granulares por módulo.
- **Auditoría** poblada (`AuditLog`): logins, cambios sensibles, compartir/revocar, confirmaciones de liquidación, asientos emitidos, importaciones.
- **Encriptación** de datos sensibles y URLs firmadas para archivos.
- OAuth + 2FA opcional; rotación de refresh tokens (ya implementada); rate limiting (ya implementado).
- Backups y plan de recuperación de datos y archivos.

---

## 14. Diagrama de relaciones (resumen)

```
        ┌──────────────────── AsysTax Platform (backbone) ────────────────────┐
        │  Identidad · Membresía · Entitlements · Empresa(tenant) ·            │
        │  Datos maestros: Persona · Tercero · Producto ·                      │
        │  Catálogos · Adjuntos · Calendario · Bus de eventos · Migración ·    │
        │  Registro de módulos                                                 │
        └─────────────────────────────────────────────────────────────────────┘
            │            │             │            │            │
         Sueldos    Facturación   Contabilidad     CRM         Stock      (+futuros)
            │            │             ▲            │            ▲
            └─ Asiento ──┴── Asiento ──┘            └ Oportun. ─►Factura   │
                         └────────────────── Movimiento ──────────────────┘

Backbone (GLOBAL): Persona · Tercero · Producto · Catalogos · JurisdictionPack (UY, AR, CL...)
Persona ──< Contrato >── Empresa            (vínculo laboral, módulo Sueldos)
Tercero ──< Factura (Facturación) ; Lead/Oportunidad (CRM)
Producto ──< LíneaFactura ; Movimiento (Stock)
Empresa ──< Entitlement (módulos contratados) ; Membership ; EventoCalendario
```

---

## 15. Plan de migración por fases (orden sugerido)

| Fase | Entrega | Desbloquea |
|---|---|---|
| **F1** 🔵 | Backbone: Membresía + permisos + **Entitlements** (reemplaza `User.companyId`) | Compartir empresa, multi-empresa, land-and-expand |
| **F2** 🔵 | **Registro de módulos** + datos maestros compartidos (Persona/Tercero/Producto) + bus de eventos | Que CRM/Stock/Facturación se enchufen sin tocar el núcleo |
| **F3** 🔵 | **Framework de migración/importación** (genérico Excel + dry-run) | Diferenciador de adquisición; carga inicial de cualquier cliente |
| **F4** 🔵 | Motor de cálculo data-driven: migrar IRPF/FONASA/BPS al Motor de Conceptos → UY como primer *country pack* | Internacionalización |
| **F5** 🔵 | Attachments + StorageService | Foto, scans, carné de salud, CVs |
| **F6** 🔵 | Eventos + Calendario + Dashboard | Panel principal, recordatorios |
| **F7** | EmailService + cola de jobs | Avisos, trials, invitaciones |
| **F8** | Login Google (Identity) + dominio | UX de acceso |
| **F9** | Marcas/Asistencias + pipeline de novedades | Liquidación por datos reales |
| **F10** | **2.º módulo: Contabilidad** + contrato de *asiento* | Cierra el circuito Sueldos→Contabilidad; valida la extensibilidad |
| **F11** | Segundo *country pack* (AR o CL) | Valida la abstracción internacional |
| **F12+** | Módulos: Facturación → CRM → Stock; Selección/Evaluaciones/DatosPago | Suite completa |

Cada fase es desplegable y no rompe lo anterior (migraciones aditivas, como venimos trabajando). **F1–F3 son los cimientos** que pide la visión de plataforma extensible con migración como diferenciador.

---

## 16. Decisiones a tomar (matriz de decisión)

Cada decisión con sus opciones, una **recomendación** y la **consecuencia** que arrastra. Pensadas para resolverse de a una.

### D1 · Escala objetivo del producto  *(define todo lo demás)*
| Opción | Implica |
|---|---|
| Interno de Gro (pocas empresas) | Infra simple; difícil justificar el mantenimiento regulatorio en el tiempo |
| **Producto SaaS multi-cliente** ✅ | Amortiza el motor regulatorio; exige membresía + aislamiento serios |
| SaaS internacional desde día 1 | Máximo alcance; máximo costo inicial — riesgo de sobre-ingeniería |
> **Recomendación:** SaaS multi-cliente, con la abstracción internacional *diseñada* pero implementada país por país. Es la que sostiene económicamente el producto sin pagar de golpe el costo de N países.

### D2 · Orden de construcción de los módulos
| Opción | Implica |
|---|---|
| **Sueldos profundo → Contabilidad → Facturación → CRM → Stock** ✅ | Consolida lo existente; Contabilidad cierra el circuito de asientos; el resto se enchufa |
| Priorizar Facturación (mayor demanda de mercado) | Buena puerta de entrada comercial; pero su asiento/stock necesitan a Contabilidad/Stock para cerrar |
| CRM temprano (capta usuarios "arriba del embudo") | Atrae leads y datos de terceros; menos atado a regulación |
> **Recomendación:** Sueldos sobre el backbone, **2.º Contabilidad** (sumidero de asientos, valida la extensibilidad), luego Facturación, CRM y Stock. El orden fino se ajusta según dónde haya más tracción comercial (ver D10).

### D10 · ¿Por qué punta entrar al mercado? (estrategia land-and-expand)
| Opción | Implica |
|---|---|
| Entrar por **Sueldos** (lo que ya existe) | Aprovecha el producto actual; cross-sell hacia Facturación/CRM |
| Entrar por **Facturación** | Mercado más amplio (toda empresa factura); cross-sell hacia Sueldos |
| Entrar por **CRM** | Capta arriba del embudo; menor barrera regulatoria |
> **Recomendación:** es una decisión **comercial**, no técnica — la arquitectura soporta entrar por cualquiera. Definir cuál punta tiene hoy más tracción para enfocar el primer esfuerzo de venta. Lo técnico ya está cubierto por entitlements + datos maestros compartidos.

### D11 · Alcance inicial de la migración
| Opción | Implica |
|---|---|
| **Importador genérico (Excel/CSV con mapeo)** ✅ primero | Cubre el 100% de los casos con esfuerzo manual del cliente |
| Importadores específicos por competidor | Experiencia "un clic"; alto valor comercial pero hay que hacer uno por sistema |
> **Recomendación:** genérico primero (universal), y luego importadores dedicados para los 2-3 sistemas de los que más venga la gente. Priorizar según de dónde lleguen los clientes reales.

### D3 · Segundo país (valida la abstracción internacional)
| Opción | Implica |
|---|---|
| **Argentina** | Mercado grande; regulación compleja y cambiante |
| **Chile** | Estructura más ordenada; buen banco de pruebas para el motor |
| Esperar / solo UY por ahora | Menor costo; no valida si la abstracción es realmente genérica |
> **Recomendación:** definir el país objetivo *antes* del motor data-driven (F4), porque el segundo país es el que confirma que la abstracción está bien diseñada. Chile suele ser el más limpio para validar; Argentina el de mayor mercado.

### D4 · Infraestructura
| Opción | Implica |
|---|---|
| **Seguir en Hostinger (VPS)** ✅ por ahora | Costo bajo; suficiente para arrancar SaaS chico |
| Nube (AWS/GCP) | Storage S3, colas y escalado nativos; mayor costo y complejidad |
> **Recomendación:** seguir en Hostinger mientras la escala sea baja, **pero** definir las interfaces (`StorageService`, cola) abstractas para migrar sin reescribir cuando haga falta.

### D5 · Almacenamiento de archivos
| Opción | Implica |
|---|---|
| **Volumen local + interfaz `StorageService`** ✅ | Simple hoy; migrable a S3 cambiando solo la implementación |
| S3-compatible (MinIO/AWS) ya | Listo para escala/multi-cliente; más setup inicial |
> **Recomendación:** local detrás de la interfaz ahora; S3 cuando D1/D4 lo pidan.

### D6 · Cola de trabajos / notificaciones
| Opción | Implica |
|---|---|
| **Cron simple** ✅ para arrancar | Suficiente para recordatorios e emails básicos |
| Redis + BullMQ | Necesario para volumen multi-cliente y reintentos robustos |
> **Recomendación:** cron al inicio detrás de una interfaz; cola real cuando crezca el volumen.

### D7 · Email
| Opción | Implica |
|---|---|
| SMTP de Google Workspace `@gro.com.uy` | Cero costo extra; entregabilidad/escala limitadas |
| **Proveedor transaccional** (SES/Resend/…) | Mejor entregabilidad y escala; pequeño costo |
> **Recomendación:** Workspace para empezar; transaccional al pasar a multi-cliente real.

### D8 · Datos de pago (banco/cuenta)
| Opción | Implica |
|---|---|
| A nivel **Persona** | Simple; asume que la persona cobra igual en toda empresa |
| A nivel **Contrato** | Soporta que cobre distinto según empresa; más flexible |
> **Recomendación:** definirlo según la realidad del negocio — si una misma persona puede cobrar por bancos distintos según la empresa, va a **Contrato**. (Decisión de dato, barata de mover si se elige bien ahora.)

### D9 · Propiedad de la base compartida
| Opción | Implica |
|---|---|
| OWNER fijo, no transferible | Simple; problemático si esa persona se va |
| **OWNER transferible + reglas de revocación** ✅ | Robusto para empresas reales; algo más de lógica |
> **Recomendación:** propiedad transferible y regla explícita de qué pasa al revocar al OWNER (otro ADMIN asume). Se diseña junto con F1.

---

### Tablero rápido para decidir
| # | Decisión | Recomendación | Urgencia |
|---|---|---|---|
| D1 | Escala objetivo | SaaS multi-cliente | **Ahora** (condiciona todo) |
| D2 | Orden de módulos | Sueldos → Contabilidad → Facturación → CRM → Stock | Media |
| D3 | Segundo país | Definir antes del *country pack* (CL valida / AR mercado) | Antes de F4 |
| D4 | Infra | Hostinger + interfaces abstractas | Baja |
| D5 | Storage | Local tras `StorageService` | Con F5 |
| D6 | Cola | Cron → cola real al crecer | Con F7 |
| D7 | Email | Workspace → transaccional | Con F7 |
| D8 | Datos de pago | Persona o Contrato según negocio | Con F12 |
| D9 | Propiedad base | Transferible + revocación | Con F1 |
| D10 | Punta de entrada al mercado | Comercial: la de más tracción hoy | Cuando se venda |
| D11 | Alcance de migración | Genérico → importadores por competidor | Con F3 |

---

*Próximo paso sugerido (cuando se decida implementar):* resolver **D1** (escala) y **D10** (punta de entrada comercial). Técnicamente, los **cimientos son F1–F3**: backbone + entitlements, registro de módulos + datos maestros, y framework de migración — en ese orden, porque son lo que vuelve a AsysTax una plataforma extensible con migración como diferenciador. **F4** (motor data-driven) habilita la internacionalización. Nada de esto requiere tocar todavía el cálculo de Uruguay que ya está en producción.
