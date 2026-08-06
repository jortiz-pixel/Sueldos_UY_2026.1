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
import PortalChooserPage from './pages/portal/PortalChooserPage';
import PortalLoginPage from './pages/portal/PortalLoginPage';
import PortalSetPinPage from './pages/portal/PortalSetPinPage';
import PortalRecibosPage from './pages/portal/PortalRecibosPage';
import CompanyPortalLoginPage from './pages/portal/CompanyPortalLoginPage';
import CompanyPortalSetPinPage from './pages/portal/CompanyPortalSetPinPage';
import CompanyPortalRecibosPage from './pages/portal/CompanyPortalRecibosPage';

// El portal de empleados tiene su propio token ('portalToken'), separado del
// panel de administración. Sin token, al login del portal.
function PortalRoute({ children }: { children: React.ReactNode }) {
  if (!localStorage.getItem('portalToken')) return <Navigate to="/portal/empleado" replace />;
  return <>{children}</>;
}

// El portal de clientes (empresas) usa su propio token ('portalEmpresaToken').
function CompanyPortalRoute({ children }: { children: React.ReactNode }) {
  if (!localStorage.getItem('portalEmpresaToken')) return <Navigate to="/portal/empresa" replace />;
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

      {/* Portal (fuera del panel de administración): un solo punto de entrada
          que pregunta si se ingresa como empleado o como empresa. */}
      <Route path="/portal" element={<PortalChooserPage />} />
      {/* Empleados */}
      <Route path="/portal/empleado" element={<PortalLoginPage />} />
      <Route path="/portal/empleado/nuevo-pin" element={<PortalSetPinPage />} />
      <Route path="/portal/empleado/recibos" element={<PortalRoute><PortalRecibosPage /></PortalRoute>} />
      {/* Empresas / clientes */}
      <Route path="/portal/empresa" element={<CompanyPortalLoginPage />} />
      <Route path="/portal/empresa/nuevo-pin" element={<CompanyPortalSetPinPage />} />
      <Route path="/portal/empresa/recibos" element={<CompanyPortalRoute><CompanyPortalRecibosPage /></CompanyPortalRoute>} />
      {/* Compatibilidad con la ruta anterior del portal de clientes */}
      <Route path="/portal-empresa" element={<Navigate to="/portal/empresa" replace />} />

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
