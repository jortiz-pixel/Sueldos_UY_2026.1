import axios, { AxiosInstance, AxiosError } from 'axios';
import { AuthResponse, User, Company, Employee, PayrollPeriod, Liquidation, NominaItem, PayrollParameters, TipoAporte, TipoContribuyente, GrupoActividad, Contrato, Concepto } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || '';

const api: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) { config.headers.Authorization = `Bearer ${token}`; }
  // En subidas multipart, quitar el Content-Type por defecto para que el
  // navegador agregue el boundary correcto.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retry?: boolean });
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) throw new Error('No refresh token');
        const { data } = await axios.post(`${BASE_URL}/api/auth/refresh`, { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);
        original.headers!['Authorization'] = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export const versionApi = {
  get: () => api.get<{ version: string; builtAt: string | null }>('/version').then((r) => r.data),
};

export interface AuditRow {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  oldData: unknown;
  newData: unknown;
  usuario: string | null;
  usuarioEmail: string | null;
  empresa: string | null;
}

export const demoApi = {
  seed: () => api.post<{
    empresa: string; personasCreadas: number; personasExistentes: number;
    liquidacionesGeneradas: number; aguinaldos: number; finales: number; errores: string[];
  }>('/demo/seed').then((r) => r.data),
};

export interface JornalConstruccionRow { categoria: string; recuadro: 'INCLUIDOS' | 'NO_INCLUIDOS'; valorHora: string; effectiveDate: string }
export const construccionApi = {
  jornales: () => api.get<{ categorias: string[]; jornales: JornalConstruccionRow[] }>('/construccion/jornales').then((r) => r.data),
  saveJornales: (effectiveDate: string, valores: Array<{ categoria: string; recuadro: 'INCLUIDOS' | 'NO_INCLUIDOS'; valorHoraPesos: number }>) =>
    api.put<{ guardados: number; partidasActualizadas: number }>('/construccion/jornales', { effectiveDate, valores }).then((r) => r.data),
};

export const auditApi = {
  list: (params: { page?: number; limit?: number; action?: string; entity?: string; from?: string; to?: string }) =>
    api.get<{ data: AuditRow[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>('/audit', { params })
      .then((r) => r.data),
};

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }).then((r) => r.data),
  google: (credential: string) =>
    api.post<AuthResponse>('/auth/google', { credential }).then((r) => r.data),
  logout: () => {
    const refreshToken = localStorage.getItem('refreshToken');
    return api.post('/auth/logout', { refreshToken });
  },
  me: () => api.get<User>('/auth/me').then((r) => r.data),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.put('/auth/change-password', { currentPassword, newPassword }).then((r) => r.data),
};

export const companiesApi = {
  list: () => api.get<Company[]>('/companies').then((r) => r.data),
  get: (id: string) => api.get<Company>(`/companies/${id}`).then((r) => r.data),
  create: (data: Partial<Company>) => api.post<Company>('/companies', data).then((r) => r.data),
  update: (id: string, data: Partial<Company>) => api.put<Company>(`/companies/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/companies/${id}`).then((r) => r.data),
  setVisibility: (id: string, hidden: boolean) =>
    api.patch(`/companies/${id}/visibility`, { hidden }).then((r) => r.data),
  getUsers: (id: string) => api.get(`/companies/${id}/users`).then((r) => r.data),
  createUser: (id: string, data: object) => api.post(`/companies/${id}/users`, data).then((r) => r.data),
};

export interface MyMembership {
  companyId: string;
  razonSocial: string;
  nombreFantasia: string | null;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
  superadmin: boolean;
}

export interface CompanyMembership {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
  estado: 'PENDIENTE' | 'ACTIVA' | 'REVOCADA';
  user: { id: string; email: string; nombre: string; apellido: string };
  createdAt: string;
}

export const membershipApi = {
  my: () => api.get<MyMembership[]>('/memberships/my').then((r) => r.data),
  listByCompany: (companyId: string) =>
    api.get<CompanyMembership[]>('/memberships', { params: { companyId } }).then((r) => r.data),
  share: (data: { companyId: string; email: string; role: string; nombre?: string; apellido?: string; password?: string }) =>
    api.post('/memberships', data).then((r) => r.data),
  update: (id: string, data: { role?: string; estado?: string }) =>
    api.patch(`/memberships/${id}`, data).then((r) => r.data),
};

