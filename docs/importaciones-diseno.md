# Módulo Importaciones (comercio exterior) — diseño

Registro de operaciones de **importación de mercadería** de los clientes del
estudio, según normativa uruguaya (DNA/Aduana, DGI, Mercosur). Módulo nuevo,
dominio aparte del de sueldos, pero **reusa** el modelo multiempresa, el control
de accesos (anti-IDOR) y la auditoría ya existentes.

> Estado: **ETAPAS 1, 2 y 3 IMPLEMENTADAS** (16/10/2026).
> - Etapa 1: modelo + carga manual + costeo en vivo + menú "Importaciones".
> - Etapa 2: ficha de costeo (PDF), reporte de crédito fiscal del mes (DGI, con
>   Excel) y asiento contable por importación.
> - Etapa 3: adjuntos por importación (factura, DUA, BL, etc.) e importador que
>   genera el registro desde una **plantilla Excel** (descargable) con auto-mapeo
>   de columnas → previsualización → alta en borrador. En el ALTA de una
>   importación se pueden adjuntar documentos (se suben al guardar) y
>   **autocompletar el formulario** subiendo el Excel/CSV del despachante
>   (endpoint `/extraer`).
> - Etapa 3b: lectura de **PDF** (factura del despachante, pago, DUA) con
>   extracción de texto robusta (`pdfjs-dist`, reconstruye líneas por posición)
>   y heurísticas con el vocabulario de la factura del despachante: toma
>   proveedor, país, CUIT, N° y fecha de factura, aduana, carpeta, transporte,
>   mercadería, condición comercial (incoterm), moneda, tipo de cambio y los
>   importes FOB/flete/seguro/IVA → autocompleta el formulario (best-effort, se
>   revisa antes de guardar). El archivo subido queda adjunto. Validado contra
>   el formato de ejemplo del despachante (MARPOLOS/FRATELLI CURRAO).
> Pendiente: (a) afinar según los PDF reales de cada despachante (layouts en
> tabla/multicolumna); (b) OCR para PDF escaneados (sin texto). §7.

## 1. Decisiones de alcance (acordadas)

- **Finalidad: las cuatro.** Costeo de mercadería + crédito fiscal DGI + asiento
  contable + seguimiento operativo del trámite.
- **Nivel de detalle: simplificado por operación.** Cabezal con totales (CIF,
  tributos, gastos). Ítems opcionales (descripción, cantidad, FOB) **sin**
  desglose tributario por NCM. El prorrateo de costo a los ítems se hace por
  participación en el FOB, no tributo por tributo.
- **Origen de datos: importar archivo del despachante / DUA.** Carga manual como
  respaldo y para ajustes. ⚠️ **Bloqueante:** se necesita una muestra real del
  archivo que entrega el despachante para definir el parser (ver §7).
- **Multiempresa**, igual que Sueldos/Tareas: cada importación pertenece a una
  empresa cliente. Mismo `assertCompanyAccess`, mismos roles (ADMIN/OPERATOR),
  misma auditoría (`recordAudit`).
- **Dinero en centésimos (`BigInt`)** como todo el sistema. Moneda extranjera +
  tipo de cambio ⇒ se guarda el importe en moneda original, el TC y el
  equivalente en pesos (lo que se contabiliza y declara).

## 2. El proceso (flujo y estados)

Estados de una importación:

```
BORRADOR ──▶ EN_TRAMITE ──▶ NACIONALIZADA ──▶ CERRADA
    │                                           ▲
    └───────────────── (anular) ────────────────┘
```

1. **BORRADOR** — se crea la operación (manual o importando el archivo del
   despachante). Se cargan proveedor del exterior, origen, Incoterm, moneda y TC,
   ítems y los totales de CIF / tributos / gastos. Se puede editar libremente.
2. **EN_TRÁMITE** — DUA presentado; se registran nº de DUA, despachante, fechas
   (embarque, arribo, presentación). Seguimiento operativo.
