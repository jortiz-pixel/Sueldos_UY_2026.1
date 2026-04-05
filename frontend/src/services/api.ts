import axios, { AxiosInstance, AxiosError } from 'axios';
import { AuthResponse, User, Company, Employee, PayrollPeriod, Liquidation, NominaItem, PayrollParameters } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || '';

// =============================================================
// Axios instance with interceptors
// =============================================================
const api: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
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

// =============================================================
// Auth
// =============================================================
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

// =============================================================
// Companies
// =============================================================
export const companiesApi = {
  list: () => api.get<Company[]>('/companies').then((r) => r.data),
  get: (id: string) => api.get<Company>(`/companies/${id}`).then((r) => r.data),
  create: (data: Partial<Company>) => api.post<Company>('/companies', data).then((r) => r.data),
  update: (id: string, data: Partial<Company>) => api.put<Company>(`/companies/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/companies/${id}`).then((r) => r.data),
  getUsers: (id: string) => api.get(`/companies/${id}/users`).then((r) => r.data),
  createUser: (id: string, data: object) => api.post(`/companies/${id}/users`, data).then((r) => r.data),
};

// =============================================================
// Employees
// =============================================================
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

// =============================================================
// Liquidation
// =============================================================
export const liquidationApi = {
  // Periods
  listPeriods: (params: { companyId?: string; year?: number }) =>
    api.get<PayrollPeriod[]>('/liquidation/periods', { params }).then((r) => r.data),
  createPeriod: (data: { companyId: string; year: number; month: number }) =>
    api.post<PayrollPeriod>('/liquidation/periods', data).then((r) => r.data),

  // Generate
  generate: (data: object) => api.post('/liquidation/generate', data).then((r) => r.data),
  generateBatch: (data: object) => api.post('/liquidation/generate-batch', data).then((r) => r.data),
  generateAguinaldo: (data: object) => api.post('/liquidation/aguinaldo', data).then((r) => r.data),
  generateLicencia: (data: object) => api.post('/liquidation/licencia', data).then((r) => r.data),
  generateFinal: (data: object) => api.post('/liquidation/final', data).then((r) => r.data),

  // CRUD
  preview: (id: string) => api.get<Liquidation>(`/liquidation/${id}/preview`).then((r) => r.data),
  confirm: (id: string) => api.post(`/liquidation/${id}/confirm`).then((r) => r.data),
  cancel: (id: string) => api.post(`/liquidation/${id}/cancel`).then((r) => r.data),
  addAdjustment: (id: string, data: object) =>
    api.post(`/liquidation/${id}/adjustment`, data).then((r) => r.data),
  reciboUrl: (id: string) => `${BASE_URL}/api/liquidation/${id}/recibo`,
  byPeriod: (periodId: string) =>
    api.get(`/liquidation/period/${periodId}`).then((r) => r.data),
};

// =============================================================
// Parameters
// =============================================================
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

// =============================================================
// Reports
// =============================================================
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
