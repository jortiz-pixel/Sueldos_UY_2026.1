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

export interface TipoAporte { codigo: number; nombre: string; }
export interface TipoContribuyente { tipoAporte: number; codigo: number; nombre: string; }
export interface SubgrupoActividad { id: string; grupoNumero: number; numero: number; nombre: string; }
export interface GrupoActividad { numero: number; nombre: string; subgrupos?: SubgrupoActividad[]; }

export interface Company {
  id: string;
  rut: string;
  razonSocial: string;
  nombreFantasia?: string;
  domicilio?: string;
  localidad?: string;
  departamento?: string;
  telefono?: string;
  email?: string;
  actividadPrincipal?: string;
  grupoActividad?: string;
  bseRate: number;
  numeroBps?: string;
  numeroBse?: string;
  tipoAporte?: number | null;
  tipoContribuyente?: number | null;
  grupoActividadNum?: number | null;
  subgrupo?: string;
  focerPin?: string | null;
  naturalezaJuridica?: string;
  convenioColectivo?: string;
  representanteLegal?: string;
  representanteCi?: string;
  representanteCargo?: string;
  inicioActividadMtss?: string;
  fechaInscripcionBps?: string;
  exoApoJub?: number;
  exoFonasa?: number;
  exoFrl?: number;
  exoCcm?: number;
  diaVencimientoBps?: number;
  diasLicenciaAnio?: number;
  primerDiaExtraDesdeAnio?: number;
  maxDiasExtras?: number;
  diasTrabajadosMes?: number;
  observaciones?: string;
  active: boolean;
  hidden?: boolean;
  _count?: { employees: number };
}

export interface Employee {
  id: string;
  companyId?: string | null;
  employeeNumber?: number | null;
  ci: string;
  nombre: string;
  nombre2?: string | null;
  apellido: string;
  apellido2?: string | null;
  fechaNacimiento?: string;
  sexo?: 'M' | 'F' | null;
  nacionalidad?: number;
  tipoDocumento?: string;
  estadoCivil: EstadoCivil;
  domicilio?: string;
  localidad?: string;
  departamento?: string;
  email?: string;
  telefono?: string;
  fechaIngreso: string;
  fechaEgreso?: string;
  cargo?: string;
  categoria?: string;
  nivel?: string;
  salaryType: SalaryType;
  salarioNominal: string;
  jornal?: string;
  conyugeACargo: boolean;
  hijosACargo: number;
  hijosDiscapacitados: number;
  irpfMetodo: 'PROYECCION' | 'SIMPLIFICADO';
  fonasaFamilia: boolean;
  banco?: string | null;
  bancoSucursal?: string | null;
  bancoCuenta?: string | null;
  bancoMoneda?: string | null;
  observaciones?: string;
  active: boolean;
  antiguedadAnios?: number;
  diasLicenciaCorresponden?: number;
}

export interface Contrato {
  id: string;
  employeeId: string;
  companyId?: string | null;
  numero: number;
  vigenciaDesde: string;
  vigenciaHasta?: string | null;
  fechaFin?: string | null;
  fechaIngreso: string;
  tipoContrato?: string;
  cargo?: string;
  sector?: string;
  categoria?: string;
  nivel?: string;
  salaryType: SalaryType;
  tipoRemuneracion?: number | null;
  cobra?: string;
  salarioNominal: string;
  jornal?: string | null;
  horasDia?: number;
  regimenHorario?: string;
  sucursal?: string;
  cuentaSueldos?: string | null;
  moneda: string;
  grupoActividadNum?: number | null;
  subgrupo?: string;
  vinculoFuncional?: number | null;
  seguroSalud?: number | null;
  computosEspeciales?: number | null;
  exoneracionAporte?: number | null;
  acumulacionLaboral?: number | null;
  horasSemanales?: number | null;
  observacion?: string;
  activo: boolean;
}