3. **NACIONALIZADA** — mercadería liberada. Quedan firmes los tributos y el
   costeo; se habilitan las salidas (costo por ítem, crédito fiscal, asiento).
4. **CERRADA** — conciliada con la factura del despachante y contabilizada. Solo
   lectura.
5. **ANULADA** — queda en el historial, excluida de reportes (igual criterio que
   las liquidaciones anuladas).

Cada transición y cada edición sensible se registra en auditoría.

## 3. Modelo de datos (simplificado)

### `Importacion` (cabezal)
- `id`, `companyId` (tenant)
- `estado` (enum: BORRADOR | EN_TRAMITE | NACIONALIZADA | CERRADA | ANULADA)
- `regimen` (enum: DEFINITIVA | ADMISION_TEMPORARIA | DEPOSITO | TRANSITO | ZONA_FRANCA)
- **Operación comercial**: `proveedorExterior`, `paisOrigen`, `incoterm`
  (FOB/CIF/CFR/EXW/…), `monedaOrigen` (USD/EUR/…), `tipoCambio` (a la fecha del
  DUA), `facturaComercialNro`, `facturaComercialFecha`
- **Aduana / trámite**: `duaNumero`, `duaFecha`, `despachante`, `aduana`,
  `fechaEmbarque`, `fechaArribo`, `fechaNacionalizacion`,
  `transporte` (BL/AWB/CRT), `certificadoOrigen` (bool — Mercosur)
- **Montos en moneda origen y en pesos** (centésimos):
  - `fob`, `flete`, `seguro` ⇒ `cif = fob + flete + seguro`
  - total tributos (ver detalle en `TributoImportacion`)
  - total gastos de plaza (ver `GastoImportacion`)
- **Derivados** (calculados, no editables): `costoMercaderia`,
  `creditoFiscalIva`, `anticiposPagados`
- `notas`, timestamps, `creadoPor`

### `ItemImportacion` (opcional, para prorratear el costo)
- `id`, `importacionId`
- `descripcion`, `ncm` (texto libre, informativo — sin tabla NCM en esta etapa)
- `cantidad`, `fobUnitario`, `fobTotal`
- `costoProrrateado` (calculado: por participación en el FOB total)

### `TributoImportacion` (líneas de tributo del DUA)
- `id`, `importacionId`
- `tipo` (enum: ARANCEL_TEC | TASA_SERVICIOS | IMESI | IVA_IMPORTACION |
  ANTICIPO_IVA | ANTICIPO_IRAE | RECARGO | OTRO)
- `baseImponible`, `tasa` (informativa), `monto` (pesos, centésimos)
- `recuperable` (bool) — **clave para el costeo**: IVA importación, anticipo IVA
  y anticipo IRAE son recuperables (crédito fiscal / pago a cuenta) y **no**
  integran el costo; el resto es costo.

### `GastoImportacion` (gastos de plaza)
- `id`, `importacionId`
- `concepto` (HONORARIOS_DESPACHANTE | DEPOSITO | MOVILIZACION | GASTOS_BANCARIOS
  | FLETE_INTERNO | SEGURO_LOCAL | OTRO)
- `monto` (pesos), `gravadoIva` (bool), `ivaGasto` (crédito fiscal del gasto)

## 4. Costeo de la mercadería (fórmula Uruguay)

```
CIF            = FOB + flete internacional + seguro
costoMercadería = CIF
                + Σ tributos NO recuperables (arancel/TEC, tasas, IMESI, recargos)
                + Σ gastos de plaza (sin su IVA)
crédito fiscal IVA = IVA importación + IVA de los gastos de plaza
anticipos          = anticipo IVA + anticipo IRAE   (pagos a cuenta)
```

- El **IVA importación y los anticipos NO son costo** → van a cuentas de crédito
  fiscal / pagos a cuenta.
- **Prorrateo a ítems** (si se cargaron): `costoItem = costoMercadería ×
  (fobItem / fobTotal)`. El redondeo de centésimos se ajusta en el último ítem
  para que la suma cuadre exactamente con `costoMercadería`.

