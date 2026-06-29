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

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }).then((r) => r.data),
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

export type CalendarEventType = 'CUMPLEANOS' | 'VENC_CARNE_SALUD' | 'VENC_LIBRETA' | 'ALTA' | 'BAJA';

export interface CalendarEvent {
  tipo: CalendarEventType;
  fecha: string;
  titulo: string;
  personaId?: string;
}

export const calendarApi = {
  upcoming: (companyId: string, days = 45) =>
    api.get<CalendarEvent[]>('/calendar', { params: { companyId, days } }).then((r) => r.data),
};

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

export const catalogsApi = {
  tiposAporte: () => api.get<TipoAporte[]>('/catalogs/tipos-aporte').then((r) => r.data),
  tiposContribuyente: () => api.get<TipoContribuyente[]>('/catalogs/tipos-contribuyente').then((r) => r.data),
  gruposActividad: () => api.get<GrupoActividad[]>('/catalogs/grupos-actividad').then((r) => r.data),
};

export const conceptsApi = {
  list: (companyId: string) => api.get<Concepto[]>('/concepts', { params: { companyId } }).then((r) => r.data),
  create: (data: object) => api.post<Concepto>('/concepts', data).then((r) => r.data),
  update: (id: string, data: object) => api.put<Concepto>(`/concepts/${id}`, data).then((r) => r.data),
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
  history: (id: string) => api.get(`/employees/${id}/history`).then((r) => r.data),
  liquidations: (id: string) => api.get<Liquidation[]>(`/employees/${id}/liquidations`).then((r) => r.data),
  vacation: (id: string) => api.get(`/employees/${id}/vacation`).then((r) => r.data),
};

export const contractsApi = {
  list: (employeeId: string) => api.get<Contrato[]>(`/employees/${employeeId}/contracts`).then((r) => r.data),
  create: (employeeId: string, data: object) => api.post<Contrato>(`/employees/${employeeId}/contracts`, data).then((r) => r.data),
  update: (employeeId: string, contractId: string, data: object) => api.put<Contrato>(`/employees/${employeeId}/contracts/${contractId}`, data).then((r) => r.data),
  delete: (employeeId: string, contractId: string) => api.delete(`/employees/${employeeId}/contracts/${contractId}`).then((r) => r.data),
  listByCompany: (companyId: string) =>
    api.get('/contracts', { params: { companyId } }).then((r) => r.data as Array<Contrato & { employee: { id: string; ci: string; nombre: string; apellido: string } }>),
  persons: () => api.get('/contracts/persons').then((r) => r.data as Array<{ id: string; ci: string; nombre: string; apellido: string }>),
};

export const liquidationApi = {
  listPeriods: (params: { companyId?: string; year?: number }) =>
    api.get<PayrollPeriod[]>('/liquidation/periods', { params }).then((r) => r.data),
  createPeriod: (data: { companyId: string; year: number; month: number }) =>
    api.post<PayrollPeriod>('/liquidation/periods', data).then((r) => r.data),
  generate: (data: object) => api.post('/liquidation/generate', data).then((r) => r.data),
  generateBatch: (data: object) => api.post('/liquidation/generate-batch', data).then((r) => r.data),
  generateAguinaldo: (data: object) => api.post('/liquidation/aguinaldo', data).then((r) => r.data),
  generateLicencia: (data: object) => api.post('/liquidation/licencia', data).then((r) => r.data),
  generateFinal: (data: object) => api.post('/liquidation/final', data).then((r) => r.data),
  preview: (id: string) => api.get<Liquidation>(`/liquidation/${id}/preview`).then((r) => r.data),
  confirm: (id: string) => api.post(`/liquidation/${id}/confirm`).then((r) => r.data),
  cancel: (id: string) => api.post(`/liquidation/${id}/cancel`).then((r) => r.data),
  addAdjustment: (id: string, data: object) =>
    api.post(`/liquidation/${id}/adjustment`, data).then((r) => r.data),
  reciboUrl: (id: string) => `${BASE_URL}/api/liquidation/${id}/recibo`,
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
};

export default api;
