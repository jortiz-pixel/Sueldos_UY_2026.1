// =============================================================
// Tipos compartidos con el backend
// =============================================================

export type UserRole = 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type SalaryType = 'MENSUAL' | 'JORNALERO';
export type EstadoCivil = 'SOLTERO' | 'CASADO' | 'CONCUBINATO' | 'DIVORCIADO' | 'VIUDO';
export type LiquidationType = 'MENSUAL' | 'AGUINALDO' | 'LICENCIA' | 'VACACIONAL' | 'LIQUIDACION_FINAL' | 'AJUSTE';
export type LiquidationStatus = 'BORRADOR' | 'CONFIRMADO' | 'ANULADO';
export type PeriodStatus = 'BORRADOR' | 'CONFIRMADO' | 'CERRADO';
export type ItemType = 'HABER' | 'DESCUENTO_OBRERO' | 'APORTE_PATRONAL' | 'INFORMATIVO';

export interface User {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  role: UserRole;
  companyId?: string;
  lastLoginAt?: string;
}

export interface Company {
  id: string;
  rut: string;
  razonSocial: string;
  nombreFantasia?: string;
  domicilio?: string;
  localidad?: string;
  departamento?: string;
  email?: string;
  grupoActividad?: string;
  bseRate: number;
  active: boolean;
  _count?: { employees: number };
}

export interface Employee {
  id: string;
  companyId: string;
  ci: string;
  nombre: string;
  apellido: string;
  fechaNacimiento?: string;
  estadoCivil: EstadoCivil;
  domicilio?: string;
  email?: string;
  telefono?: string;
  fechaIngreso: string;
  fechaEgreso?: string;
  cargo?: string;
  categoria?: string;
  nivel?: string;
  salaryType: SalaryType;
  salarioNominal: string;   // centésimos as string (BigInt serialized)
  jornal?: string;
  conyugeACargo: boolean;
  hijosACargo: number;
  hijosDiscapacitados: number;
  irpfMetodo: 'PROYECCION' | 'SIMPLIFICADO';
  fonasaFamilia: boolean;
  active: boolean;
  antiguedadAnios?: number;
  diasLicenciaCorresponden?: number;
}

export interface PayrollPeriod {
  id: string;
  companyId: string;
  year: number;
  month: number;
  status: PeriodStatus;
  confirmedAt?: string;
  closedAt?: string;
  _count?: { liquidations: number };
}

export interface PayrollItem {
  id: string;
  liquidationId: string;
  employeeId: string;
  itemType: ItemType;
  concepto: string;
  descripcion: string;
  baseCalculo?: string;
  rate?: number;
  amount: string;
  calculationDetail?: unknown;
}

export interface Liquidation {
  id: string;
  periodId: string;
  employeeId: string;
  type: LiquidationType;
  status: LiquidationStatus;
  year: number;
  month: number;
  diasTrabajados: number;
  totalHaberes: string;
  totalDescuentos: string;
  totalPatronal: string;
  liquidoPercibir: string;
  parametersSnapshot?: unknown;
  confirmedAt?: string;
  items?: PayrollItem[];
}

export interface IrpfBracket {
  fromBpc: number;
  toBpc: number | null;
  ratePercent: number;
  rateBp: number;
}

export interface PayrollParameters {
  bpc: string;
  bpsJubilatorioRate: number;
  fonasaBasicRate: number;
  fonasaFamiliaRate: number;
  frlObreroRate: number;
  irpfBrackets: IrpfBracket[];
  irpfHijosBpc: number;
  irpfConyugeBpc: number;
}

export interface NominaItem {
  empleado: Pick<Employee, 'id' | 'ci' | 'nombre' | 'apellido' | 'cargo' | 'categoria'>;
  liquidacion: {
    id: string;
    status: LiquidationStatus;
    diasTrabajados: number;
    totalHaberes: string;
    totalDescuentos: string;
    totalPatronal: string;
    liquidoPercibir: string;
  };
  haberes: { concepto: string; descripcion: string; amount: string }[];
  descuentos: { concepto: string; descripcion: string; amount: string }[];
  patronal: { concepto: string; descripcion: string; amount: string }[];
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

// Utility: format cents string to pesos display
export function formatPesos(ctmsStr: string): string {
  const ctms = parseInt(ctmsStr, 10);
  const pesos = ctms / 100;
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: 'UYU',
    minimumFractionDigits: 2,
  }).format(pesos);
}

export function ctmsToPesos(ctmsStr: string): number {
  return parseInt(ctmsStr, 10) / 100;
}

export const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
