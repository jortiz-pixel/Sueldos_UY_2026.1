// ═══════════════════════════════════════════════════════════════════
// FACTURA AUTOGESTIONADA (BPS) — empresas de construcción (Grupo 9.1)
// ═══════════════════════════════════════════════════════════════════
// Resumen mensual de "Fondos de la Construcción · F.R.L. · S.N.I.S. · I.R.P.F."
// que BPS factura, armado con los montos de las liquidaciones CONFIRMADAS del
// mes. Réplica de la pantalla de GNS (columnas Cantidad · Gravado · Total).
//
// Las BASES (gravado) de cada línea ya eran correctas y no se tocan: los fondos
// van sobre "ApliAFondos" (base del ítem FONDO_SOCIAL obrero); la cesantía y el
// FGCL sobre la materia gravada (base del FONASA obrero). Fondo Social/Vivienda
// usan tasas calibradas contra la factura AutoGestionada real de GNS (09/2026,
// Lambrechts). La cesantía patronal se toma directo del total FOCER a pagar
// (así coincide con el archivo FOCER, validado contra GNS). FRL, S.N.I.S./
// FONASA e IRPF salen de los ítems ya calculados en los recibos.
import { LiquidationStatus, ItemType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { divRoundHalfUp } from '../utils/money';
import { esEmpresaFocer, generarFocer } from './focer.service';

function money(cents: bigint): string {
  const neg = cents < 0n; const c = neg ? -cents : cents;
  return `${neg ? '-' : ''}${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
}

// "9414.80" / "-9414.80" → centésimos (bigint). Inversa de money().
function parseMoney(s: string): bigint {
  const neg = s.trim().startsWith('-');
  const [ent, dec = '0'] = (neg ? s.trim().slice(1) : s.trim()).split('.');
  const cents = BigInt(ent || '0') * 100n + BigInt(dec.padEnd(2, '0').slice(0, 2));
  return neg ? -cents : cents;
}

// Tasas de los fondos patronales de la construcción (base 1: fracción).
// Las BASES (gravado) mostradas ya son correctas y NO se tocan: el Fondo Social
// y el Fondo Vivienda van sobre la base "ApliAFondos" del ítem FONDO_SOCIAL
// (12.459,48 en la muestra); la cesantía y el FGCL sobre la materia gravada
// (base del FONASA obrero, 13.449,54 en la muestra). Solo se corrigen las TASAS.
// Fondo Social/Vivienda calibrados contra la factura AutoGestionada real de GNS
// (09/2026, José Lambrechts): sobre 12.459,48 dan 582,31 y 13,17.
const RATE_FONDO_SOCIAL = 0.046736;    // 4,6736% (GNS: 582.31 / 12459.48)
const RATE_FONDO_VIVIENDA = 0.001057;  // 0,1057% (GNS: 13.17 / 12459.48)
const RATE_FGCL = 0.00025;             // 0,025% (validado: 2.24 / 8966.36)
// La cesantía patronal se toma directo del total FOCER (coincide con GNS).

function aplicar(baseCent: bigint, rate: number): bigint {
  // base(centésimos) × rate, redondeo a centésimo.
  return divRoundHalfUp(baseCent * BigInt(Math.round(rate * 1_000_000)), 1_000_000n);
}

export interface FacturaAgLinea {
  key: string;
  label: string;
  cantidad: number;
  gravado: string;
  total: string;
  nota: string;
}

export interface FacturaAg {
  contratista: string;
  aportacion: string;
  titular: string;
  nObra: string;
  mes: number;
  anio: number;
  lineas: FacturaAgLinea[];
  totalFactura: string;
  errores: string[];
  advertencias: string[];
}

export async function generarFacturaAg(companyId: string, year: number, month: number): Promise<FacturaAg> {
  const errores: string[] = [];
  const advertencias: string[] = [];

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error('Empresa no encontrada');
  if (!esEmpresaFocer(company)) {
    errores.push('La Factura AutoGestionada corresponde solo a empresas de construcción (Grupo 9 · Subgrupo 1).');
  }

  const period = await prisma.payrollPeriod.findFirst({ where: { companyId, year, month } });
  const liqs = period
    ? await prisma.liquidation.findMany({
        where: { periodId: period.id, status: LiquidationStatus.CONFIRMADO },
        include: { items: true },
      })
    : [];
  if (period && liqs.length === 0) advertencias.push('No hay liquidaciones confirmadas en el mes.');

  // Acumuladores por línea: [cantidad, baseCent, totalCent]
  const acc: Record<string, { cant: number; base: bigint; total: bigint }> = {
    fondoSocial: { cant: 0, base: 0n, total: 0n },
    fondoVivienda: { cant: 0, base: 0n, total: 0n },
    cesantiaPatronal: { cant: 0, base: 0n, total: 0n },
    cesantiaPersonal: { cant: 0, base: 0n, total: 0n },
    frl: { cant: 0, base: 0n, total: 0n },
    snis: { cant: 0, base: 0n, total: 0n },
    fgcl: { cant: 0, base: 0n, total: 0n },
    irpf: { cant: 0, base: 0n, total: 0n },
  };

  for (const liq of liqs) {
    // El TITULAR / socio sin remuneración NO va en la factura: aporta por su
    // ficto (FONASA sobre 6,5 BPC) en su propio régimen, no sobre materia gravada
    // de la construcción. Sin jornales de los trabajadores, la factura queda en 0.
    const snap = liq.parametersSnapshot as { titularUnipersonal?: boolean } | null;
    if (snap?.titularUnipersonal) continue;

    const items = liq.items;
    const get = (concepto: string) => items.find((i) => i.concepto === concepto);
    // Base del FONASA obrero = materia gravada (base de cesantía y FGCL).
    const fonasaItem = items.find((i) => i.itemType === ItemType.DESCUENTO_OBRERO && i.concepto === 'FONASA');
    const baseGravada = fonasaItem?.baseCalculo ?? 0n;
    // Base "ApliAFondos" (la del ítem FONDO_SOCIAL obrero): base de los fondos.
    const baseFondo = get('FONDO_SOCIAL')?.baseCalculo ?? 0n;

    // Fondos del empleador (gravado = ApliAFondos) y cesantía/FGCL (gravado =
    // materia gravada). Solo se acumulan las BASES; los totales se calculan al
    // final (fondos por tasa, cesantía desde el total FOCER).
    if (baseFondo > 0n) { acc.fondoSocial.cant++; acc.fondoSocial.base += baseFondo; acc.fondoVivienda.cant++; acc.fondoVivienda.base += baseFondo; }
    if (baseGravada > 0n) { acc.cesantiaPatronal.cant++; acc.cesantiaPatronal.base += baseGravada; acc.fgcl.cant++; acc.fgcl.base += baseGravada; }

    // FRL: obrero (0,1%) + patronal, sumados de los ítems reales.
    const frlObrero = get('FRL');
    const frlPatronal = items.find((i) => i.itemType === ItemType.APORTE_PATRONAL && /FRL/.test(i.concepto));
    const frlTotal = (frlObrero?.amount ?? 0n) + (frlPatronal?.amount ?? 0n);
    if (frlTotal > 0n) { acc.frl.cant++; acc.frl.base += frlObrero?.baseCalculo ?? 0n; acc.frl.total += frlTotal; }

    // S.N.I.S. (FONASA obrero: seguro + adicional), sumado de los ítems reales.
    const snisTotal = (get('FONASA')?.amount ?? 0n) + (get('FONASA_ADICIONAL')?.amount ?? 0n);
    if (snisTotal > 0n) { acc.snis.cant++; acc.snis.base += baseGravada; acc.snis.total += snisTotal; }

    // IRPF, sumado de los ítems reales.
    const irpf = get('IRPF')?.amount ?? 0n;
    if (irpf > 0n) { acc.irpf.cant++; acc.irpf.base += get('IRPF')?.baseCalculo ?? 0n; acc.irpf.total += irpf; }
  }

  // Totales de los aportes patronales de la construcción (bases ya acumuladas):
  // fondos por tasa sobre ApliAFondos; FGCL por tasa sobre la materia gravada.
  acc.fondoSocial.total = aplicar(acc.fondoSocial.base, RATE_FONDO_SOCIAL);
  acc.fondoVivienda.total = aplicar(acc.fondoVivienda.base, RATE_FONDO_VIVIENDA);
  acc.fgcl.total = aplicar(acc.fgcl.base, RATE_FGCL);

  // Cesantía patronal: se toma DIRECTO del total FOCER para que coincida con el
  // archivo FOCER (validado contra GNS). El gravado mostrado sigue siendo la
  // materia gravada ya acumulada arriba.
  try {
    const focer = await generarFocer(companyId, year, month);
    acc.cesantiaPatronal.total = parseMoney(focer.totalFocer);
    for (const a of focer.advertencias) if (!advertencias.includes(a)) advertencias.push(a);
  } catch {
    advertencias.push('No se pudo calcular la cesantía FOCER de la construcción.');
  }

  const L = (key: string, label: string, nota: string): FacturaAgLinea => ({
    key, label, cantidad: acc[key].cant, gravado: money(acc[key].base), total: money(acc[key].total), nota,
  });

  const lineas: FacturaAgLinea[] = [
    L('fondoSocial', 'Fondo Social', '4,6736% (ApliAFondos)'),
    L('fondoVivienda', 'Fondo Vivienda', '0,1057% (ApliAFondos)'),
    L('cesantiaPatronal', 'F. Cesantía Patronal', 'Total FOCER a pagar'),
    L('cesantiaPersonal', 'F. Cesantía Personal', '0,5% (trabajadores a prueba)'),
    L('frl', 'F.R.L.', 'Suma de FRL obrero + patronal'),
    L('snis', 'S.N.I.S.', 'Suma de FONASA (seguro + adicional)'),
    L('fgcl', 'F.G.C.L.', '0,025% de la materia gravada'),
    L('irpf', 'I.R.P.F.', 'Suma de IRPF retenido'),
  ];

  const totalFactura = Object.values(acc).reduce((s, a) => s + a.total, 0n);

  return {
    contratista: `${(company.numeroBps ?? '').replace(/^0+(?=\d)/, '')} - ${company.razonSocial ?? ''}`.trim(),
    aportacion: company.tipoAporte != null ? String(company.tipoAporte) : '-',
    titular: '-',
    nObra: '-',
    mes: month,
    anio: year,
    lineas,
    totalFactura: money(totalFactura),
    errores,
    advertencias,
  };
}