export const entitlementApi = {
  listByCompany: (companyId: string) =>
    api.get('/entitlements', { params: { companyId } }).then((r) => r.data),
  set: (data: { companyId: string; module: string; estado?: string; plan?: string }) =>
    api.put('/entitlements', data).then((r) => r.data),
};

export type AttachmentTipo = 'FOTO' | 'CEDULA' | 'LIBRETA' | 'CARNE_SALUD' | 'CV' | 'OTRO';

export interface Attachment {
  id: string;
  companyId: string;
  ownerType: string;
  ownerId: string;
  tipo: AttachmentTipo;
  fileName: string;
  mimeType: string;
  tamano: number;
  vencimiento: string | null;
  createdAt: string;
}

export const attachmentApi = {
  list: (params: { companyId: string; ownerType: string; ownerId: string }) =>
    api.get<Attachment[]>('/attachments', { params }).then((r) => r.data),
  upload: (formData: FormData) =>
    api.post<Attachment>('/attachments', formData).then((r) => r.data),
  blob: (id: string) =>
    api.get(`/attachments/${id}/download`, { responseType: 'blob' }).then((r) => r.data as Blob),
  remove: (id: string) => api.delete(`/attachments/${id}`).then((r) => r.data),
};

export type CalendarEventType = 'CUMPLEANOS' | 'VENC_CARNE_SALUD' | 'VENC_LIBRETA' | 'ALTA' | 'BAJA' | 'LICENCIA' | 'REINTEGRO' | 'VENC_NOMINA_BPS';

export interface CalendarEvent {
  tipo: CalendarEventType;
  fecha: string;
  titulo: string;
  personaId?: string;
  hasta?: string;
  leaveId?: string;
}

export const calendarApi = {
  upcoming: (companyId: string, days = 45) =>
    api.get<CalendarEvent[]>('/calendar', { params: { companyId, days } }).then((r) => r.data),
  month: (companyId: string, year: number, month: number) =>
    api.get<CalendarEvent[]>('/calendar/month', { params: { companyId, year, month } }).then((r) => r.data),
  createLeave: (data: { employeeId: string; fechaInicio: string; fechaFin: string; motivo?: string; anticipar?: boolean }) =>
    api.post('/calendar/leaves', data).then((r) => r.data),
  deleteLeave: (id: string) => api.delete(`/calendar/leaves/${id}`).then((r) => r.data),
  leavesSaldos: (companyId: string, year: number) =>
    api.get<LeavesSaldos>('/calendar/leaves/saldos', { params: { companyId, year } }).then((r) => r.data),
};

export interface LeavesSaldos {
  year: number;
  saldos: Array<{
    employee: { id: string; ci: string; nombre: string; apellido: string };
    corresponden: number;
    tomados: number;
    disponibles: number;
    licencias: Array<{
      id: string;
      fechaInicio: string;
      fechaFin: string;
      dias: number;
      status: string;
      motivo: string | null;
    }>;
  }>;
}

export interface ImportRow {
  fila: number;
  datos: {
    ci: string; nombre: string; apellido: string;
    fechaNacimiento?: string; email?: string; telefono?: string;
    fechaIngreso?: string; salarioNominal?: number; cargo?: string;
  };
  errores: string[];
}

export interface ImportResult {
  dryRun: boolean;
  headers?: string[];
  mapeo?: Record<string, string>;
  resumen: { total: number; validas: number; conErrores: number; creadas?: number };
  filas: ImportRow[];
}

export const importApi = {
  personas: (companyId: string, file: File, commit: boolean) => {
    const fd = new FormData();
    fd.append('companyId', companyId);
    fd.append('commit', commit ? 'true' : 'false');
    fd.append('file', file);
    return api.post<ImportResult>('/import/personas', fd).then((r) => r.data);
  },
  plantilla: () => api.get('/import/personas/plantilla', { responseType: 'blob' }).then((r) => r.data as Blob),
};

export interface CodigoBps { codigo: number; nombre: string }

