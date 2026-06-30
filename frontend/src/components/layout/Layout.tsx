import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, BarChart2,
  Settings, LogOut, Building2, Calculator, Briefcase, UserCog, Upload, Menu, X,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useCompany } from '../../hooks/useCompany';
import GroLogo from '../GroLogo';

const navItems = [
  { to: '/', label: 'Panel', icon: LayoutDashboard, end: true },
  { to: '/companies', label: 'Empresas', icon: Building2 },
  { to: '/employees', label: 'Personas', icon: Users },
  { to: '/import', label: 'Importar', icon: Upload },
  { to: '/contracts', label: 'Contratos', icon: Briefcase },
  { to: '/concepts', label: 'Conceptos', icon: Calculator },
  { to: '/liquidation', label: 'Liquidaciones', icon: FileText },
  { to: '/reports', label: 'Reportes', icon: BarChart2 },
  { to: '/access', label: 'Accesos', icon: UserCog },
  { to: '/parameters', label: 'Parámetros', icon: Settings },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { companies, activeCompanyId, setActiveCompanyId } = useCompany();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Backdrop (solo celular, con el menú abierto) */}
      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Barra lateral: cajón deslizable en celular, fija en escritorio */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-gradient-to-b from-[#00307F] to-[#003DA5] flex flex-col transform transition-transform duration-200 lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-5 py-5 flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <GroLogo variant="light" height={32} />
            <p className="text-blue-200/80 text-[11px] tracking-wide pl-0.5">Sueldos · Nómina 2026</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-blue-200 hover:text-white lg:hidden" aria-label="Cerrar menú">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-white text-[#003DA5] shadow-sm shadow-blue-900/20'
                    : 'text-blue-100 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon size={18} className="shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-3 mt-auto border-t border-white/10">
          <div className="flex items-center gap-3 px-2 mb-2">
            <div className="w-9 h-9 bg-white/15 rounded-full flex items-center justify-center ring-1 ring-white/20">
              <span className="text-white text-xs font-bold">{user?.nombre?.[0]}{user?.apellido?.[0]}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold truncate">{user?.nombre} {user?.apellido}</p>
              <p className="text-blue-200/80 text-[11px] truncate">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-blue-100 hover:text-white text-xs w-full px-2 py-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-white/95 backdrop-blur border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-2 sticky top-0 z-20">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setOpen(true)} className="lg:hidden text-gray-500 hover:text-gray-700 p-1 -ml-1" aria-label="Abrir menú">
              <Menu size={22} />
            </button>
            <Building2 size={16} className="text-[#003DA5] hidden sm:block shrink-0" />
            {companies.length > 0 ? (
              <select
                value={activeCompanyId}
                onChange={(e) => setActiveCompanyId(e.target.value)}
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-700 bg-white max-w-[55vw] sm:max-w-xs truncate focus:outline-none focus:ring-2 focus:ring-[#003DA5]/30 focus:border-[#003DA5]"
                title="Empresa activa"
              >
                {companies.map((c) => (
                  <option key={c.companyId} value={c.companyId}>
                    {c.nombreFantasia || c.razonSocial}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-gray-700 font-medium text-sm truncate">Sistema de Nómina</span>
            )}
          </div>
          <div className="text-xs text-gray-400 hidden md:block shrink-0">
            {new Date().toLocaleDateString('es-UY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
