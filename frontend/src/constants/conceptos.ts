// Catálogo único de conceptos del sistema (núcleo legal) que calcula el motor.
// Fuente compartida: se usa en la pantalla Conceptos (catálogo) y en el selector
// de "Agregar concepto" de las liquidaciones.
export interface ConceptoSistema {
  nombre: string;
  tipo: 'HABER' | 'DESCUENTO_OBRERO' | 'APORTE_PATRONAL';
  calculo: string;
  gravado: string;
}

export const CONCEPTOS_SISTEMA: ConceptoSistema[] = [
  { nombre: 'Sueldo básico', tipo: 'HABER', calculo: 'Nominal del mes (prorrateado por días)', gravado: 'Sí' },
  { nombre: 'Jornal', tipo: 'HABER', calculo: 'Valor jornal × días trabajados', gravado: 'Sí' },
  { nombre: 'Horas extra diurnas', tipo: 'HABER', calculo: 'Valor hora × 2 (+100%)', gravado: 'Sí' },
  { nombre: 'Horas extra / recargo nocturno', tipo: 'HABER', calculo: 'Valor hora + 20% nocturno', gravado: 'Sí' },
  { nombre: 'Aguinaldo', tipo: 'HABER', calculo: '1/12 de los haberes del semestre (confirmados)', gravado: 'Sí' },
  { nombre: 'Salario de licencia', tipo: 'HABER', calculo: 'Promedio 12 meses / 30 × días', gravado: 'Sí' },
  { nombre: 'Salario vacacional', tipo: 'HABER', calculo: 'Jornal líquido × días', gravado: 'No (exento CESS)' },
  { nombre: 'Descansos Trabajados', tipo: 'HABER', calculo: 'Cantidad × jornal — cada descanso trabajado equivale a un día más', gravado: 'Sí' },
  { nombre: 'Viáticos Gravados', tipo: 'HABER', calculo: 'Monto manual — integra la base de aportes e IRPF', gravado: 'Sí' },
  { nombre: 'Viáticos', tipo: 'HABER', calculo: 'Monto manual — suma al líquido SIN descuentos', gravado: 'No' },
  { nombre: 'Horas Tardes', tipo: 'DESCUENTO_OBRERO', calculo: 'Cantidad de horas × (jornal ÷ 8) — netea los haberes como las faltas', gravado: '—' },
  { nombre: 'BPS Jubilatorio', tipo: 'DESCUENTO_OBRERO', calculo: '15% sobre el gravado', gravado: '—' },
  { nombre: 'FONASA (Seguro por Enfermedad)', tipo: 'DESCUENTO_OBRERO', calculo: '3% fijo sobre el total de haberes', gravado: '—' },
  { nombre: 'Adicional FONASA', tipo: 'DESCUENTO_OBRERO', calculo: 'Complemento según seguro de salud (escalón >2,5 BPC + hijos + cónyuge)', gravado: '—' },
  { nombre: 'FRL', tipo: 'DESCUENTO_OBRERO', calculo: '0,10% sobre el gravado', gravado: '—' },
  { nombre: 'IRPF (Categoría II)', tipo: 'DESCUENTO_OBRERO', calculo: 'Escala anual proyectada − deducciones', gravado: '—' },
  { nombre: 'BPS IVS Patronal', tipo: 'APORTE_PATRONAL', calculo: '7,5% sobre el gravado', gravado: '—' },
  { nombre: 'FONASA Patronal', tipo: 'APORTE_PATRONAL', calculo: '5% sobre el gravado', gravado: '—' },
  { nombre: 'FRL Patronal', tipo: 'APORTE_PATRONAL', calculo: '0,10% sobre el gravado', gravado: '—' },
  { nombre: 'FGCL Patronal', tipo: 'APORTE_PATRONAL', calculo: '0,025% sobre el gravado', gravado: '—' },
];

// Categorías laborales típicas del Grupo 9 (Industria de la construcción).
// Se ofrecen como sugerencia en el campo Categoría cuando la empresa tiene
// aportación CONSTRUCCIÓN (Tabla 1 código 4); admite texto libre igual.
export const TIPO_APORTE_CONSTRUCCION = 4;

// Una empresa es "de construcción" si aporta por CT (Tabla 1 código 4) o si su
// grupo de Consejos de Salarios es el 9 (Industria de la construcción) o su
// actividad lo indica. Así el desplegable de categorías y el panel de horas
// aparecen aunque falte alguno de los dos códigos.
export function esEmpresaConstruccion(co?: { tipoAporte?: number | null; grupoActividadNum?: number | null; grupoActividad?: string | null; actividadPrincipal?: string | null } | null): boolean {
  if (!co) return false;
  return co.tipoAporte === TIPO_APORTE_CONSTRUCCION
    || co.grupoActividadNum === 9
    || /construc/i.test(co.grupoActividad ?? '')
    || /construc/i.test(co.actividadPrincipal ?? '');
}
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
