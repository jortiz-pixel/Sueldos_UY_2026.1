/**
 * CONCEPTOS ESPECIALES DE LA CONSTRUCCIÓN (aportación CT — Tabla 1 código 4)
 *
 * Al crear (o pasar) una empresa a aportación Construcción se cargan como
 * conceptos PROPIOS de la empresa las partidas típicas del laudo del Grupo 9
 * (SUNCA), con los valores vigentes tomados del recibo de referencia (Oficial
 * Albañil, enero 2026). Los valores/porcentajes quedan EDITABLES en Conceptos
 * (los laudos cambian por ronda) y los importes por cantidad se calculan como
 * cantidad × valor. Las partidas extraordinarias (ropa, transporte,
 * herramientas) y las medias horas van EXENTAS; el ticket de alimentación de
 * este laudo va GRAVADO. Fondo Social y Fondo de Vivienda usan porcentaje de
 * precisión fina (4 decimales).
 *
 * Idempotente: upsert por (companyId, codigo); si el concepto ya existe no se
 * pisan los valores que el operador haya ajustado.
 */
import { ItemType } from '@prisma/client';
import { prisma } from '../utils/prisma';

export const TIPO_APORTE_CONSTRUCCION = 4; // Tabla 1: CT — Construcción

// Una empresa es "de construcción" si aporta por CT (Tabla 1 código 4) o si su
// grupo de Consejos de Salarios es el 9 (Industria de la construcción) o su
// actividad lo indica. Cubre empresas cargadas con uno solo de los códigos.
export function esEmpresaConstruccion(co?: {
  tipoAporte?: number | null;
  grupoActividadNum?: number | null;
  grupoActividad?: string | null;
  actividadPrincipal?: string | null;
} | null): boolean {
  if (!co) return false;
  return co.tipoAporte === TIPO_APORTE_CONSTRUCCION
    || co.grupoActividadNum === 9
    || /construc/i.test(co.grupoActividad ?? '')
    || /construc/i.test(co.actividadPrincipal ?? '');
}

interface ConceptoConstruccion {
  codigo: string;
  nombre: string;
  orden: number;
  tipoOperacion: ItemType;
  tipoCalculo: 'VALOR_FIJO' | 'PORCENTAJE' | 'CANTIDAD_VALOR' | 'PORCENTAJE_CIENMIL';
  baseCalculo?: string;
  valorRate?: number;
  valorFijo?: bigint;
  gravado: boolean;
}

// Valores vigentes 01/2026 (recibo GNS Oficial Albañil — jornal hora 444,85).
const CONCEPTOS: ConceptoConstruccion[] = [
  { codigo: 'HORAS_LLUVIA', nombre: 'Horas de espera por lluvia', orden: 60, tipoOperacion: 'HABER', tipoCalculo: 'CANTIDAD_VALOR', valorFijo: 44485n, gravado: true },
  // Presentismos: se calculan sobre horas × HORA LAUDO (421,39 — guardada en
  // valorFijo, editable), NO sobre la hora pagada (recibo GNS: 10,42% de 3.371,12).
  { codigo: 'PRESENTISMO_OBRA', nombre: 'Incentivo Presentismo (10,42% s/hora laudo)', orden: 61, tipoOperacion: 'HABER', tipoCalculo: 'PORCENTAJE', baseCalculo: 'HORAS_LAUDO', valorRate: 1042, valorFijo: 42139n, gravado: true },
  { codigo: 'PRES_MES_COMPLETO', nombre: 'Presentismo por trabajo completo en el mes (5% s/hora laudo)', orden: 62, tipoOperacion: 'HABER', tipoCalculo: 'PORCENTAJE', baseCalculo: 'HORAS_LAUDO', valorRate: 500, valorFijo: 42139n, gravado: true },
  { codigo: 'TICKET_ALIMENTACION', nombre: 'Ticket Alimentación (gravado)', orden: 63, tipoOperacion: 'HABER', tipoCalculo: 'CANTIDAD_VALOR', valorFijo: 18416n, gravado: true },
  { codigo: 'MEDIAS_HORAS', nombre: 'Medias horas', orden: 64, tipoOperacion: 'HABER', tipoCalculo: 'CANTIDAD_VALOR', valorFijo: 22242n, gravado: false },
  // Partidas extraordinarias EXENTAS: los valores del laudo son POR JORNADA DE
  // 8 HORAS EFECTIVAS; acá se cargan por HORA (valor/8) y el importe se calcula
  // horas × valor, igual que en el recibo GNS ("8 x 12.93").
  //  - Ropa: 103,44 c/8 hs (= 5% del jornal del medio oficial albañil) → 12,93/h. Todas las categorías obreras.
  //  - Herramientas: 41,36 c/8 hs → 5,17/h. SOLO desde Medio Oficial en adelante.
  //  - Transporte: jornaleros 90,50 c/8 hs → 11,31/h (los mensuales tienen otro régimen).
  { codigo: 'DESGASTE_ROPA', nombre: 'Desgaste de ropa (hs × 12,93 — 103,44 c/8 hs, todas las categorías)', orden: 65, tipoOperacion: 'HABER', tipoCalculo: 'CANTIDAD_VALOR', valorFijo: 1293n, gravado: false },
  { codigo: 'GASTOS_TRANSPORTE', nombre: 'Gastos de transporte (hs × 11,31 — jornaleros, 90,50 c/8 hs)', orden: 66, tipoOperacion: 'HABER', tipoCalculo: 'CANTIDAD_VALOR', valorFijo: 1131n, gravado: false },
  { codigo: 'DESGASTE_HERRAMIENTAS', nombre: 'Desgaste de herramientas (hs × 5,17 — 41,36 c/8 hs, desde ½ Oficial)', orden: 67, tipoOperacion: 'HABER', tipoCalculo: 'CANTIDAD_VALOR', valorFijo: 517n, gravado: false },
  { codigo: 'FONDO_SOCIAL', nombre: 'Fondo Social construcción (0,5809%)', orden: 220, tipoOperacion: 'DESCUENTO_OBRERO', tipoCalculo: 'PORCENTAJE_CIENMIL', baseCalculo: 'HABERES_GRAVADOS', valorRate: 5809, gravado: false },
  { codigo: 'FONDO_VIVIENDA', nombre: 'Fondo de Vivienda (0,025%)', orden: 221, tipoOperacion: 'DESCUENTO_OBRERO', tipoCalculo: 'PORCENTAJE_CIENMIL', baseCalculo: 'HABERES_GRAVADOS', valorRate: 250, gravado: false },
];