export const catalogsApi = {
  tiposAporte: () => api.get<TipoAporte[]>('/catalogs/tipos-aporte').then((r) => r.data),
  tiposContribuyente: () => api.get<TipoContribuyente[]>('/catalogs/tipos-contribuyente').then((r) => r.data),
  gruposActividad: () => api.get<GrupoActividad[]>('/catalogs/grupos-actividad').then((r) => r.data),
  // Codificador BPS Versión 37
  naturalezaJuridica: () => api.get<CodigoBps[]>('/catalogs/naturaleza-juridica').then((r) => r.data),
  causalesEgreso: () => api.get<CodigoBps[]>('/catalogs/causales-egreso').then((r) => r.data),
  vinculosFuncionales: () => api.get<CodigoBps[]>('/catalogs/vinculos-funcionales').then((r) => r.data),
  tiposRemuneracion: () => api.get<CodigoBps[]>('/catalogs/tipos-remuneracion').then((r) => r.data),
  segurosSalud: () => api.get<CodigoBps[]>('/catalogs/seguros-salud').then((r) => r.data),
  exoneracionesAporte: () => api.get<CodigoBps[]>('/catalogs/exoneraciones-aporte').then((r) => r.data),
  computosEspeciales: () => api.get<CodigoBps[]>('/catalogs/computos-especiales').then((r) => r.data),
  conceptosBps: () => api.get<CodigoBps[]>('/catalogs/conceptos-bps').then((r) => r.data),
};

export interface NominaChecklist {
  empresa: { id: string; razonSocial: string; faltantes: string[] };
  personas: Array<{
    id: string;
    employeeNumber: number | null;
    ci: string;
    nombre: string;
    apellido: string;
    contratoId: string | null;
    faltantes: string[];
  }>;
  totalPersonas: number;
  totalIncompletas: number;
  listaParaNomina: boolean;
}

export interface NominaPreview {
  filename: string;
  montoTotal: string;
  personas: Array<{
    ci: string;
    nombre: string;
    diasTrabajados: number;
    seguroSalud: number | null;
    vinculoFuncional: number | null;
    conceptos: Array<{ codigo: number; monto: string }>;
    egreso: { causal: number; fecha: string } | null;
  }>;
  errores: string[];
  advertencias: string[];
  lineas: string[];
}

export interface NominaImportPlan {
  dryRun: boolean;
  mesCargo: { month: number; year: number } | null;
  empresa: {
    accion: 'crear' | 'actualizar' | 'existente';
    razonSocial: string;
    rut: string;
    numeroBps: string;
    tipoAporte: number | null;
    tipoContribuyente: number | null;
  } | null;
  personas: Array<{
    accion: 'crear' | 'existente';
    ci: string;
    nombre: string;
    contrato: 'crear' | 'existente' | null;
    detalles: string;
  }>;
  advertencias: string[];
  errores: string[];
}

export interface RectificativaPreview {
  filename: string;
  montoTotal: string;
  declaradaAt: string | null;
  rectificativasPrevias: number;
  diferencias: Array<{
    doc: string;
    nombre: string;
    omitida: boolean;
    conceptos: Array<{ codigo: string; declarado: string; actual: string; delta: string }>;
  }>;
  errores: string[];
  advertencias: string[];
  lineas: string[];
}

export interface CentroMes {
  period: { id: string; status: 'BORRADOR' | 'CONFIRMADO' | 'CERRADO' } | null;
  datos: { faltantesEmpresa: string[]; personasIncompletas: number; totalPersonas: number; ok: boolean };
  liquidaciones: { roster: number; generadas: number; borradores: number; confirmadas: number };
  declaracion: { declarada: string | null; filename: string | null; rectificativas: number; cambiosPosteriores: boolean };
  pagos: { liquidos: string };
}

export interface DeclaracionResumen {
  id: string;
  year: number;
  month: number;
  tipo: 'N' | 'R';
  filename: string;
  montoTotal: string;
  createdAt: string;
}

export const nominaApi = {
  checklist: (companyId: string) =>
    api.get<NominaChecklist>('/nomina/checklist', { params: { companyId } }).then((r) => r.data),
  centroMes: (companyId: string, year: number, month: number) =>
    api.get<CentroMes>('/nomina/centro-mes', { params: { companyId, year, month } }).then((r) => r.data),
  declaraciones: (companyId: string) =>
    api.get<{ ultima: DeclaracionResumen | null; historial: DeclaracionResumen[] }>('/nomina/declaraciones', { params: { companyId } }).then((r) => r.data),
  importar: (file: File, commit: boolean) => {
    const fd = new FormData();
    fd.append('commit', commit ? 'true' : 'false');
    fd.append('file', file);
    return api.post<NominaImportPlan>('/nomina/import', fd).then((r) => r.data);
  },
  preview: (companyId: string, year: number, month: number) =>
    api.get<NominaPreview>('/nomina/preview', { params: { companyId, year, month } }).then((r) => r.data),
  archivo: (companyId: string, year: number, month: number) =>
    api.get('/nomina/archivo', { params: { companyId, year, month }, responseType: 'blob' }).then((r) => r.data as Blob),
  rectPreview: (companyId: string, year: number, month: number) =>
    api.get<RectificativaPreview>('/nomina/rectificativa/preview', { params: { companyId, year, month } }).then((r) => r.data),
  rectArchivo: (companyId: string, year: number, month: number) =>
    api.get('/nomina/rectificativa/archivo', { params: { companyId, year, month }, responseType: 'blob' }).then((r) => r.data as Blob),
};