## 5. Crédito fiscal DGI

Salida por empresa y por mes: suma de `IVA_IMPORTACION` + IVA de gastos
(crédito fiscal del período) y de `ANTICIPO_IVA` / `ANTICIPO_IRAE` (pagos a
cuenta). Alimenta las declaraciones de DGI del cliente. Se reporta por fecha de
nacionalización (fecha del DUA).

## 6. Asiento contable

Asiento tipo de una importación nacionalizada (se adapta al plan de cuentas /
centro de costos del cliente, como el asiento de sueldos ya existente):

| Cuenta | Debe | Haber |
|---|---|---|
| Mercaderías / Inventario (costoMercadería) | X | |
| IVA compras — crédito fiscal (IVA imp. + IVA gastos) | X | |
| Anticipos IVA / IRAE a cuenta | X | |
| Proveedores del exterior (FOB) | | X |
| Despachante / acreedores (tributos + gastos pagados) | | X |
| Banco (si se pagó al contado) | | X |

Reusa el enfoque del "Asiento contable" de Reportes (apertura por cuenta/centro
de costos).

## 7. Importador del archivo del despachante ⚠️ BLOQUEANTE

La opción elegida es **importar un archivo**, pero el formato lo define el
software del despachante / el export del DUA (Lucía/VUCE). No hay un estándar
único. Para construir el parser se necesita:

1. **Una muestra real** de 1–2 archivos tal como los entrega el despachante del
   cliente (puede ser PDF del DUA, Excel/CSV de liquidación de tributos, o un
   texto plano del sistema del despachante).
2. Saber **qué sistema** usa el despachante (ej.: SOFIA, sistemas propios, el
   export de Lucía).

Según el formato:
- **Excel/CSV** → parser con auto-mapeo de columnas (igual que el de personas).
- **PDF del DUA** → extracción de texto / tabla (como ya se hizo con recibos GNS).
- **Texto plano estructurado** → parser por registros (como la nómina ATYR).

Mientras tanto, la **carga manual** cubre todo el flujo y el importador se suma
en una segunda etapa sin cambiar el modelo.

## 8. Integración con el sistema actual

- **Empresa** = mismo modelo `Company` (multiempresa). Nuevo flag/menú no rompe
  Sueldos ni Tareas.
- **Accesos**: `assertCompanyAccess` en todo endpoint por `:id`; roles
  ADMIN/OPERATOR.
- **Auditoría**: `recordAudit` en crear/editar/cambiar estado/anular.
- **Migraciones**: SQL a mano idempotente en
  `backend/prisma/migrations/<ts>_importaciones/migration.sql`.
- **Frontend**: nueva página `ImportacionesPage` + ítem de menú; estética AsysTax.
- **Dinero**: centésimos `BigInt`, serializado a string.

## 9. Plan de implementación por etapas

1. **Etapa 1 — Modelo + CRUD manual.** Schema Prisma + migración; endpoints
   CRUD con tenancy; página de alta/edición con cabezal, ítems, tributos y
   gastos; cálculo de costeo y prorrateo en vivo. (No depende del archivo.)
2. **Etapa 2 — Salidas.** Ficha de costeo (PDF), reporte de crédito fiscal del
   mes, asiento contable. Estados y seguimiento.
3. **Etapa 3 — Importador de archivo** del despachante (requiere la muestra, §7).

## 10. Decisiones abiertas

- [ ] **Formato real del archivo del despachante** (muestra + sistema). ← lo
      primero para la Etapa 3; no bloquea Etapas 1–2.
- [ ] ¿El plan de cuentas del asiento es fijo o configurable por empresa?
- [ ] ¿Alcanza con régimen DEFINITIVA al inicio o hay que soportar admisión
      temporaria desde el día uno?
- [ ] ¿Hace falta manejar varias monedas en una misma operación o una sola por
      importación?
