import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, BarChart2,
  Settings, LogOut, Building2, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const navItems = [
  { to: '/', label: 'Panel', icon: LayoutDashboard, end: true },
  { to: '/employees', label: 'Empleados', icon: Users },
  { to: '/liquidation', label: 'Liquidaciones', icon: FileText },
  { to: '/reports', label: 'Reportes', icon: BarChart2 },
  { to: '/parameters', label: 'Parámetros', icon: Settings },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-[#003DA5] flex flex-col">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-blue-800">
          <div className="flex items-center gap-2">
            <Building2 className="text-white" size={24} />
            <div>
              <h1 className="text-white font-bold text-sm">Sueldos UY</h1>
              <p className="text-blue-200 text-xs">Sistema de Nómina 2026</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'text-blue-100 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-blue-800">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-blue-400 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">
                {user?.nombre?.[0]}{user?.apellido?.[0]}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{user?.nombre} {user?.apellido}</p>
              <p className="text-blue-200 text-xs truncate">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-blue-200 hover:text-white text-xs w-full px-2 py-1.5 rounded hover:bg-white/10 transition-colors"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Building2 size={14} />
            <ChevronRight size={12} />
            <span className="text-gray-700 font-medium">Empresa Demo S.A.</span>
          </div>
          <div className="text-xs text-gray-400">
            {new Date().toLocaleDateString('es-UY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