export const conceptsApi = {
  list: (companyId: string) => api.get<Concepto[]>('/concepts', { params: { companyId } }).then((r) => r.data),
  create: (data: object) => api.post<Concepto>('/concepts', data).then((r) => r.data),
  update: (id: string, data: object) => api.put<Concepto>(`/concepts/${id}`, data).then((r) => r.data),
  setVisibility: (id: string, companyId: string, oculto: boolean) =>
    api.post<Concepto>(`/concepts/${id}/visibilidad`, { companyId, oculto }).then((r) => r.data),
  delete: (id: string) => api.delete(`/concepts/${id}`).then((r) => r.data),
};

export const employeesApi = {
  list: (params: { companyId?: string; search?: string; page?: number; limit?: number; includeInactive?: boolean }) =>
    api.get<{ data: Employee[]; pagination: { total: number; page: number; limit: number; pages: number } }>(
      '/employees', { params },
    ).then((r) => r.data),
  get: (id: string) => api.get<Employee>(`/employees/${id}`).then((r) => r.data),
  create: (data: object) => api.post<Employee>('/employees', data).then((r) => r.data),
  update: (id: string, data: object) => api.put<Employee>(`/employees/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/employees/${id}`).then((r) => r.data),
  deletePermanent: (id: string) => api.delete(`/employees/${id}/permanent`).then((r) => r.data),
  history: (id: string) => api.get(`/employees/${id}/history`).then((r) => r.data),
  liquidations: (id: string) => api.get<Liquidation[]>(`/employees/${id}/liquidations`).then((r) => r.data),
  vacation: (id: string) => api.get(`/employees/${id}/vacation`).then((r) => r.data),
};

export const contractsApi = {
  list: (employeeId: string) => api.get<Contrato[]>(`/employees/${employeeId}/contracts`).then((r) => r.data),
  create: (employeeId: string, data: object) => api.post<Contrato>(`/employees/${employeeId}/contracts`, data).then((r) => r.data),
  update: (employeeId: string, contractId: string, data: object) => api.put<Contrato>(`/employees/${employeeId}/contracts/${contractId}`, data).then((r) => r.data),
  documento: (employeeId: string, contractId: string, prueba = false) =>
    api.get(`/employees/${employeeId}/contracts/${contractId}/documento`, { responseType: 'blob', params: prueba ? { prueba: 1 } : {} }).then((r) => r.data as Blob),
  baja: (employeeId: string, contractId: string, fechaEgreso: string, motivo?: string, causalEgresoCod?: number) =>
    api.post<Contrato & { liquidacionFinalId?: string | null; desvinculadaTotal?: boolean; aviso?: string }>(
      `/employees/${employeeId}/contracts/${contractId}/baja`, { fechaEgreso, motivo, causalEgresoCod },
    ).then((r) => r.data),
  delete: (employeeId: string, contractId: string) => api.delete(`/employees/${employeeId}/contracts/${contractId}`).then((r) => r.data),
  remove: (employeeId: string, contractId: string) => api.delete(`/employees/${employeeId}/contracts/${contractId}/eliminar`).then((r) => r.data),
  reactivar: (employeeId: string, contractId: string) => api.post(`/employees/${employeeId}/contracts/${contractId}/reactivar`).then((r) => r.data as { finalesEliminadas?: number }),
  listByCompany: (companyId: string) =>
    api.get('/contracts', { params: { companyId } }).then((r) => r.data as Array<Contrato & { employee: { id: string; ci: string; nombre: string; apellido: string } }>),
  persons: () => api.get('/contracts/persons').then((r) => r.data as Array<{ id: string; ci: string; nombre: string; apellido: string }>),
};

