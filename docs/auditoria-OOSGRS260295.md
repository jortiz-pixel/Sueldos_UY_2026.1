# Auditoría del expediente OOSGRS260295 — STX Stainless Steel S.A.

**Operación:** compra en China (Shanghai Yizhuang Metal) → **tránsito aduanero por Uruguay** → re-exportación a Brasil (SteelDek Aço Inoxidável Ltda.).
**Régimen:** tránsito (no nacionaliza en Uruguay). **Despachante:** MAP / Estudio Pacini. **Agente de carga:** Savino del Bene Uruguay S.A.
**Dictamen:** **EXPEDIENTE NO APROBADO.** Subsisten errores de cronología/moneda, una inconsistencia de inventario y tratamientos tributarios (IRAE/IVA) que requieren determinación y validación. Ver §10.

---

## Datos del expediente (verificados contra la documentación original)

| Concepto | Valor | Fuente |
|---|---:|---|
| FOB proveedor (2 facturas) | **USD 259.473,34** | YZ20251105D-1 (129.651,99) + D-2 (129.821,35) |
| Pagos al proveedor (SWIFT) | USD 235.845,34 | ref. 495339 (22.003,34) + 495338 (213.842,00), 08/05/2026 |
| Saldo pendiente proveedor | USD 23.628,00 | = anticipo 10% a cancelar |
| Venta de exportación (10 e-facturas) | **USD 304.431,38** | STX → SteelDek, serie A 203–212 |
| BL a bordo (transferencia de control FOB) | **09/02/2026** | XMNS013336 / XMNS013337 |

### 10 DUA de tránsito — carpetas y valor (1 camión = 1 DUA = 1 venta)

| # | DUA | Carpeta | Valor U$S | Ref. cliente |
|--:|---|---|---:|---|
| 1 | 779.792 | 104147/2026 | 32.116,37 | S/A I 0441/26 |
| 2 | 779.794 | 104417/2026 | 29.313,40 | S/A I 0444/26 |
| 3 | 779.795 | 104416/2026 | 30.170,02 | S/A I 0443/26 |
| 4 | 779.798 | 104414/2026 | 30.119,36 | S/A I 0444/26 |
| 5 | 779.799 | 104411/2026 | 30.397,27 | S/A I 0445/26 |
| 6 | 780.343 | 104437/2026 | 30.976,89 | STX25-002-208 |
| 7 | 780.344 | 104438/2026 | 30.676,83 | STX25-002-209 |
| 8 | 780.356 | 104439/2026 | 28.961,60 | STX25-002-210 |
| 9 | 780.357 | 104440/2026 | 31.036,78 | STX25-002-211 |
| 10 | 780.359 | 104441/2026 | 30.662,86 | STX25-002-212 |
| | | **Total** | **304.431,38** | = total exportado |

> El total de los DUA coincide **exactamente** con el total de las 10 e-facturas de exportación: cada DUA/carpeta corresponde a un camión y a una venta a SteelDek. Esto habilita la trazabilidad mercadería → tránsito → venta → costo de ventas (§7).

---

## §1 · Clasificación aduanera — TRÁNSITO ✅ (con vinculación de DUA pendiente en el sistema)

La operación es **tránsito aduanero** (Código Aduanero, Ley 19.276): mercadería extranjera que circula bajo control sin nacionalizar. Los 20 comprobantes del despachante declaran **"TIPO OPERACIÓN: TRÁNSITO · DESDE Puerto MVD · HASTA Rio Branco · terrestre"**. El sistema ya detecta el régimen correctamente.

**Corrección pendiente en el sistema:** extraer y **vincular los 10 DUA y sus carpetas** (hoy no se listan; el número de DUA del cabezal toma la referencia del seguro, no los DUA reales). Debe mostrarse la tabla de DUA/carpetas y ligar cada una a su venta.

## §2 · FOB / CIF / costo contable — sin duplicación ✅ (etiquetado a mejorar)

