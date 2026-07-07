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

// Categorías laborales típicas del Grupo 9 (Industria de la construcción).
export const CATEGORIAS_CONSTRUCCION = [
  'Peón', 'Peón Práctico', 'Medio Oficial Albañil', 'Oficial Albañil',
  'Oficial Especializado', 'Capataz', 'Sereno', 'Administrativo de obra',
];

// Desgaste de herramientas: corresponde SOLO desde Medio Oficial en adelante.
export function correspondeHerramientas(categoria: string | null | undefined): boolean {
  if (!categoria) return false;
  return /oficial|capataz|especialista|especializado/i.test(categoria) && !/pe[oó]n/i.test(categoria);
}

/**
 * Crea los conceptos de construcción como propios de la empresa, ACTIVOS: se
 * auto-aplican al liquidar (los de cantidad valen 0 si no se indica cantidad y
 * no generan ítem; el presentismo vale 0 sin horas). No pisa valores editados.
 */
export async function ensureConceptosConstruccion(companyId: string): Promise<number> {
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