export const liquidationApi = {
  listPeriods: (params: { companyId?: string; year?: number }) =>
    api.get<PayrollPeriod[]>('/liquidation/periods', { params }).then((r) => r.data),
  createPeriod: (data: { companyId: string; year: number; month: number }) =>
    api.post<PayrollPeriod>('/liquidation/periods', data).then((r) => r.data),
  deletePeriod: (periodId: string) => api.delete(`/liquidation/periods/${periodId}`).then((r) => r.data),
  deleteLiquidation: (id: string) => api.delete(`/liquidation/${id}`).then((r) => r.data),
  confirmBatch: (periodId: string) => api.post('/liquidation/confirm-batch', { periodId }).then((r) => r.data as { confirmed: number; failed: number }),
  cerrarPeriodo: (periodId: string) => api.post(`/liquidation/periods/${periodId}/cerrar`).then((r) => r.data),
  periodRoster: (periodId: string) =>
    api.get(`/liquidation/period/${periodId}/roster`).then((r) => r.data as Array<{ id: string; ci: string; employeeNumber?: number | null; nombre: string; apellido: string; active: boolean; cargo?: string | null; salarioNominal: string; fechaIngreso: string; excluido: boolean }>),
  excludeFromPeriod: (periodId: string, employeeId: string) =>
    api.post(`/liquidation/period/${periodId}/exclude`, { employeeId }).then((r) => r.data),
  includeInPeriod: (periodId: string, employeeId: string) =>
    api.delete(`/liquidation/period/${periodId}/exclude/${employeeId}`).then((r) => r.data),
  generate: (data: object) => api.post('/liquidation/generate', data).then((r) => r.data),
  generateBatch: (data: object) => api.post('/liquidation/generate-batch', data).then((r) => r.data),
  generateAguinaldo: (data: object) => api.post('/liquidation/aguinaldo', data).then((r) => r.data),
  generateLicencia: (data: object) => api.post('/liquidation/licencia', data).then((r) => r.data),
  generateFinal: (data: object) => api.post('/liquidation/final', data).then((r) => r.data),
  preview: (id: string) => api.get<Liquidation>(`/liquidation/${id}/preview`).then((r) => r.data),
  confirm: (id: string) => api.post(`/liquidation/${id}/confirm`).then((r) => r.data),
  unconfirm: (id: string) => api.post(`/liquidation/${id}/unconfirm`).then((r) => r.data),
  recalcular: (id: string) => api.post(`/liquidation/${id}/recalcular`).then((r) => r.data),
  cancel: (id: string) => api.post(`/liquidation/${id}/cancel`).then((r) => r.data),
  addAdjustment: (id: string, data: object) =>
    api.post(`/liquidation/${id}/adjustment`, data).then((r) => r.data),
  addItem: (id: string, data: { descripcion: string; monto?: number; cantidad?: number; itemType: 'HABER' | 'DESCUENTO_OBRERO' }) =>
    api.post(`/liquidation/${id}/item`, data).then((r) => r.data),
  updateItem: (id: string, itemId: string, data: { descripcion?: string; monto?: number }) =>
    api.patch(`/liquidation/${id}/item/${itemId}`, data).then((r) => r.data),
  deleteItem: (id: string, itemId: string) =>
    api.delete(`/liquidation/${id}/item/${itemId}`).then((r) => r.data),
  reciboUrl: (id: string) => `${BASE_URL}/api/liquidation/${id}/recibo`,
  recibo: (id: string) => api.get(`/liquidation/${id}/recibo`, { responseType: 'blob' }).then((r) => r.data as Blob),
  byPeriod: (periodId: string) =>
    api.get(`/liquidation/period/${periodId}`).then((r) => r.data),
};

export const parametersApi = {
  current: (date?: string) =>
    api.get<PayrollParameters>('/parameters', { params: { date } }).then((r) => r.data),
  list: () => api.get('/parameters/list').then((r) => r.data),
  create: (data: object) => api.post('/parameters', data).then((r) => r.data),
  getTaxBrackets: (date?: string) =>
    api.get('/parameters/tax-brackets', { params: { date } }).then((r) => r.data),
  updateTaxBrackets: (data: object) => api.post('/parameters/tax-brackets', data).then((r) => r.data),
  getLaudos: (companyId?: string) =>
    api.get('/parameters/laudos', { params: { companyId } }).then((r) => r.data),
  createLaudo: (data: object) => api.post('/parameters/laudos', data).then((r) => r.data),
};

