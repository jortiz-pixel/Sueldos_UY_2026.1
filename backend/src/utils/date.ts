/**
 * UTILIDADES DE FECHAS
 * Funciones para cálculos de antigüedad, días hábiles, etc.
 */

/** Calcula años de antigüedad entre dos fechas (truncado) */
export function calcularAntiguedad(fechaIngreso: Date, fechaReferencia: Date = new Date()): number {
  const ms = fechaReferencia.getTime() - fechaIngreso.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
}

/**
 * Días de licencia correspondientes según Ley 12.590 y modificativas:
 * - 0 a 4 años: 20 días hábiles
 * - 5 a 9 años: 25 días hábiles (después del 5° año)
 * - 10+ años: 30 días hábiles
 *
 * La licencia aumenta al cumplir 5 y 10 años de antigüedad.
 */
export function diasLicenciaCorrespondientes(antiguedadAnios: number): number {
  if (antiguedadAnios >= 10) return 30;
  if (antiguedadAnios >= 5) return 25;
  return 20;
}

// Tasa de generación de licencia del JORNALERO: 0,066 días por día computable
// (calibrada para 20 días/año). Se escala si la antigüedad da más de 20.
export const TASA_LICENCIA_JORNALERO = 0.066;

/**
 * Días de licencia GENERADOS según el criterio uruguayo (sin redondear; se
 * redondea sólo el resultado final donde se use):
 *  - MENSUAL:   días computables × díasBaseAño / 360   (= meses × 1,6667 con base 20)
 *  - JORNALERO: días computables × 0,066               (× base/20 si antigüedad > 20)
 * `diasBaseAnio` es la licencia anual (20/25/30 según antigüedad).
 */
export function diasLicenciaGenerados(
  salaryType: 'MENSUAL' | 'JORNALERO' | string,
  diasComputables: number,
  diasBaseAnio = 20,
): number {
  if (salaryType === 'JORNALERO') {
    return diasComputables * TASA_LICENCIA_JORNALERO * (diasBaseAnio / 20);
  }
  return (diasComputables * diasBaseAnio) / 360;
}

/**
 * Días computables MENSUALES en base ficto (30 por mes) entre dos fechas,
 * inclusive: un mes trabajado completo cuenta 30; uno parcial, los días
 * efectivos (tope 30). Sirve para el proporcional de licencia del mensual.
 */
export function diasComputablesFictoMensual(desde: Date, hasta: Date): number {
  if (hasta < desde) return 0;
  let dias = 0;
  let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
  while (cur <= hasta) {
    const inicioMes = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const finMes = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const wFrom = desde > inicioMes ? desde : inicioMes;
    const wTo = hasta < finMes ? hasta : finMes;
    if (wTo >= wFrom) {
      const completo = wFrom.getTime() === inicioMes.getTime() && wTo.getTime() === finMes.getTime();
      dias += completo ? 30 : Math.min(30, wTo.getDate() - wFrom.getDate() + 1);
    }
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return dias;
}

/**
 * Meses de preaviso según antigüedad (Ley 10.449 y Ley 10.542):
 * - < 6 meses: 7 días (en días, no meses)
 * - 6 meses a < 1 año: 15 días
 * - 1 año a < 2 años: 1 mes
 * - 2 a < 3 años: 1.5 meses (redondeado a días)
 * - 3+ años: 3 meses (máximo)
 *
 * Para simplicidad retornamos días de preaviso.
 */
export function diasPreavisoCorrespondientes(antiguedadMeses: number): number {
  if (antiguedadMeses < 6) return 7;
  if (antiguedadMeses < 12) return 15;
  if (antiguedadMeses < 24) return 30;
  if (antiguedadMeses < 36) return 45;
  return 90; // 3 meses
}

/** Cantidad de meses de antigüedad */
export function calcularAntiguedadMeses(fechaIngreso: Date, fechaReferencia: Date = new Date()): number {
  const years = fechaReferencia.getFullYear() - fechaIngreso.getFullYear();
  const months = fechaReferencia.getMonth() - fechaIngreso.getMonth();
  return years * 12 + months;
}

/**
 * Meses trabajados en un año (para cálculo proporcional de aguinaldo/licencia).
 * Considera únicamente meses completados.
 */
export function mesesTrabajadosEnAnio(
  fechaIngreso: Date,
  year: number,
  fechaEgreso?: Date,
): number {
  const inicioAnio = new Date(year, 0, 1);
  const finAnio = new Date(year, 11, 31);
  const inicio = fechaIngreso > inicioAnio ? fechaIngreso : inicioAnio;
  const fin = (fechaEgreso && fechaEgreso < finAnio) ? fechaEgreso : finAnio;
  if (inicio > fin) return 0;
  const meses = (fin.getFullYear() - inicio.getFullYear()) * 12
    + fin.getMonth() - inicio.getMonth() + 1;
  return Math.min(12, Math.max(0, meses));
}

/**
 * Semestre al que corresponde el aguinaldo (1 = enero-junio, 2 = julio-diciembre).
 */
export function semestreAguinaldo(month: number): 1 | 2 {
  return month <= 6 ? 1 : 2;
}

/** Días del mes (considerando año bisiesto) */
export function diasDelMes(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Formatea una fecha como string "MM/YYYY" */
export function formatPeriod(year: number, month: number): string {
  return `${String(month).padStart(2, '0')}/${year}`;
}

/** Formatea fecha como "DD/MM/YYYY" */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('es-UY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
