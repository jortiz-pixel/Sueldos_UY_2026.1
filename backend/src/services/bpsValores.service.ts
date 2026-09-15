// ═══════════════════════════════════════════════════════════════════
// VALORES COMUNES — actualización automática desde la página oficial de BPS
// ═══════════════════════════════════════════════════════════════════
// Lee la tabla de "Valores" de BPS (BPC, BFC, UR, UI, salario mínimo, etc.) y
// los guarda como parámetros versionados. La página es HTML estructurado (a
// diferencia del laudo del MTSS, que es un PDF escaneado), así que se puede
// automatizar. Fuente: https://www.bps.gub.uy/bps/valores.jsp?contentid=5478
import { prisma } from '../utils/prisma';
import { parametersService } from './parameters.service';

export const BPS_VALORES_URL = 'https://www.bps.gub.uy/bps/valores.jsp?contentid=5478';

// Etiqueta de la tabla (substring) → clave de parámetro. Orden importa: las más
// específicas primero (Cuota mutual - construcción antes que Cuota mutual).
const MAPEO: Array<{ match: string; notMatch?: string; key: string; label: string; entero?: boolean }> = [
  { match: 'Base de Prestaciones y Contribuciones', key: 'BPC', label: 'BPC — Base de Prestaciones y Contribuciones', entero: true },
  { match: 'Base Ficta de Contribución', key: 'BFC_UNIPERSONAL', label: 'BFC — Base Ficta de Contribución' },
  { match: 'Salario mínimo nacional', key: 'SALARIO_MINIMO', label: 'Salario mínimo nacional', entero: true },
  { match: 'Costo Promedio Equivalente', key: 'CPE', label: 'CPE — Costo Promedio Equivalente', entero: true },
  { match: 'Cuota mutual - construcción', key: 'CUOTA_MUTUAL_CONSTRUCCION', label: 'Cuota mutual — construcción', entero: true },
  { match: 'Cuota mutual', notMatch: 'construcción', key: 'CUOTA_MUTUAL', label: 'Cuota mutual', entero: true },
  { match: 'Unidad Reajustable', key: 'UR', label: 'UR — Unidad Reajustable' },
  { match: 'Unidad Indexada', key: 'UI', label: 'UI — Unidad Indexada' },
];

// Etiquetas legibles por clave (para la UI).
export const ETIQUETAS_VALORES: Record<string, string> = Object.fromEntries(MAPEO.map((m) => [m.key, m.label]));

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// "$ 6.864,00" → 6864 · "1.847,96" → 1847.96 · "6,6431" → 6.6431 (formato UY).
export function parseMontoUy(s: string): number | null {
  const limpio = s.replace(/[^\d.,]/g, '');
  if (!limpio) return null;
  const norm = limpio.replace(/\./g, '').replace(',', '.');
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

// Parsea el HTML de la página de valores → { CLAVE: valor }.
export function parseValoresBps(html: string): Record<string, number> {
  const celdas = (html.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(stripTags).filter(Boolean);
  // Recorre las celdas: cada etiqueta abre una fila; el ÚLTIMO valor numérico
  // (no porcentaje) antes de la próxima etiqueta es el valor vigente.
  const filas: Array<{ label: string; value: number }> = [];
  let label: string | null = null;
  let value: number | null = null;
  const esValor = (c: string) => /^[$\s]*\d[\d.,]*\s*%?$/.test(c);
  for (const c of celdas) {
    if (esValor(c)) {
      if (!c.includes('%')) { const v = parseMontoUy(c); if (v != null) value = v; }
    } else if (/[A-Za-zÁÉÍÓÚÜñáéíóúü]/.test(c)) {
      if (label && value != null) filas.push({ label, value });
      label = c; value = null;
    }
  }
  if (label && value != null) filas.push({ label, value });

  const out: Record<string, number> = {};
  for (const m of MAPEO) {
    if (out[m.key] != null) continue;
    const fila = filas.find((f) => f.label.includes(m.match) && (!m.notMatch || !f.label.includes(m.notMatch)));
    if (fila) out[m.key] = m.entero ? Math.round(fila.value) : fila.value;
  }
  return out;
}

// Descarga y parsea los valores desde BPS.
export async function obtenerValoresBps(): Promise<Record<string, number>> {
  const res = await fetch(BPS_VALORES_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'AsysTax-Sueldos/1.0', 'Accept': 'text/html' },
  });
  if (!res.ok) throw new Error(`La página de BPS respondió ${res.status}`);
  const html = await res.text();
  const valores = parseValoresBps(html);
  if (Object.keys(valores).length === 0) throw new Error('No se pudieron leer los valores de la página de BPS (¿cambió el formato?).');
  return valores;
}

// Actualiza los parámetros con los valores de BPS. Solo crea una versión nueva
// cuando el valor cambió respecto al vigente. Idempotente (correr seguido no
// duplica). effectiveDate = 1.º del mes en curso.
export async function actualizarValoresBps(userId?: string): Promise<{
  actualizados: Array<{ key: string; value: number }>;
  sinCambios: string[];
  fuente: string;
  fecha: string;
}> {
  const valores = await obtenerValoresBps();
  const hoy = new Date();
  const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const actualizados: Array<{ key: string; value: number }> = [];
  const sinCambios: string[] = [];

  for (const [key, value] of Object.entries(valores)) {
    const actual = await prisma.payrollParameter.findFirst({
      where: { key, effectiveDate: { lte: hoy } },
      orderBy: { effectiveDate: 'desc' },
    });
    let actualVal: number | null = null;
    if (actual) { try { actualVal = Number(JSON.parse(actual.value)); } catch { actualVal = Number(actual.value); } }
    if (actualVal != null && Math.abs(actualVal - value) < 1e-6) { sinCambios.push(key); continue; }

    // Si ya hay una fila de este mes, se actualiza; si no, se crea.
    const filaMes = await prisma.payrollParameter.findFirst({ where: { key, effectiveDate: inicioMes } });
    if (filaMes) {
      await prisma.payrollParameter.update({ where: { id: filaMes.id }, data: { value: JSON.stringify(value) } });
    } else {
      await prisma.payrollParameter.create({
        data: { key, value: JSON.stringify(value), effectiveDate: inicioMes, description: 'Actualizado automáticamente desde BPS', createdBy: userId ?? null },
      });
    }
    actualizados.push({ key, value });
  }

  if (actualizados.length) parametersService.clearCache();
  return { actualizados, sinCambios, fuente: BPS_VALORES_URL, fecha: hoy.toISOString() };
}
