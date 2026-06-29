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
  { nombre: 'Feriado pago', tipo: 'HABER', calculo: 'Valor jornal', gravado: 'Sí' },
  { nombre: 'Prima por antigüedad', tipo: 'HABER', calculo: 'Escala por años (mín. 3, tope 10)', gravado: 'Sí' },
  { nombre: 'Presentismo', tipo: 'HABER', calculo: 'Según convenio', gravado: 'Sí' },
  { nombre: 'Aguinaldo', tipo: 'HABER', calculo: '1/12 de los haberes del semestre (confirmados)', gravado: 'Sí' },
  { nombre: 'Salario de licencia', tipo: 'HABER', calculo: 'Promedio 12 meses / 30 × días', gravado: 'Sí' },
  { nombre: 'Salario vacacional', tipo: 'HABER', calculo: 'Jornal líquido × días', gravado: 'No (exento CESS)' },
  { nombre: 'Faltas', tipo: 'DESCUENTO_OBRERO', calculo: 'Valor jornal × días', gravado: '—' },
  { nombre: 'Adelanto de sueldo', tipo: 'DESCUENTO_OBRERO', calculo: 'Monto a descontar', gravado: '—' },
  { nombre: 'BPS Jubilatorio', tipo: 'DESCUENTO_OBRERO', calculo: '15% sobre el gravado', gravado: '—' },
  { nombre: 'FONASA', tipo: 'DESCUENTO_OBRERO', calculo: '3%–8% según ingreso y cargas', gravado: '—' },
  { nombre: 'FRL', tipo: 'DESCUENTO_OBRERO', calculo: '0,10% sobre el gravado', gravado: '—' },
  { nombre: 'IRPF (Categoría II)', tipo: 'DESCUENTO_OBRERO', calculo: 'Escala anual proyectada − deducciones', gravado: '—' },
  { nombre: 'BPS IVS Patronal', tipo: 'APORTE_PATRONAL', calculo: '7,5% sobre el gravado', gravado: '—' },
  { nombre: 'FONASA Patronal', tipo: 'APORTE_PATRONAL', calculo: '5% sobre el gravado', gravado: '—' },
  { nombre: 'FRL Patronal', tipo: 'APORTE_PATRONAL', calculo: '0,10% sobre el gravado', gravado: '—' },
  { nombre: 'FGCL Patronal', tipo: 'APORTE_PATRONAL', calculo: '0,025% sobre el gravado', gravado: '—' },
];
