/**
 * COSTO FISCAL DE ADQUISICIÓN (IRAE) — motor SEPARADO del contable.
 *
 * No altera el costeo contable ni los asientos: toma el resultado contable ya
 * calculado y determina, en forma independiente, el costo fiscal de adquisición
 * de cada artículo según la normativa IRAE vigente, dejando la valuación de
 * EXISTENCIAS AL CIERRE (plaza, etc.) para otro momento, y la producción /
 * personalización para otro módulo.
 *
 * Normas aplicadas (ver NORMAS_IRAE, actualizable sin tocar el motor):
 *  - Art. 42 Tít. 4 TO 2023 — renta bruta por enajenación de bienes = ventas
 *    netas − costo de adquisición/producción.
 *  - Art. 80 Dec. 150/007 — valuación de existencias: a opción del contribuyente
 *    (adquisición / producción / plaza), uniforme; el costo de ADQUISICIÓN suma al
 *    precio de compra los gastos hasta poner el bien en condiciones de venta. El
 *    cambio de método requiere autorización de la DGI.
 *  - Art. 74 Dec. 150/007 — moneda extranjera: cotización interbancaria tipo
 *    COMPRADOR billete del cierre del DÍA ANTERIOR a la operación (arbitraje si no
 *    cotiza; último día hábil anterior si no hay cotización). NO es el TC del DUA,
 *    ni el bancario aplicado, ni el contable de los anticipos.
 *  - Arts. 30 y 31 Tít. 4 — admisibilidad de gastos (devengados, documentados).
 *
 * Principio de prudencia: si la política fiscal de la empresa no está validada, o
 * falta una cotización fiscal, el costo fiscal se emite como PENDIENTE (no se usa
 * el contable como valor fiscal por defecto ni se aplican criterios de NIC 21).
 */
import { TributoImportacionTipo } from '@prisma/client';

// ── Catálogo de normas (datos; se puede actualizar sin reprogramar el motor) ──
export interface NormaIrae { codigo: string; norma: string; articulo: string; descripcion: string; fuente: string; vigenciaDesde: string }
export const NORMAS_IRAE: Record<string, NormaIrae> = {
  RENTA_BRUTA: { codigo: 'RENTA_BRUTA', norma: 'Título 4 TO 2023', articulo: 'Art. 42', descripcion: 'Renta bruta por enajenación de bienes = ventas netas − costo de adquisición o producción.', fuente: 'https://www.impo.com.uy/bases/todgi-2023/4-2024', vigenciaDesde: '2023-01-01' },
  VALUACION_EXISTENCIAS: { codigo: 'VALUACION_EXISTENCIAS', norma: 'Decreto 150/007', articulo: 'Art. 80', descripcion: 'Valuación de existencias a método uniforme (adquisición/producción/plaza). Costo de adquisición = precio de compra + gastos hasta poner los bienes en condiciones de venta. Cambio de método con autorización DGI.', fuente: 'https://www.impo.com.uy/bases/decretos/150-2007/80', vigenciaDesde: '2007-04-26' },
  MONEDA_EXTRANJERA: { codigo: 'MONEDA_EXTRANJERA', norma: 'Decreto 150/007', articulo: 'Art. 74', descripcion: 'Moneda extranjera: cotización interbancaria tipo comprador billete del cierre del día anterior a la operación; arbitraje si no cotiza; último día hábil anterior si no hay cotización.', fuente: 'https://www.impo.com.uy/bases/decretos/150-2007/74', vigenciaDesde: '2007-04-26' },
  ADMISIBILIDAD_GASTOS: { codigo: 'ADMISIBILIDAD_GASTOS', norma: 'Título 4 TO 2023', articulo: 'Arts. 30-31', descripcion: 'Admisibilidad de gastos: devengados en el ejercicio, necesarios para obtener y conservar la renta gravada y debidamente documentados.', fuente: 'https://www.impo.com.uy/bases/todgi-2023/4-2024', vigenciaDesde: '2023-01-01' },
  VALUACION_CIERRE: { codigo: 'VALUACION_CIERRE', norma: 'Decreto 150/007', articulo: 'Arts. 80-82', descripcion: 'Valuación de existencias AL CIERRE (costo de plaza / últimas compras, mercaderías fuera de moda). Concepto distinto del costo de adquisición de ingreso; no se aplica automáticamente a cada importación.', fuente: 'https://www.impo.com.uy/bases/decretos/150-2007/80', vigenciaDesde: '2007-04-26' },
  IVA_CREDITO: { codigo: 'IVA_CREDITO', norma: 'Título 10 / Decreto 220/998', articulo: 'IVA', descripcion: 'El IVA recuperable (crédito fiscal) y los anticipos de impuestos NO integran el costo; el IVA no recuperable (actividades exentas/prorrata) sí lo integra.', fuente: 'https://www.impo.com.uy', vigenciaDesde: '1998-01-01' },
};

