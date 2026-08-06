import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { CompanyProvider } from './hooks/useCompany';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CompaniesPage from './pages/CompaniesPage';
import ConceptsPage from './pages/ConceptsPage';
import ContractsPage from './pages/ContractsPage';
import EmployeesPage from './pages/EmployeesPage';
import EmployeeFormPage from './pages/EmployeeFormPage';
import EmployeeDetailPage from './pages/EmployeeDetailPage';
import LiquidationPage from './pages/LiquidationPage';
import LiquidationDetailPage from './pages/LiquidationDetailPage';
import ReportsPage from './pages/ReportsPage';
import NominaPage from './pages/NominaPage';
import CalendarioPage from './pages/CalendarioPage';
import CentroMesPage from './pages/CentroMesPage';
import ParametersPage from './pages/ParametersPage';
import AccessPage from './pages/AccessPage';
import AuditPage from './pages/AuditPage';
import ImportPage from './pages/ImportPage';
import PortalLoginPage from './pages/portal/PortalLoginPage';
import PortalSetPinPage from './pages/portal/PortalSetPinPage';
import PortalRecibosPage from './pages/portal/PortalRecibosPage';

// El portal de empleados tiene su propio token ('portalToken'), separado del
// panel de administración. Sin token, al login del portal.
function PortalRoute({ children }: { children: React.ReactNode }) {
  if (!localStorage.getItem('portalToken')) return <Navigate to="/portal" replace />;
  return <>{children}</>;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />

      {/* Portal de empleados (fuera del panel de administración) */}
      <Route path="/portal" element={<PortalLoginPage />} />
      <Route path="/portal/nuevo-pin" element={<PortalSetPinPage />} />
      <Route path="/portal/recibos" element={<PortalRoute><PortalRecibosPage /></PortalRoute>} />

      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="concepts" element={<ConceptsPage />} />
        <Route path="contracts" element={<ContractsPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="employees/new" element={<EmployeeFormPage />} />
        <Route path="employees/:id/edit" element={<EmployeeFormPage />} />
        <Route path="employees/:id" element={<EmployeeDetailPage />} />
        <Route path="liquidation" element={<LiquidationPage />} />
        <Route path="liquidation/:id" element={<LiquidationDetailPage />} />
        <Route path="nomina" element={<NominaPage />} />
        <Route path="calendario" element={<CalendarioPage />} />
        <Route path="mes" element={<CentroMesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="parameters" element={<ParametersPage />} />
        <Route path="access" element={<AccessPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="import" element={<ImportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CompanyProvider>
          <AppRoutes />
        </CompanyProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
