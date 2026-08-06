import { SalaryType } from '../types';

// Tipo de remuneración BPS — Tabla 2 (Codificador). Aplica a todas las empresas.
export const TIPOS_REMUNERACION: Array<{ codigo: number; label: string; desc: string }> = [
  { codigo: 1, label: 'Mensual', desc: 'Cobra por mes (incluye fictos patronales).' },
  { codigo: 2, label: 'Jornalero', desc: 'Cobra por jornal. Incluye a quién cobra por hora.' },
  { codigo: 3, label: 'Destajista', desc: 'Cobra por tarea realizada.' },
  { codigo: 4, label: 'A comisión', desc: 'Cobra exclusivamente por comisiones.' },
  { codigo: 5, label: 'Mixta', desc: 'Sueldo básico mensual más una comisión.' },
  { codigo: 6, label: 'Sin remuneración', desc: 'Sin remuneración.' },
];

// El motor de cálculo solo distingue MENSUAL vs JORNALERO: solo "Jornalero" (2)
// se liquida por jornal; el resto se maneja como MENSUAL.
export function salaryTypeDeTipoRem(codigo: number): SalaryType {
  return codigo === 2 ? 'JORNALERO' : 'MENSUAL';
}

// Código Tabla 2 a partir de un contrato existente (usa el guardado o lo deriva
// del salaryType para contratos viejos que no tienen el código).
export function tipoRemDeContrato(tipoRemuneracion?: number | null, salaryType?: SalaryType): number {
  if (tipoRemuneracion != null) return tipoRemuneracion;
  return salaryType === 'JORNALERO' ? 2 : 1;
}