// ── Entrada del motor (pura: el wiring arma estos datos) ──────────────────────
export interface GastoContableFiscal {
  documento: string; concepto: string; moneda: string; fecha?: string | null;
  montoME: number; montoUYU: bigint; incluidoEnCosto: boolean; esDelDespachante: boolean;
}
export interface ArticuloFiscal { codigo: string | null; descripcion: string; cantidad: number; unidad?: string | null; fobME: bigint }
export interface CostoFiscalConfig {
  validado: boolean;
  metodoValuacionInventario?: string | null; // ADQUISICION | PRODUCCION | PLAZA
  criterioMonedaExtranjera?: string | null;   // ART74_INTERBANCARIO_COMPRADOR_DIA_ANTERIOR | PERSONALIZADO
  criterioFechaOperacion?: string | null;      // NACIONALIZACION | FACTURA | PAGO
  tratamientoIva?: string | null;              // RECUPERABLE_TOTAL | NO_RECUPERABLE | PRORRATA
  porcentajeIvaNoRecuperable?: number | null;  // 0..100 (si PRORRATA)
  politicaDistribucion?: string | null;        // FOB (por defecto) | PESO | CANTIDAD | ...
}
export interface CostoFiscalInput {
  // Resultado CONTABLE (no se modifica; solo se lee).
  contable: {
    adquisicionUYU: bigint; tributosNoRecuperables: bigint; totalGastosUYU: bigint; costoInventario: bigint | null;
    ivaImportacion: bigint; ivaGastosUYU: bigint;
    anticipos: Array<{ fecha: string | null; montoME: number }>;
    excesoPagado: { me: number; uyu: bigint } | null;
    saldoNoAnticipado: { me: number; uyu: bigint } | null;
    gastos: GastoContableFiscal[];
    tributos: Array<{ tipo: TributoImportacionTipo; monto: bigint; recuperable: boolean; codigo: string }>;
    items: Array<{ codigo: string | null; descripcion: string; cantidad: number; fobME: bigint; costo: bigint }>;
    cifME: number; monedaOrigen: string;
  };
  factura: { numero: string | null; fecha: string | null; articulos: ArticuloFiscal[] } | null;
  fechas: { nacionalizacion: string | null; factura: string | null };
  duaNumero: string | null;
  config: CostoFiscalConfig | null;
  // Cotización fiscal (Art. 74) por fecha de operación: interbancario COMPRADOR billete
  // del día hábil ANTERIOR. Devuelve null si no se consiguió (→ pendiente). El wiring
  // la calcula y la pasa resuelta; el motor es puro.
  cotizacionFiscal: (fechaOperacionISO: string) => { valor: number; fuente: string } | null;
}

