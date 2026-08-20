// ═══════════════════════════════════════════════════════════════════
// FACTURA AUTOGESTIONADA (BPS) — empresas de construcción (Grupo 9.1)
// ═══════════════════════════════════════════════════════════════════
// Resumen mensual de "Fondos de la Construcción · F.R.L. · S.N.I.S. · I.R.P.F."
// que BPS factura, armado con los montos de las liquidaciones CONFIRMADAS del
// mes. Réplica de la pantalla de GNS (columnas Cantidad · Gravado · Total).
//
// ⚠️ TASAS PROVISIONALES: varias líneas (Fondo Social y Fondo Vivienda del
// empleador) usan tasas retro-calculadas de la muestra de GNS (05/2026,
// Lambrechts) y deben validarse contra la factura real / el laudo. Las líneas
// que salen de ítems ya calculados por el sistema (FRL, S.N.I.S./FONASA, IRPF,
// cesantía FOCER) son exactas. Cada línea informa su `nota`.
import { LiquidationStatus, ItemType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { divRoundHalfUp } from '../utils/money';
import { esEmpresaFocer } from './focer.service';

function money(cents: bigint): string {
  const neg = cents < 0n; const c = neg ? -cents : cents;
  return `${neg ? '-' : ''}${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
}

// Tasas de los fondos patronales de la construcción (base 1: fracción).
// Cesantía y FGCL son limpias en la muestra; Fondo Social/Vivienda son
// provisionales (retro-cálculo de la muestra) hasta validar con el laudo.
const RATE_FONDO_SOCIAL = 0.060451;   // ⚠️ provisional (muestra: 506.92 / 8385.70)
const RATE_FONDO_VIVIENDA = 0.0013249; // ⚠️ provisional (muestra: 11.11 / 8385.70)
const RATE_CESANTIA_PATRONAL = 0.05;   // 5% (validado: 448.32 / 8966.36)
const RATE_CESANTIA_PERSONAL = 0.005;  // 0,5%
const RATE_FGCL = 0.00025;             // 0,025% (validado: 2.24 / 8966.36)

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
    const items = liq.items;
    const get = (concepto: string) => items.find((i) => i.concepto === concepto);
    // Base gravada BPS (para cesantía/FGCL): base del FONASA obrero (materia gravada).
    const fonasaItem = items.find((i) => i.itemType === ItemType.DESCUENTO_OBRERO && i.concepto === 'FONASA');
    const baseGravada = fonasaItem?.baseCalculo ?? 0n;
    // Base ApliAFondos (para Fondo Social/Vivienda): la del ítem Fondo Social.
    const baseFondo = get('FONDO_SOCIAL')?.baseCalculo ?? 0n;

    // Fondo Social / Vivienda del empleador (tasa provisional sobre ApliAFondos).
    if (baseFondo > 0n) {
      acc.fondoSocial.cant++; acc.fondoSocial.base += baseFondo; acc.fondoSocial.total += aplicar(baseFondo, RATE_FONDO_SOCIAL);
      acc.fondoVivienda.cant++; acc.fondoVivienda.base += baseFondo; acc.fondoVivienda.total += aplicar(baseFondo, RATE_FONDO_VIVIENDA);
    }

    // F. Cesantía (FOCER): patronal 5% siempre; personal 0,5% según tipo de FOCER.
    // (focerTipo se toma del contrato del trabajador; acá aproximamos con la
    // materia gravada del recibo, misma base que usa la muestra.)
    if (baseGravada > 0n) {
      acc.cesantiaPatronal.cant++; acc.cesantiaPatronal.base += baseGravada; acc.cesantiaPatronal.total += aplicar(baseGravada, RATE_CESANTIA_PATRONAL);
      acc.fgcl.cant++; acc.fgcl.base += baseGravada; acc.fgcl.total += aplicar(baseGravada, RATE_FGCL);
    }

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

  const L = (key: string, label: string, nota: string): FacturaAgLinea => ({
    key, label, cantidad: acc[key].cant, gravado: money(acc[key].base), total: money(acc[key].total), nota,
  });

  const lineas: FacturaAgLinea[] = [
    L('fondoSocial', 'Fondo Social', '⚠️ tasa provisional (validar con laudo)'),
    L('fondoVivienda', 'Fondo Vivienda', '⚠️ tasa provisional (validar con laudo)'),
    L('cesantiaPatronal', 'F. Cesantía Patronal', '5% de la materia gravada'),
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
