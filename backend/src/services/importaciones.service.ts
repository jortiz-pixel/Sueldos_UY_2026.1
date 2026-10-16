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

  const costoMercaderia = cif + tributosNoRecuperables + totalGastos;
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