export interface ItemCostoFiscal {
  codigo: string | null; descripcion: string; cantidad: number; unidad: string | null;
  factura: string | null; dua: string | null;
  fobME: string; participacion: number; // participación en el FOB (0..1)
  costoContableTotal: string; costoContableUnit: string;
  costoFiscalTotal: string | null; costoFiscalUnit: string | null;
  diferencia: string | null; // contable − fiscal (ctms)
  metodoAsignacion: string;
}
export interface ComponenteFiscal { clave: string; etiqueta: string; montoUYU: string | null; norma: string; nota: string; estado: 'incluido' | 'excluido' | 'pendiente' | 'revisar' }
export interface AjusteConciliacion { concepto: string; signo: '+' | '-'; montoUYU: string; norma: string; justificacion: string }
export interface CostoFiscalResultado {
  estado: 'OK' | 'PENDIENTE';
  definitivo: boolean;
  motivos: string[];
  criterios: { monedaExtranjera: string; fechaOperacion: string; fechaFiscalOperacion: string | null; metodoValuacion: string; tratamientoIva: string };
  componentes: ComponenteFiscal[];
  items: ItemCostoFiscal[];
  totales: { costoContable: string; costoFiscal: string | null; diferencia: string | null };
  conciliacion: { costoContable: string; ajustes: AjusteConciliacion[]; costoFiscal: string | null; cuadra: boolean };
  normas: NormaIrae[];
  cotizacionesUsadas: Array<{ fecha: string; valor: number; fuente: string }>;
  observaciones: string[];
}

const S = (b: bigint | null): string | null => (b == null ? null : b.toString());
const cents = (me: number, tc: number): bigint => BigInt(Math.round(me * tc * 100));

/** Fecha fiscal de la operación según el criterio (Art. 74 "día de la operación"). */
export function resolverFechaFiscalOperacion(criterio: string | null | undefined, fechas: { nacionalizacion: string | null; factura: string | null }, anticipos: Array<{ fecha: string | null }>): string | null {
  switch (criterio) {
    case 'NACIONALIZACION': return fechas.nacionalizacion ?? fechas.factura ?? null;
    case 'FACTURA': return fechas.factura ?? fechas.nacionalizacion ?? null;
    case 'PAGO': return anticipos.find((a) => a.fecha)?.fecha ?? fechas.nacionalizacion ?? null; // referencia (cada anticipo usa la suya)
    default: return null;
  }
}

/**
 * Determina el costo fiscal de adquisición por artículo, separado del contable.
 * Si la config no está validada o falta una cotización fiscal → PENDIENTE (no se
 * emiten importes fiscales definitivos ni se usa el contable como valor fiscal).
 */
