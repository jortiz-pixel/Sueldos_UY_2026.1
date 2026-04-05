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
