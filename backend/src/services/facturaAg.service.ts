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
// Fondo Social 1,85% y Fondo Vivienda 0,05% sobre la BASE DE FONDOS (ver abajo);
// FGCL 0,025% sobre la materia gravada. Validado contra la factura AutoGestionada
// real de GNS (DEMARIA FAJARDO, obra 740423894, 10/2026): 3448,50 / 93,20 / 43,28.
const RATE_FONDO_SOCIAL = 0.0185;      // 1,85%  (GNS: 3448,50 / 186404,84)
const RATE_FONDO_VIVIENDA = 0.0005;    // 0,05%  (GNS: 93,20 / 186404,84)
const RATE_FGCL = 0.00025;             // 0,025% (GNS por trabajador: 43,28)
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

  // ── Materia gravada por trabajador (criterio FOCER / nómina ATYR) ───
  // El FOCER ya calcula, POR TRABAJADOR, la MATERIA GRAVADA con el mismo criterio
  // que el concepto 1 de la nómina (neta de faltas, sin los exentos del laudo ni
  // el salario vacacional). Es la base de la Cesantía, el F.R.L. y el F.G.C.L.,
  // y la cantidad = trabajadores con base > 0. Se reutiliza en vez de la base del
  // FONASA, que dejaba afuera a quien no aporta FONASA (seguro 9 / pocos jornales)
  // y daba una base y una cantidad equivocadas (GNS Demaria: 6 trabajadores sobre
  // 173.180,84, no 4 sobre 155.198,40).
  let focer: Awaited<ReturnType<typeof generarFocer>> | null = null;
  try {
    focer = await generarFocer(companyId, year, month);
    for (const a of focer.advertencias) if (!advertencias.includes(a)) advertencias.push(a);
  } catch {
    advertencias.push('No se pudo calcular la materia gravada / cesantía FOCER de la construcción.');
  }
  const gravadosFocer = (focer?.empleados ?? [])
    .map((x) => parseMoney(x.totalGravado))
    .filter((g) => g > 0n);
  const baseMateriaGravada = gravadosFocer.reduce((s, g) => s + g, 0n);
  const cantMateriaGravada = gravadosFocer.length;

  for (const liq of liqs) {
    // El TITULAR / socio sin remuneración NO va en la factura: aporta por su
    // ficto (FONASA sobre 6,5 BPC) en su propio régimen, no sobre materia gravada
    // de la construcción. Sin jornales de los trabajadores, la factura queda en 0.
    const snap = liq.parametersSnapshot as { titularUnipersonal?: boolean } | null;
    if (snap?.titularUnipersonal) continue;

    const items = liq.items;
    const get = (concepto: string) => items.find((i) => i.concepto === concepto);
    // Base del FONASA obrero = materia gravada del trabajador que aporta FONASA:
    // es la base y la cantidad del S.N.I.S. (solo esos trabajadores).
    const fonasaItem = items.find((i) => i.itemType === ItemType.DESCUENTO_OBRERO && i.concepto === 'FONASA');
    const baseFonasa = fonasaItem?.baseCalculo ?? 0n;
    // BASE DE FONDOS (criterio Fondo Social de la Construcción): haberes gravados
    // y no gravados (incluidos los tickets de alimentación) MENOS los aportes
    // personales FONASA, FRL e IRPF — SIN descontar el montepío (jubilatorio).
    // Nuestra base "ApliAFondos" (ítem FONDO_SOCIAL) ya resta jubilatorio + FONASA
    // + FRL + IRPF, así que se le vuelve a sumar el jubilatorio para obtenerla.
    // Verificado contra GNS (DEMARIA 10/2026): 173.180,84 + exentos − FONASA − FRL
    // − IRPF = 186.404,84. Se calcula y redondea POR TRABAJADOR (como hace GNS).
    const baseApliAFondos = get('FONDO_SOCIAL')?.baseCalculo ?? 0n;
    const jubilatorio = get('BPS_JUBILATORIO')?.amount ?? 0n;
    const baseFondo = baseApliAFondos > 0n ? baseApliAFondos + jubilatorio : 0n;
    if (baseFondo > 0n) {
      acc.fondoSocial.cant++; acc.fondoSocial.base += baseFondo; acc.fondoSocial.total += aplicar(baseFondo, RATE_FONDO_SOCIAL);
      acc.fondoVivienda.cant++; acc.fondoVivienda.base += baseFondo; acc.fondoVivienda.total += aplicar(baseFondo, RATE_FONDO_VIVIENDA);
    }

    // FRL: obrero (0,1%) + patronal, sumados de los ítems reales.
    const frlObrero = get('FRL');
    const frlPatronal = items.find((i) => i.itemType === ItemType.APORTE_PATRONAL && /FRL/.test(i.concepto));
    const frlTotal = (frlObrero?.amount ?? 0n) + (frlPatronal?.amount ?? 0n);
    if (frlTotal > 0n) { acc.frl.total += frlTotal; }

    // S.N.I.S. (FONASA obrero: seguro + adicional), sumado de los ítems reales.
    const snisTotal = (get('FONASA')?.amount ?? 0n) + (get('FONASA_ADICIONAL')?.amount ?? 0n);
    if (snisTotal > 0n) { acc.snis.cant++; acc.snis.base += baseFonasa; acc.snis.total += snisTotal; }

    // IRPF, sumado de los ítems reales.
    const irpf = get('IRPF')?.amount ?? 0n;
    if (irpf > 0n) { acc.irpf.cant++; acc.irpf.base += get('IRPF')?.baseCalculo ?? 0n; acc.irpf.total += irpf; }
  }

  // (Los totales de los fondos sociales ya se acumularon por trabajador arriba.)

  // Cesantía patronal: total DIRECTO del FOCER (validado byte a byte contra GNS).
  // Base y cantidad = materia gravada FOCER (todos los trabajadores con base > 0).
  acc.cesantiaPatronal = { cant: cantMateriaGravada, base: baseMateriaGravada, total: focer ? parseMoney(focer.totalFocer) : 0n };

  // F.G.C.L.: 0,025% POR TRABAJADOR sobre su materia gravada (GNS redondea por
  // línea y suma: da 43,28, no 43,30 del agregado). Base/cantidad = materia gravada.
  acc.fgcl = {
    cant: cantMateriaGravada,
    base: baseMateriaGravada,
    total: gravadosFocer.reduce((s, g) => s + aplicar(g, RATE_FGCL), 0n),
  };

  // F.R.L.: total ya sumado de los ítems reales; base y cantidad = materia gravada.
  acc.frl.cant = cantMateriaGravada;
  acc.frl.base = baseMateriaGravada;

  const L = (key: string, label: string, nota: string): FacturaAgLinea => ({
    key, label, cantidad: acc[key].cant, gravado: money(acc[key].base), total: money(acc[key].total), nota,
  });

  const lineas: FacturaAgLinea[] = [
    L('fondoSocial', 'Fondo Social', '1,85% (haberes − FONASA − FRL − IRPF)'),
    L('fondoVivienda', 'Fondo Vivienda', '0,05% (haberes − FONASA − FRL − IRPF)'),
    L('cesantiaPatronal', 'F. Cesantía Patronal', 'Total FOCER a pagar (5% de la materia gravada)'),
    L('cesantiaPersonal', 'F. Cesantía Personal', '0,5% (trabajadores a prueba)'),
    L('frl', 'F.R.L.', '0,2% de la materia gravada (obrero + patronal)'),
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