export function construirCostoFiscalAdquisicion(input: CostoFiscalInput): CostoFiscalResultado {
  const { contable, factura, fechas, duaNumero, config, cotizacionFiscal } = input;
  const motivos: string[] = [];
  const observaciones: string[] = [];
  const cotUsadas = new Map<string, { fecha: string; valor: number; fuente: string }>();
  const usarCot = (fechaOp: string | null): { valor: number; fuente: string } | null => {
    if (!fechaOp) { motivos.push('No se pudo determinar la fecha fiscal de la operación.'); return null; }
    const c = cotizacionFiscal(fechaOp);
    if (!c) { motivos.push(`Falta la cotización fiscal (Art. 74: interbancario comprador, día anterior) para la operación del ${fechaOp}.`); return null; }
    cotUsadas.set(`${fechaOp}`, { fecha: fechaOp, valor: c.valor, fuente: c.fuente });
    return c;
  };

  const criterioME = config?.criterioMonedaExtranjera ?? null;
  const criterioFecha = config?.criterioFechaOperacion ?? null;
  const metodo = config?.metodoValuacionInventario ?? null;
  const tratIva = config?.tratamientoIva ?? null;
  const fechaFiscalOp = resolverFechaFiscalOperacion(criterioFecha, fechas, contable.anticipos);

  // ── Condiciones para emitir un costo fiscal DEFINITIVO ──
  if (!config) motivos.push('No hay configuración fiscal (IRAE) para la empresa: definila antes de emitir un costo fiscal definitivo.');
  else {
    if (!config.validado) motivos.push('La configuración fiscal de la empresa no está validada por un profesional.');
    if (!metodo) motivos.push('Falta definir el método de valuación fiscal de inventarios (Art. 80 Dec. 150/007).');
    else if (metodo !== 'ADQUISICION') motivos.push(`El método fiscal adoptado es "${metodo}": este módulo determina el COSTO DE ADQUISICIÓN de ingreso; la valuación al cierre por otro método se calcula aparte.`);
    if (!criterioME) motivos.push('Falta definir el criterio de moneda extranjera (Art. 74 Dec. 150/007).');
    if (!criterioFecha) motivos.push('Falta definir la fecha fiscal de la operación (nacionalización / factura / pago).');
    if (!tratIva) motivos.push('Falta definir el tratamiento del IVA (recuperable / no recuperable / prorrata).');
  }
  if (!factura) motivos.push('Falta la factura comercial para distribuir el costo por artículo.');

  // Si faltan definiciones base, no se calcula un importe fiscal (pendiente).
  const puedeCalcular = !!config && config.validado && metodo === 'ADQUISICION' && !!criterioME && !!criterioFecha && !!tratIva && !!factura;

  // ── Componente A: precio fiscal de la mercadería (CIF) valuado por Art. 74 ──
  let mercaderiaFiscalUYU: bigint | null = null;
  if (puedeCalcular) {
    if (criterioFecha === 'PAGO') {
      // Cada anticipo a la cotización fiscal del día de su pago; el saldo no anticipado
      // a la del reconocimiento. Se excluye el exceso pagado sobre el CIF (no es costo).
      let restanteCifME = contable.cifME;
      let acum = 0n; let ok = true;
      for (const a of contable.anticipos) {
        if (restanteCifME <= 0.00001) break;
        const aplicME = Math.min(restanteCifME, a.montoME);
        restanteCifME = Math.round((restanteCifME - aplicME) * 100) / 100;
        const c = usarCot(a.fecha); if (!c) { ok = false; break; }
        acum += cents(aplicME, c.valor);
      }
      if (ok && restanteCifME > 0.00001) { // saldo no anticipado
        const c = usarCot(fechas.nacionalizacion ?? fechas.factura);
        if (!c) ok = false; else acum += cents(restanteCifME, c.valor);
      }
      mercaderiaFiscalUYU = ok ? acum : null;
    } else {
      const c = usarCot(fechaFiscalOp);
      mercaderiaFiscalUYU = c ? cents(contable.cifME, c.valor) : null;
    }
  }

  // ── Componente D/E: gastos necesarios (Art. 80) re-valuados por Art. 74 si ME ──
  let gastosFiscalUYU: bigint | null = puedeCalcular ? 0n : null;
  const gastosDetalle: Array<{ documento: string; concepto: string; contableUYU: bigint; fiscalUYU: bigint | null }> = [];
  if (puedeCalcular) {
    for (const g of contable.gastos.filter((x) => x.incluidoEnCosto)) {
      let fiscalUYU: bigint | null;
      if ((g.moneda ?? 'UYU').toUpperCase() === 'UYU') fiscalUYU = g.montoUYU; // pesos: igual
      else {
        const c = usarCot(g.fecha ?? fechaFiscalOp);
        fiscalUYU = c ? cents(g.montoME, c.valor) : null;
        if (!c) gastosFiscalUYU = null;
      }
      gastosDetalle.push({ documento: g.documento, concepto: g.concepto, contableUYU: g.montoUYU, fiscalUYU });
      if (gastosFiscalUYU != null && fiscalUYU != null) gastosFiscalUYU += fiscalUYU;
      else if (fiscalUYU == null) gastosFiscalUYU = null;
    }
  }

  // ── Componente C: tributos no recuperables (pesos; idénticos al contable) ──
  const tributosFiscalUYU = contable.tributosNoRecuperables;

  // ── IVA no recuperable (si la actividad lo determina) → integra el costo ──
  let ivaNoRecuperableUYU = 0n;
  const ivaCredito = contable.ivaImportacion + contable.ivaGastosUYU;
  if (puedeCalcular) {
    if (tratIva === 'NO_RECUPERABLE') ivaNoRecuperableUYU = ivaCredito;
    else if (tratIva === 'PRORRATA') { const p = Math.min(100, Math.max(0, config?.porcentajeIvaNoRecuperable ?? 0)); ivaNoRecuperableUYU = BigInt(Math.round(Number(ivaCredito) * p / 100)); }
  }

  // ── Costo fiscal total del inventario ──
  let costoFiscalInv: bigint | null = null;
  if (puedeCalcular && mercaderiaFiscalUYU != null && gastosFiscalUYU != null) {
    costoFiscalInv = mercaderiaFiscalUYU + tributosFiscalUYU + gastosFiscalUYU + ivaNoRecuperableUYU;
  }

  const estado: 'OK' | 'PENDIENTE' = (puedeCalcular && costoFiscalInv != null && motivos.length === 0) ? 'OK' : 'PENDIENTE';

  // ── Distribución por artículo (misma clave que el contable: FOB; resto por último) ──
  const arts = factura?.articulos ?? [];
  const sumaFob = arts.reduce((s, a) => s + a.fobME, 0n);
  // Hoy la distribución es por VALOR (FOB), igual que el contable. El procedimiento de
  // existencias (PPP/última compra) es un criterio de valuación AL CIERRE, no una clave
  // de distribución del costo de ingreso; por eso no se usa como etiqueta acá.
  const metodoAsig = 'FOB (valor)';
  const contableItems = contable.items;
  const items: ItemCostoFiscal[] = [];
  let acumF = 0n;
  for (let i = 0; i < arts.length; i++) {
    const a = arts[i];
    const cont = contableItems.find((c) => (c.codigo ?? '') === (a.codigo ?? '') && c.descripcion === a.descripcion) ?? contableItems[i];
    const contTotal = cont?.costo ?? 0n;
    let fiscalTotal: bigint | null = null;
    if (costoFiscalInv != null) {
      if (sumaFob > 0n && i < arts.length - 1) { fiscalTotal = (costoFiscalInv * a.fobME) / sumaFob; acumF += fiscalTotal; }
      else fiscalTotal = costoFiscalInv - acumF;
    }
    const cant = a.cantidad || 1;
    const unit = (b: bigint) => BigInt(Math.round(Number(b) / cant));
    items.push({
      codigo: a.codigo ?? null, descripcion: a.descripcion, cantidad: a.cantidad, unidad: a.unidad ?? null,
      factura: factura?.numero ?? null, dua: duaNumero,
      fobME: a.fobME.toString(), participacion: sumaFob > 0n ? Number(a.fobME) / Number(sumaFob) : 0,
      costoContableTotal: contTotal.toString(), costoContableUnit: unit(contTotal).toString(),
      costoFiscalTotal: S(fiscalTotal), costoFiscalUnit: fiscalTotal != null ? unit(fiscalTotal).toString() : null,
      diferencia: fiscalTotal != null ? (contTotal - fiscalTotal).toString() : null,
      metodoAsignacion: metodoAsig,
    });
  }

  // ── Componentes A-F (para la ficha) ──
  const componentes: ComponenteFiscal[] = [
    { clave: 'A', etiqueta: 'Precio fiscal de adquisición de la mercadería (CIF, Art. 74)', montoUYU: S(mercaderiaFiscalUYU), norma: 'Art. 74 Dec. 150/007', estado: mercaderiaFiscalUYU != null ? 'incluido' : 'pendiente', nota: 'Mercadería valuada a la cotización fiscal (interbancario comprador, día anterior a la operación). Excluye el exceso pagado sobre el CIF.' },
    { clave: 'B', etiqueta: 'Fletes y seguros atribuibles', montoUYU: '0', norma: 'Art. 80 Dec. 150/007', estado: 'incluido', nota: 'Ya incluidos en el precio CIF facturado: no se adicionan para evitar duplicación.' },
    { clave: 'C', etiqueta: 'Tributos y derechos no recuperables', montoUYU: tributosFiscalUYU.toString(), norma: 'Art. 80 Dec. 150/007', estado: 'incluido', nota: 'Tributos del DUA que no son crédito fiscal ni anticipos; en pesos (sin conversión). Integran el costo.' },
    { clave: 'D', etiqueta: 'Gastos necesarios para poner los bienes en condiciones de venta', montoUYU: S(gastosFiscalUYU), norma: 'Art. 80 Dec. 150/007', estado: gastosFiscalUYU != null ? 'incluido' : 'pendiente', nota: 'Honorarios/gastos del despachante, terminal y agencia atribuibles; los de ME se valúan por Art. 74.' },
    { clave: 'E', etiqueta: 'IVA no recuperable incorporable', montoUYU: ivaNoRecuperableUYU.toString(), norma: 'Título 10 / Art. 80', estado: ivaNoRecuperableUYU > 0n ? 'incluido' : 'excluido', nota: tratIva === 'RECUPERABLE_TOTAL' || !tratIva ? 'IVA totalmente recuperable: no integra el costo.' : 'Parte del IVA no recuperable (actividad exenta/prorrata) integra el costo.' },
    { clave: 'F', etiqueta: 'Conceptos EXCLUIDOS o a revisar', montoUYU: null, norma: 'Art. 42 T4 / Art. 80', estado: 'excluido', nota: `IVA recuperable (${(Number(ivaCredito) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2 })}), anticipos de impuestos, comisiones bancarias y el exceso pagado sobre el CIF (${contable.excesoPagado ? `${contable.excesoPagado.me} ${contable.monedaOrigen}` : '—'}) NO integran el costo fiscal de adquisición.` },
  ];

  // ── Cuadro de conciliación contable → fiscal ──
  const base = contable.costoInventario ?? 0n;
  const ajustes: AjusteConciliacion[] = [];
  if (costoFiscalInv != null) {
    const difMerc = mercaderiaFiscalUYU! - contable.adquisicionUYU; // fiscal − contable
    if (difMerc !== 0n) ajustes.push({ concepto: 'Diferencia de cambio en la mercadería (TC fiscal Art. 74 vs TC contable de los anticipos)', signo: difMerc > 0n ? '+' : '-', montoUYU: (difMerc > 0n ? difMerc : -difMerc).toString(), norma: 'Art. 74 Dec. 150/007', justificacion: 'El costo contable valúa los anticipos al TC de pago; el fiscal valúa la mercadería al interbancario comprador del día anterior a la operación. La diferencia NO es un cambio de costo arbitrario: surge del criterio legal de conversión.' });
    const gastoContableUYU = contable.totalGastosUYU;
    const difGastos = (gastosFiscalUYU ?? 0n) - gastoContableUYU;
    if (difGastos !== 0n) ajustes.push({ concepto: 'Diferencia de cambio en gastos en moneda extranjera', signo: difGastos > 0n ? '+' : '-', montoUYU: (difGastos > 0n ? difGastos : -difGastos).toString(), norma: 'Art. 74 Dec. 150/007', justificacion: 'Gastos en ME re-valuados a la cotización fiscal de su fecha.' });
    if (ivaNoRecuperableUYU > 0n) ajustes.push({ concepto: 'IVA no recuperable incorporado al costo', signo: '+', montoUYU: ivaNoRecuperableUYU.toString(), norma: 'Título 10 / Art. 80', justificacion: 'Parte del IVA no recuperable por la actividad integra el costo fiscal.' });
  }
  const sumaAjustes = ajustes.reduce((s, a) => s + (a.signo === '+' ? 1n : -1n) * BigInt(a.montoUYU), 0n);
  const fiscalConciliado = costoFiscalInv != null ? base + sumaAjustes : null;
  const cuadra = costoFiscalInv == null ? true : fiscalConciliado === costoFiscalInv;
  if (costoFiscalInv != null && !cuadra) observaciones.push('La conciliación contable→fiscal no cierra exactamente: revisar los ajustes.');

  if (estado === 'PENDIENTE') observaciones.push('Costo fiscal PENDIENTE de aprobación: no se emite un importe definitivo hasta completar la configuración fiscal validada y las cotizaciones fiscales.');

  return {
    estado,
    definitivo: estado === 'OK',
    motivos: [...new Set(motivos)],
    criterios: {
      monedaExtranjera: criterioME ?? 'sin definir',
      fechaOperacion: criterioFecha ?? 'sin definir',
      fechaFiscalOperacion: fechaFiscalOp,
      metodoValuacion: metodo ?? 'sin definir',
      tratamientoIva: tratIva ?? 'sin definir',
    },
    componentes,
    items,
    totales: { costoContable: base.toString(), costoFiscal: S(costoFiscalInv), diferencia: costoFiscalInv != null ? (base - costoFiscalInv).toString() : null },
    conciliacion: { costoContable: base.toString(), ajustes, costoFiscal: S(fiscalConciliado), cuadra },
    normas: Object.values(NORMAS_IRAE),
    cotizacionesUsadas: [...cotUsadas.values()],
    observaciones,
  };
}
