/**
 * SERVICIO DE IMPORTACIONES (comercio exterior)
 *
 * Costeo de una importación según normativa uruguaya:
 *   CIF            = FOB + flete internacional + seguro
 *   costoMercadería = CIF + Σ tributos NO recuperables + Σ gastos de plaza (sin IVA)
 *   crédito fiscal IVA = IVA importación + IVA de los gastos
 *   anticipos          = anticipo IVA + anticipo IRAE  (pagos a cuenta)
 *
 * El IVA importación y los anticipos son recuperables: NO integran el costo.
 * Todos los montos en centésimos de peso (BigInt). Ver docs/importaciones-diseno.md.
 */
import { TributoImportacionTipo } from '@prisma/client';
import { divRoundHalfUp } from '../utils/money';
import { LineaAsiento } from './pagos.service';
import { costoMercaderiaImportada } from './importaciones.costeo.service';
import { etiquetaCuenta, PlanCuentas } from './importaciones.config.service';

/** Tributos recuperables (crédito fiscal / pago a cuenta): no integran el costo. */
export function esTributoRecuperable(tipo: TributoImportacionTipo): boolean {
  return (
    tipo === TributoImportacionTipo.IVA_IMPORTACION ||
    tipo === TributoImportacionTipo.ANTICIPO_IVA ||
    tipo === TributoImportacionTipo.ANTICIPO_IRAE
  );
}

export interface TributoInput {
  tipo: TributoImportacionTipo;
  monto: bigint;
}
export interface GastoInput {
  monto: bigint;     // neto, sin IVA
  ivaGasto: bigint;  // IVA del gasto (crédito fiscal)
}
export interface ItemCosteoInput {
  fobTotal: bigint;
}

export interface CosteoInput {
  fob: bigint;
  flete: bigint;
  seguro: bigint;
  tributos: TributoInput[];
  gastos: GastoInput[];
  items: ItemCosteoInput[];
}

export interface CosteoResultado {
  cif: bigint;
  totalTributos: bigint;
  totalGastos: bigint;
  costoMercaderia: bigint;
  creditoFiscalIva: bigint;
  anticipos: bigint;
  /** costoProrrateado por ítem, en el mismo orden que input.items. */
  costosItems: bigint[];
}

export function calcularCosteo(input: CosteoInput): CosteoResultado {
  const cif = input.fob + input.flete + input.seguro;

  let totalTributos = 0n;
  let tributosNoRecuperables = 0n;
  let ivaImportacion = 0n;
  let anticipos = 0n;
  for (const t of input.tributos) {
    totalTributos += t.monto;
    if (esTributoRecuperable(t.tipo)) {
      if (t.tipo === TributoImportacionTipo.IVA_IMPORTACION) ivaImportacion += t.monto;
      else anticipos += t.monto; // anticipo IVA / IRAE
    } else {
      tributosNoRecuperables += t.monto;
    }
  }

  let totalGastos = 0n;
  let ivaGastos = 0n;
  for (const g of input.gastos) {
    totalGastos += g.monto;
    ivaGastos += g.ivaGasto;
  }

  // Fórmula ÚNICA (importaciones.costeo.service): Adquisición + Tributos no
  // recuperables + Gastos atribuibles. En el alta manual la Adquisición es el CIF de
  // la factura del proveedor; el motor documental usa la adquisición por anticipos.
  const costoMercaderia = costoMercaderiaImportada(cif, tributosNoRecuperables, totalGastos);
  const creditoFiscalIva = ivaImportacion + ivaGastos;

  // Prorrateo del costo a los ítems por participación en el FOB. El redondeo de
  // centésimos se ajusta en el último ítem para que la suma cierre exacta.
  const costosItems: bigint[] = [];
  const sumaFob = input.items.reduce((s, it) => s + it.fobTotal, 0n);
  if (input.items.length > 0 && sumaFob > 0n) {
    let acum = 0n;
    for (let i = 0; i < input.items.length; i++) {
      if (i === input.items.length - 1) {
        costosItems.push(costoMercaderia - acum);
      } else {
        const parte = divRoundHalfUp(costoMercaderia * input.items[i].fobTotal, sumaFob);
        costosItems.push(parte);
        acum += parte;
      }
    }
  } else {
    for (let i = 0; i < input.items.length; i++) costosItems.push(0n);
  }

  return { cif, totalTributos, totalGastos, costoMercaderia, creditoFiscalIva, anticipos, costosItems };
}

// ─────────────────────────────────────────────────────────────────────────────
// ASIENTO CONTABLE de una importación (plan de cuentas estándar; adaptable).
//   DEBE:  Mercaderías (costo) · IVA compras (crédito fiscal) · Anticipos
//   HABER: Proveedor del exterior (FOB) · Flete y seguro · Aduana/DGI (tributos)
//          · Despachante (gastos + su IVA)
// Balancea por construcción: Σ débitos = Σ créditos.
// ─────────────────────────────────────────────────────────────────────────────
export interface ImpParaAsiento {
  fob: bigint; flete: bigint; seguro: bigint;
  totalTributos: bigint; totalGastos: bigint; anticipos: bigint;
  costoMercaderia: bigint; creditoFiscalIva: bigint;
  gastos: { ivaGasto: bigint }[];
}

export function armarAsientoImportacion(imp: ImpParaAsiento, plan?: PlanCuentas | null): {
  lineas: LineaAsiento[]; totalDebe: string; totalHaber: string; balanceado: boolean;
} {
  const ivaGastos = imp.gastos.reduce((s, g) => s + g.ivaGasto, 0n);
  const fleteSeguro = imp.flete + imp.seguro;
  const despachante = imp.totalGastos + ivaGastos;

  const lineas: LineaAsiento[] = [];
  // Cada línea se rotula con la cuenta configurada de la empresa (plan de
  // cuentas) o, si no hay, con el nombre canónico por defecto.
  const push = (clave: string, debe: bigint, haber: bigint) => {
    if (debe !== 0n || haber !== 0n) lineas.push({ cuenta: etiquetaCuenta(plan, clave), debe: debe.toString(), haber: haber.toString() });
  };
  // Debe
  push('mercaderiasImportadas', imp.costoMercaderia, 0n);
  push('ivaComprasImportacion', imp.creditoFiscalIva, 0n);
  push('anticipoIvaImportacion', imp.anticipos, 0n);
  // Haber
  push('proveedoresExterior', 0n, imp.fob);
  push('proveedoresLocales', 0n, fleteSeguro);
  push('otrosImpuestosTasas', 0n, imp.totalTributos);
  push('despachantes', 0n, despachante);

  const totalDebe = lineas.reduce((s, l) => s + BigInt(l.debe), 0n);
  const totalHaber = lineas.reduce((s, l) => s + BigInt(l.haber), 0n);
  return {
    lineas,
    totalDebe: totalDebe.toString(),
    totalHaber: totalHaber.toString(),
    balanceado: totalDebe === totalHaber,
  };
}