export interface Concepto {
  id: string;
  companyId: string | null;
  esComun?: boolean;
  oculto?: boolean;
  ocultoEn?: string[];
  codigo: string;
  nombre: string;
  nombreReducido?: string;
  orden: number;
  tipoOperacion: ItemType;
  tipoCalculo: 'VALOR_FIJO' | 'PORCENTAJE' | 'CANTIDAD_VALOR' | 'PORCENTAJE_CIENMIL';
  baseCalculo?: 'NOMINAL' | 'SUELDO_BASICO' | 'HABERES_GRAVADOS' | null;
  valorRate?: number | null;
  valorFijo?: string | null;
  gravado: boolean;
  codBps?: number | null;
  visibleRecibo: boolean;
  incluyeLicencia: boolean;
  activo: boolean;
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
  fechaPago?: string | null;
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

export function soloDigitos(ci: string): string {
  return (ci || '').replace(/\D/g, '');
}

export function formatCedula(ci: string): string {
  const d = soloDigitos(ci);
  if (d.length < 2) return ci;
  const base = d.slice(0, -1);
  const check = d.slice(-1);
  const grouped = base.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped}-${check}`;
}

export function validarCedula(ci: string): boolean {
  const d = soloDigitos(ci);
  if (d.length < 7 || d.length > 8) return false;
  const base = d.slice(0, -1).padStart(7, '0');
  const check = parseInt(d.slice(-1), 10);
  const weights = [2, 9, 8, 7, 6, 3, 4];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += parseInt(base[i], 10) * weights[i];
  const r = sum % 10;
  const calc = r === 0 ? 0 : 10 - r;
  return calc === check;
}

export interface Obra {
  id: string;
  companyId: string;
  numeroObra: string;
  numeroIdentificador?: string | null;
  nombre: string;
  direccion?: string | null;
  departamento?: string | null;
  localidad?: string | null;
  padron?: string | null;
  fRealizacion?: string | null;
  actividadPrincipal?: string | null;
  estado?: string | null;
  aportePatronal?: string | null;
  cajaActividad?: string | null;
  nroAutorizacion?: string | null;
  fechaInicio?: string | null;
  fechaFin?: string | null;
  observaciones?: string | null;
  activa: boolean;
}

export const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// ── Importaciones (comercio exterior) ────────────────────────────────────────
export type ImportacionEstado = 'BORRADOR' | 'EN_TRAMITE' | 'NACIONALIZADA' | 'CERRADA' | 'ANULADA';
export type ImportacionRegimen = 'DEFINITIVA' | 'ADMISION_TEMPORARIA' | 'DEPOSITO' | 'TRANSITO' | 'ZONA_FRANCA';
export type TributoTipo =
  | 'ARANCEL_TEC' | 'TASA_SERVICIOS' | 'IMESI' | 'IVA_IMPORTACION'
  | 'ANTICIPO_IVA' | 'ANTICIPO_IRAE' | 'RECARGO' | 'OTRO';
export type GastoConcepto =
  | 'HONORARIOS_DESPACHANTE' | 'DEPOSITO' | 'MOVILIZACION' | 'GASTOS_BANCARIOS'
  | 'FLETE_INTERNO' | 'SEGURO_LOCAL' | 'OTRO';

// Las cifras de dinero llegan del backend como string de CENTÉSIMOS.
export interface ImportacionItem {
  id?: string;
  descripcion: string;
  ncm?: string | null;
  cantidad: number;
  fobUnitario: string;
  fobTotal: string;
  costoProrrateado: string;
}
export interface ImportacionTributo {
  id?: string;
  tipo: TributoTipo;
  baseImponible: string;
  tasa: number;
  monto: string;
  recuperable: boolean;
}
export interface ImportacionGasto {
  id?: string;
  concepto: GastoConcepto;
  descripcion?: string | null;
  monto: string;
  gravadoIva: boolean;
  ivaGasto: string;
}
export interface Importacion {
  id: string;
  companyId: string;
  estado: ImportacionEstado;
  regimen: ImportacionRegimen;
  proveedorExterior?: string | null;
  paisOrigen?: string | null;
  incoterm?: string | null;
  monedaOrigen: string;
  tipoCambio: number;
  facturaComercialNro?: string | null;
  facturaComercialFecha?: string | null;
  duaNumero?: string | null;
  duaFecha?: string | null;
  despachante?: string | null;
  aduana?: string | null;
  transporteDoc?: string | null;
  certificadoOrigen: boolean;
  fechaEmbarque?: string | null;
  fechaArribo?: string | null;
  fechaNacionalizacion?: string | null;
  fob: string;
  flete: string;
  seguro: string;
  cif: string;
  totalTributos: string;
  totalGastos: string;
  costoMercaderia: string;
  creditoFiscalIva: string;
  anticipos: string;
  notas?: string | null;
  creadoPor?: string | null;
  createdAt: string;
  updatedAt: string;
  items: ImportacionItem[];
  tributos: ImportacionTributo[];
  gastos: ImportacionGasto[];
}

export interface ImportacionCliente {
  companyId: string;
  razonSocial: string;
  nombreFantasia?: string | null;
  soloTareas: boolean;
  active: boolean;
}

export interface ImportacionExtraido {
  datos: {
    regimen: ImportacionRegimen;
    proveedorExterior: string | null;
    paisOrigen: string | null;
    incoterm: string | null;
    monedaOrigen: string;
    tipoCambio: number;
    duaNumero: string | null;
    duaFecha?: string;
    despachante: string | null;
    aduana: string | null;
    fechaNacionalizacion?: string;
    fob: number;
    flete: number;
    seguro: number;
    tributos: Array<{ tipo: TributoTipo; monto: number }>;
    gastos: Array<{ concepto: GastoConcepto; monto: number; ivaGasto: number }>;
  } | null;
  errores?: string[];
  aviso?: string;
}

export interface AsientoLinea { cuenta: string; debe: string; haber: string; }
export interface AsientoImportacion { lineas: AsientoLinea[]; totalDebe: string; totalHaber: string; balanceado: boolean; }

export interface CreditoFiscalFila {
  id: string;
  duaNumero: string | null;
  fecha: string | null;
  proveedor: string | null;
  ivaImportacion: string;
  ivaGastos: string;
  anticipoIva: string;
  anticipoIrae: string;
  creditoFiscalIva: string;
  anticipos: string;
}
export interface CreditoFiscalReporte {
  filas: CreditoFiscalFila[];
  totales: {
    ivaImportacion: string; ivaGastos: string; anticipoIva: string;
    anticipoIrae: string; creditoFiscalIva: string; anticipos: string;
  };
}

export interface ImportacionImportResult {
  dryRun: boolean;
  mapeo?: Record<string, string>;
  resumen: { total: number; validas: number; conErrores: number; creadas?: number };
  filas: Array<{
    fila: number;
    datos: { duaNumero: string | null; proveedorExterior: string | null; fob: number; duaFecha?: string };
    errores: string[];
  }>;
}

// Payload de alta/edición: los montos van en PESOS (number); el backend convierte.
export interface ImportacionPayload {
  companyId: string;
  estado?: ImportacionEstado;
  regimen?: ImportacionRegimen;
  proveedorExterior?: string | null;
  paisOrigen?: string | null;
  incoterm?: string | null;
  monedaOrigen?: string;
  tipoCambio?: number;
  facturaComercialNro?: string | null;
  facturaComercialFecha?: string | null;
  duaNumero?: string | null;
  duaFecha?: string | null;
  despachante?: string | null;
  aduana?: string | null;
  transporteDoc?: string | null;
  certificadoOrigen?: boolean;
  fechaEmbarque?: string | null;
  fechaArribo?: string | null;
  fechaNacionalizacion?: string | null;
  fob?: number;
  flete?: number;
  seguro?: number;
  notas?: string | null;
  items?: Array<{ descripcion: string; ncm?: string | null; cantidad?: number; fobUnitario?: number; fobTotal?: number }>;
  tributos?: Array<{ tipo: TributoTipo; baseImponible?: number; tasa?: number; monto?: number; recuperable?: boolean }>;
  gastos?: Array<{ concepto: GastoConcepto; descripcion?: string | null; monto?: number; gravadoIva?: boolean; ivaGasto?: number }>;
}