- **FOB** (precio de compra, factura del proveedor) = USD 259.473,34. Las facturas son **FOB** (sin flete ni seguro adentro).
- **Flete internacional y seguro** vienen por el agente de carga (Savino), **no** en la factura → **no hay duplicación**. Se verificó que el flete marítimo (Savino) se cuenta una sola vez, como gasto atribuible.
- **No existe "CIF aduanero"** con tributos: en tránsito no hay valor en aduana gravado.

**Corrección de etiquetado:** el informe rotula "Flete internacional" en 0 (lo toma de la factura FOB) y el flete real aparece recién como "gasto de plaza". Debe mostrarse el **flete/seguro de Savino dentro del CIF** (FOB + flete + seguro = CIF de llegada) para que el valor sea legible, sin cambiar el total.

## §3 · Cronología y moneda extranjera — ERROR (a corregir)

**Problema:** el costo valúa toda la adquisición al TC de los **pagos del 08/05/2026** (TC 39,747), pero la compra se reconoce con la **transferencia de control**, no con el pago.

**Criterio correcto (NIC 2 / NIC 21):**
1. **Fecha de reconocimiento = transferencia de control.** En **FOB** el riesgo/control pasa al cargar la mercadería en origen → **fecha a bordo del BL = 09/02/2026**. La adquisición se reconoce a esa fecha, al TC de ese día.
2. **Anticipo (10%):** partida **no monetaria** (NIC 21) → se fija al TC de su fecha de pago y **no se reajusta**.
3. **Saldo (90%):** pasivo monetario reconocido al 09/02/2026 y cancelado el 08/05/2026 → la **diferencia de cambio entre ambas fechas es resultado financiero, NO costo** ([NIC 2: las diferencias de cambio no se capitalizan](https://www.gub.uy/ministerio-economia-finanzas/institucional/normativa/norma-internacional-contabilidad-2-nic-2)).

**Hoy el sistema capitaliza esa diferencia de cambio** (valúa el 90% al TC de mayo). Debe: reconocer al TC del 09/02/2026 y llevar la diferencia 09/02→08/05 a *Diferencia de cambio* (resultado), separada del costo histórico.

**Dato pendiente:** cotización BCU USD del **09/02/2026** (fecha a bordo del BL) para el costo; y de cada fecha de pago para la diferencia de cambio.

## §4 · Conciliación de la diferencia de $41.838,70 — IDENTIFICADA

La diferencia entre *(adquisición + gastos)* y el *costo total* es **$41.838,70 = IVA del despachante** (1.045 USD × TC 40,037). Hoy ese IVA se **capitaliza** al costo (criterio "IVA irrecuperable") y a la vez figura como "crédito fiscal" en otra sección → **contradicción**. Se resuelve con §5: si el IVA es **recuperable**, sale del costo y la diferencia desaparece (costo = adquisición + gastos netos). Las tres igualdades de consistencia deben seguir cerrando en $0,00.

## §5 · Tratamiento del IVA de servicios — a corregir (no es automáticamente irrecuperable)

El sistema capitaliza el IVA del despachante como irrecuperable. **Es incorrecto como regla automática.** La venta de STX a Brasil es una **exportación de bienes**: el exportador **recupera el IVA** que integra el costo del bien exportado ([art. 14 Título 10 T.O. 2023](https://www.impo.com.uy/bases/todgi-2023/10-2024); art. 129 Dec. 220/998).

**Determinación:** si la venta califica como **exportación** → el IVA de los servicios del despachante que integra el costo es **crédito fiscal recuperable** (no costo). Solo sería costo si la operación fuera **no comprendida / exenta sin derecho a crédito**.
**→ Para esta operación (exportación a Brasil): IVA del despachante = CRÉDITO RECUPERABLE.** El sistema debe dejar de capitalizarlo por defecto y permitir el encuadre según la actividad.

> Nota: Savino (flete/transporte internacional) factura **no gravado** → sin IVA. El IVA en juego es solo el de los honorarios/gastos operativos de MAP.

## §6 · Facturas del despachante — moneda USD, partidas separadas, recibo duplicado

- **Moneda USD** conservada ✅ (corregido: Savino y MAP ahora se leen en USD).
- **Partidas separadas** ✅: honorarios (gravado 22%), gastos operativos (gravado), IVA, y **reembolsos por cuenta de terceros** (guía de tránsito, tasa escáner, timbre, precintos — no facturables).
- **Recibo A0036858 (US$ 3.216) DUPLICADO** (aparece en p42 y p43). Carpetas afectadas: **104147/2026 (1.607,50) + 104146/2026 (1.608,50)**. **Debe contabilizarse UNA sola vez** (3.216, no 6.432) y distribuirse entre esas carpetas.
- **Dato pendiente:** la carpeta **104146/2026** aparece en el recibo pero **no** tiene e-factura de honorarios entre las 10 → falta un comprobante o es una carpeta adicional a conciliar.

## §7 · Ventas y costo de ventas — reconocer CMV, no dejar la mercadería en tránsito indefinidamente

Hay **10 e-facturas de exportación** a SteelDek por **USD 304.431,38**, una por DUA/camión (ver tabla §datos). El sistema hoy acumula el costo en *Importaciones en trámite* y **lo deja ahí**. Correcto para el tránsito, pero **al entregarse la mercadería (exportación) debe reconocerse el Costo de Mercadería Vendida**: asiento *Costo de ventas a Mercadería en tránsito* por las unidades despachadas, vinculando cada DUA con su venta. No deben quedar en tránsito bienes ya vendidos.

**Margen bruto preliminar:** venta 304.431,38 − costo 304.496 (contable) ≈ **−65 USD**. La operación se vende prácticamente **a costo** (el margen comercial, si lo hay, está en el precio FOB o es nulo). Esto es relevante para el IRAE (§8).

## §8 · IRAE — evaluar PRIMERO la exoneración del art. 66 lit. I) Título 4

**Prioridad 1 — Exoneración art. 66 lit. I) T.O. 2023** (ex art. 52) ([texto](https://www.impo.com.uy/bases/todgi2023/101-2024/66_T4)): exonera las **enajenaciones de mercadería extranjera manifestada en tránsito** (o depositada en exclaves) **sin origen ni destino en territorio aduanero nacional**. La mercadería de STX es de **origen China** y **destino Brasil**, en tránsito → **la venta encuadraría como EXONERADA de IRAE**, con tolerancia del 5% para eventuales ventas al mercado interno.
**A validar (pendiente de criterio / consulta DGI):** el beneficio está pensado para actividad **en el exclave** (recinto, puerto, depósito, zona franca); acá hay **tránsito terrestre fuera del recinto** (MVD→Rio Branco). La DGI mantiene la exoneración por actividades fuera del recinto **no vinculadas a la manipulación** de la mercadería, pero no por actividad logística. Debe confirmarse el encuadre.

**Prioridad 2 — Si no aplica la exoneración:** régimen ficto de trading **Res. DGI 51/997** (renta neta de fuente uruguaya = 3% de la diferencia precio de venta − precio de compra; IRAE 25%).
**Prioridad 3 — Régimen general** (renta real).

**Error a corregir:** el sistema calcula hoy el **ficto 51/997 directamente** sobre el margen, sin evaluar primero la exoneración del art. 66 lit. I). Debe invertirse el orden: **exoneración → 51/997 → general**, y **no** calcular IRAE automático sobre el margen contable total. (Con margen ≈ 0, incluso el ficto da casi nulo; pero la exoneración, si aplica, es el encuadre correcto.)

## §9 · Validación de inventario — INCONSISTENCIA de grado (bloqueante)

**Inconsistencia confirmada:** las dos facturas comerciales declaran grado **439**; el packing list de la 1.ª (D-1) declara **439** ✓, pero el **packing list de la 2.ª (D-2) declara grado 430** ✗. El grado 430 y el 439 son aceros inoxidables **distintos**.

**Acción:** reconciliar grado, cantidades por **espesor / bobina / lote (batch) / venta / despacho**. Hasta aclararlo (¿error de tipeo del packing D-2, o mercadería realmente 430?), el inventario **no está validado**. Dato pendiente: confirmación del proveedor.

## §10 · Dictamen y pendientes

**EXPEDIENTE NO APROBADO** hasta resolver:

| # | Ítem | Estado |
|--:|---|---|
| 3 | Cronología/moneda: reconocer al control (BL 09/02), separar diferencia de cambio del costo | ❌ corregir en sistema + cotización BCU 09/02 |
| 4 | Diferencia $41.838,70 (IVA despachante) y contradicción entre secciones | ⚠️ se resuelve con §5 |
| 5 | IVA despachante = crédito recuperable (export), no capitalizar | ❌ corregir en sistema |
| 6 | Recibo A0036858 duplicado → contabilizar una vez; carpeta 104146 faltante | ❌ corregir + dato pendiente |
| 7 | Reconocer CMV contra las 10 ventas; no dejar vendido en tránsito | ❌ falta el asiento de costo de ventas |
| 8 | IRAE: evaluar exoneración art. 66 lit. I) primero | ❌ corregir orden + validar encuadre (consulta DGI) |
| 9 | Inconsistencia de inventario 439 vs 430 (packing D-2) | ❌ reconciliar con el proveedor |
| 1,2 | Vincular DUA/carpetas; mostrar flete/seguro en CIF | ⚠️ mejora de presentación |

**Datos pendientes expresos:** (a) cotización BCU USD del 09/02/2026; (b) carpeta 104146/2026 (comprobante faltante); (c) confirmación grado 430/439 del proveedor; (d) criterio/consulta DGI sobre la exoneración art. 66 lit. I) para tránsito terrestre; (e) confirmación del estudio sobre recuperabilidad del IVA.

**Correcto hoy (validado):** régimen tránsito; FOB consolidado 259.473,34; lectura de todos los comprobantes (factura china en inglés, Savino/MAP en USD, SWIFT); pagos al proveedor; consistencia aritmética costo = artículos = asientos (una vez resuelto el IVA de §4/§5).

## Correcciones aplicadas en el sistema (iteración actual)

| # | Corrección en código | Estado |
|--:|---|---|
| 4,5 | IVA del despachante/agencia = **crédito recuperable** (venta de exportación, art. 14 Tít. 10): sale del costo por defecto. Interruptor `ivaServiciosRecuperable=false` para el caso NO comprendido. La diferencia de $41.838,70 se disuelve. | ✅ hecho |
| 8 | Informe de IRAE: evalúa **primero** la exoneración del art. 66 lit. I) Tít. 4; ficto 51/997 y régimen general quedan **subsidiarios**. | ✅ hecho |
| 3 | Reconocimiento **al control (BL a bordo = fecha embarque)** valuado al TC de ese día; la **diferencia de cambio** contra el TC de los pagos se separa a Resultado (NIC 21/2), no integra el costo. Asiento de reconocimiento con línea "Diferencias de cambio". Se activa al cargar la **fecha de embarque**; si falta la cotización de ese día, el costo queda **provisional** y se avisa. | ✅ mecanismo hecho — falta **cotización BCU 09/02/2026** |
| 7 | Asientos de **Venta de exportación** + **Costo de Mercadería Vendida**: el costo sale de «Importaciones en trámite» (queda **saldada**) y se imputa a CMV contra la venta. La verificación de consistencia incluye CMV. | ✅ hecho |

**Pendiente (datos / criterio, no código):** (a) cotización BCU USD del 09/02/2026 para fijar el costo y la diferencia de cambio; (b) carpeta 104146/2026 (comprobante faltante) y dedup del recibo A0036858 en la vista de carpetas; (c) confirmación grado 430/439 del proveedor; (d) consulta DGI sobre la exoneración art. 66 lit. I) para tránsito terrestre; (e) vinculación/listado de los 10 DUA y carpetas en el informe (§1).

> Con la fecha de embarque y las cotizaciones cargadas, el expediente recalcula solo: reconocimiento al control, diferencia de cambio separada, IVA como crédito, y costo imputado a CMV contra las 10 ventas. El dictamen sigue **NO APROBADO** hasta cerrar los datos pendientes (a)–(e).