// Categorías del laudo de la construcción (tabla oficial de grados II–XII).
export const CATEGORIAS_CONSTRUCCION = [
  'II — Sereno',
  'III — Peón común o Canchero',
  'IV — Peón práctico',
  'V — Guinchero',
  'V — ½ Oficial Albañil',
  'V — ½ Oficial Hierro',
  'VI — ½ Oficial Madera',
  'VII — Chofer de camión',
  'VIII — Oficial Albañil',
  'VIII — Oficial Hierro',
  'IX — Oficial Madera',
  'IX — Oficial Finalista',
  'X — Oficial Escalerista',
  'XI — Oficial Maquinista',
  'XII — Mecánico',
];

// Grado (II–XII) de una categoría escrita como "V — ½ Oficial Albañil".
const ROMANOS: Record<string, number> = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
function gradoCategoria(categoria: string): number | null {
  const m = categoria.trim().toUpperCase().match(/^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II)\b/);
  return m ? ROMANOS[m[1]] : null;
}

// Desgaste de herramientas: corresponde SOLO desde ½ Oficial en adelante, es
// decir grado V o superior (V guinchero/½ oficiales · VI ½ oficial madera ·
// VII chofer · VIII+ oficiales · XII mecánico). Sereno y peones (II–IV) no.
export function correspondeHerramientas(categoria: string | null | undefined): boolean {
  if (!categoria) return false;
  const grado = gradoCategoria(categoria);
  if (grado !== null) return grado >= 5;
  // Texto libre sin grado: heurística por nombre de la categoría.
  if (/pe[oó]n|sereno|canchero|administrativ/i.test(categoria)) return false;
  return /oficial|guinchero|chofer|maquinista|escalerista|finalista|mec[aá]nico|capataz|especialista|especializado/i.test(categoria);
}

// ── Jornales del laudo por categoría y recuadro ───────────────────────────
// INCLUIDOS en la ley 14.411 → empresas con aportación CT (4).
// NO_INCLUIDOS → empresas del grupo 9 que aportan por Industria y Comercio.
export type Recuadro = 'INCLUIDOS' | 'NO_INCLUIDOS';

export function recuadroDeEmpresa(co: { tipoAporte?: number | null }): Recuadro {
  return co.tipoAporte === TIPO_APORTE_CONSTRUCCION ? 'INCLUIDOS' : 'NO_INCLUIDOS';
}