- [ ] ¿Se necesita adjuntar los documentos (factura, BL, DUA) al registro
      (storage de adjuntos ya existe en el sistema)?

## Etapa de LECTURA Y CONCILIACIÓN (expediente multi-documento)

Ampliación pedida 16/10/2026: el expediente (la `Importacion`) pasa a tener
MUCHOS documentos clasificados y extraídos con trazabilidad, más un motor de
conciliación. Decisiones: extracción con **IA (Claude) + reglas** (requiere
`ANTHROPIC_API_KEY` en el server; cae a reglas si falta) y **OCR** con
tesseract.js para escaneados. NO incluye asientos ni cálculo fiscal (ya
existen de etapas previas y quedan aparte).

Sub-etapas (se entregan de a una):
1. **HECHO** — Modelo `importacion_documentos` (archivo original + SHA-256 +
   tipo + estado + páginas) y subida MÚLTIPLE con drag-drop, anti-duplicado por
   hash, conteo de páginas y panel de Documentos en la ficha del expediente.
2. Clasificación automática del tipo de documento (14 tipos) + override manual.
3. Extracción estructurada por tipo (factura con artículos, DUA, liquidación,
   SWIFT/banco) con trazabilidad por dato (doc, página, región, valor original
   vs normalizado, confianza, estado) + pestaña Datos extraídos editable.
4. Motor de conciliación (6 controles) + estados Conciliado/Revisar/Pendiente +
   pestañas Conciliación/Observaciones.
5. Aprobar + historial de cambios + pestaña Resumen + visor con salto al origen.
6. Tests con el caso MARPOLOS URUGUAY SAS.

Caso de prueba MARPOLOS (criterios de aceptación en el pedido): FOB 4.838,44 ·
flete 760,40 · seguro 30,00 · CIF 5.628,84 · 2 transferencias (3.000,00 +
2.628,98) · comisiones 80,00 · diferencia 0,14 · carpeta 105523/2026 ·
liquidación $96.137 · IVA imp. $49.843 · IVA ant. $22.656 · IVA gastos $1.804 ·
USD 155 informados aparte · 33 artículos. Requiere los 6 PDF reales.

## Etapa 2 (contable/fiscal) — progreso

Secuencia elegida: **fundación primero**.
- **HECHO §3** — Configuración fiscal y contable por empresa (`importacion_empresa_config`):
  régimen (IRAE/IVA/CEDE/formulario DGI/actividad/% deducción), marco contable
  (normas, método de costeo, política de distribución, monedas, cierre) y
  **plan de cuentas configurable** (mapa canónico → código+nombre, 16 cuentas).
  Pantalla "Configuración" en el módulo. Los **asientos y la ficha de costeo ya
  usan las cuentas configuradas** (si no hay config, usan los nombres por defecto).
Pendiente (próximas sub-etapas): §6 motor de cotizaciones (tipos + BCU/manual +
trazabilidad) · §4/§8 motor de reglas contables versionado + estados de asiento
(borrador/aprobado/contabilizado/revertido) y validaciones · §5 costo de
adquisición con clasificación configurable · §12 distribución por artículo
(varios criterios) · §9/§10 IVA/IRAE · §11 mapeo DGI 2178 versionado · §13 cuadro
de conciliación · §15 panel "Contabilidad e impuestos" (5 pestañas) · §17 tests
MARPOLOS. Varias dependen de completar la extracción de Etapa 1 (transferencias,
33 artículos, aprobación).

- **HECHO §6** — Motor de cotizaciones: tabla `cotizaciones` global (fecha /
  moneda / tipo: contable·aduanero·bancario·anticipo·obligación·cierre) con
  valor + compra/venta + fuente + trazabilidad (fecha de consulta, usuario).
  Toma automática del **BCU** por web service SOAP oficial (validado: USD/EUR,
  TCC/TCV) y carga manual; no se inventan cotizaciones (si el BCU no tiene dato,
  avisa y se carga a mano). Pantalla "Cotizaciones" en el módulo.