export const reportsApi = {
  nominaMensual: (params: { companyId?: string; year: number; month: number }) =>
    api.get<{ period: PayrollPeriod; nomina: NominaItem[]; summary: object }>(
      '/reports/nomina-mensual', { params },
    ).then((r) => r.data),
  bpsNomina: (params: { companyId?: string; year: number; month: number }) =>
    api.get('/reports/bps-nomina', { params }).then((r) => r.data),
  irpfSummary: (params: { companyId?: string; year: number }) =>
    api.get('/reports/irpf-summary', { params }).then((r) => r.data),
  nominaExcelUrl: (companyId: string, year: number, month: number) =>
    `${BASE_URL}/api/reports/nomina-excel?companyId=${companyId}&year=${year}&month=${month}`,
  pagosMes: (params: { companyId?: string; year: number; month: number }) =>
    api.get<PagosMesReport>('/reports/pagos-mes', { params }).then((r) => r.data),
  costoPersonal: (params: { companyId?: string; year: number; month: number }) =>
    api.get<CostoPersonalReport>('/reports/costo-personal', { params }).then((r) => r.data),
  acumuladoAnual: (companyId: string, year: number) =>
    api.get<AcumuladoAnual>('/reports/acumulado-anual', { params: { companyId, year } }).then((r) => r.data),
  pagosBanco: (params: { companyId?: string; year: number; month: number }) =>
    api.get<PagosBancoReport>('/reports/pagos-banco', { params }).then((r) => r.data),
  pagosBancoArchivo: (companyId: string, year: number, month: number, formato: 'xlsx' | 'brou' | 'csv') =>
    api.get(`/reports/pagos-banco/archivo`, { params: { companyId, year, month, formato }, responseType: 'blob' }).then((r) => r.data as Blob),
  asiento: (params: { companyId?: string; year: number; month: number }) =>
    api.get<AsientoReport>('/reports/asiento', { params }).then((r) => r.data),
  asientoExcel: (companyId: string, year: number, month: number) =>
    api.get('/reports/asiento/excel', { params: { companyId, year, month }, responseType: 'blob' }).then((r) => r.data as Blob),
  asientoTxt: (companyId: string, year: number, month: number) =>
    api.get('/reports/asiento/txt', { params: { companyId, year, month }, responseType: 'blob' }).then((r) => r.data as Blob),
};

export interface FilaPagoBanco {
  employeeId: string;
  legajo: number | null;
  ci: string;
  nombre: string;
  banco: string;
  sucursal: string;
  cuenta: string;
  moneda: string;
  liquidoPesos: number;
  liquidaciones: number;
  sinCuenta: boolean;
}
export interface PagosBancoReport {
  filas: FilaPagoBanco[];
  totalPesos: number;
  confirmadas: number;
  avisos: string[];
}
export interface LineaAsiento { cuenta: string; debe: string; haber: string }
export interface AsientoReport {
  lineas: LineaAsiento[];
  totalDebe: string;
  totalHaber: string;
  balanceado: boolean;
  liquidaciones: number;
}

export interface AcumuladoAnual extends ResumenPagos {
  year: number;
  meses: number;
  liquidaciones: number;
  haberes: string;
}

export interface ResumenPagos {
  liquidos: string;
  bps: {
    obrero: { jubilatorio: string; fonasa: string; frl: string; total: string };
    patronal: { jubilatorio: string; fonasa: string; frl: string; total: string };
    total: string;
  };
  irpf: string;
  bse: string;
  otrasRetenciones: string;
  totalDesembolso: string;
  empleados: number;
}

export interface PagosMesReport {
  period: { year: number; month: number; status: string } | null;
  actual: ResumenPagos;
  anterior: ResumenPagos & { year: number; month: number };
  liquidacionesConfirmadas: number;
}

export interface CostoPersonalReport {
  period: { year: number; month: number; status: string } | null;
  filas: Array<{
    empleado: { id: string; ci: string; nombre: string; apellido: string; cargo: string | null } | null;
    haberes: string;
    liquido: string;
    patronales: string;
    provisiones: { aguinaldo: string; patronalAguinaldo: string; salarioVacacional: string };
    costoTotal: string;
  }>;
  totales: { haberes: string; liquido: string; patronales: string; provisiones: string; costoTotal: string } | null;
}

export default api;