/** Jornales vigentes a una fecha: última vigencia ≤ fecha por categoría+recuadro. */
export async function jornalesVigentes(fecha: Date = new Date()): Promise<Array<{ categoria: string; recuadro: string; valorHora: bigint; effectiveDate: Date }>> {
  const rows = await prisma.jornalConstruccion.findMany({
    where: { effectiveDate: { lte: fecha } },
    orderBy: { effectiveDate: 'desc' },
  });
  const vistos = new Set<string>();
  const vigentes: typeof rows = [];
  for (const r of rows) {
    const key = `${r.categoria}|${r.recuadro}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    vigentes.push(r);
  }
  return vigentes;
}

// Partidas extraordinarias derivadas del JORNAL DÍA (hora × 8) del
// ½ OFICIAL ALBAÑIL del recuadro INCLUIDOS EN LA LEY:
//   ropa 5% · transporte 4,375% · herramientas 2% (por jornada de 8 hs).
// El valor POR HORA del concepto es el mismo % aplicado al valor hora.
const CATEGORIA_MEDIO_OFICIAL = 'V — ½ Oficial Albañil';
const PARTIDAS_DERIVADAS: Array<{ codigo: string; pctCienmil: number }> = [
  { codigo: 'DESGASTE_ROPA', pctCienmil: 50000 },          // 5%
  { codigo: 'GASTOS_TRANSPORTE', pctCienmil: 43750 },      // 4,375%
  { codigo: 'DESGASTE_HERRAMIENTAS', pctCienmil: 20000 },  // 2%
];

/**
 * Recalcula el valor por hora de ropa/transporte/herramientas a partir del
 * jornal vigente del ½ Oficial Albañil (INCLUIDOS) y lo aplica a los conceptos
 * de TODAS las empresas de construcción. Se llama al guardar los jornales.
 */
export async function refrescarPartidasDesdeJornal(fecha: Date = new Date()): Promise<number> {
  const vigentes = await jornalesVigentes(fecha);
  const medio = vigentes.find((v) => v.categoria === CATEGORIA_MEDIO_OFICIAL && v.recuadro === 'INCLUIDOS');
  if (!medio || medio.valorHora <= 0n) return 0;
  let actualizados = 0;
  for (const p of PARTIDAS_DERIVADAS) {
    const valorHora = medio.valorHora * BigInt(p.pctCienmil) / 1000000n; // pct × hora
    const r = await prisma.concepto.updateMany({
      where: { codigo: p.codigo, companyId: { not: null } },
      data: { valorFijo: valorHora },
    });
    actualizados += r.count;
  }
  return actualizados;
}

/**
 * Crea los conceptos de construcción como propios de la empresa, ACTIVOS: se
 * auto-aplican al liquidar (los de cantidad valen 0 si no se indica cantidad y
 * no generan ítem; el presentismo vale 0 sin horas). No pisa valores editados.
 */
export async function ensureConceptosConstruccion(companyId: string, quick = false): Promise<number> {
  // Camino rápido (se llama en cada generación de liquidación): si ya están
  // todos los conceptos, no hay nada que hacer.
  if (quick) {
    const existentes = await prisma.concepto.count({
      where: { companyId, codigo: { in: CONCEPTOS.map((c) => c.codigo) } },
    });
    if (existentes >= CONCEPTOS.length) return 0;
  }
  let creados = 0;
  for (const c of CONCEPTOS) {
    const existing = await prisma.concepto.findUnique({
      where: { companyId_codigo: { companyId, codigo: c.codigo } },
    });
    if (existing) {
      // Refrescar la ESTRUCTURA (nombre, base, activo) sin pisar los valores
      // que el operador haya ajustado (valorRate/valorFijo solo si faltan).
      await prisma.concepto.update({
        where: { id: existing.id },
        data: {
          nombre: c.nombre,
          tipoCalculo: c.tipoCalculo,
          baseCalculo: c.baseCalculo ?? null,
          activo: true,
          valorRate: existing.valorRate ?? c.valorRate ?? null,
          valorFijo: existing.valorFijo ?? c.valorFijo ?? null,
        },
      });
      continue;
    }
    await prisma.concepto.create({
      data: {
        companyId,
        codigo: c.codigo,
        nombre: c.nombre,
        orden: c.orden,
        tipoOperacion: c.tipoOperacion,
        tipoCalculo: c.tipoCalculo,
        baseCalculo: c.baseCalculo ?? null,
        valorRate: c.valorRate ?? null,
        valorFijo: c.valorFijo ?? null,
        gravado: c.gravado,
        activo: true,
      },
    });
    creados++;
  }
  return creados;
}
