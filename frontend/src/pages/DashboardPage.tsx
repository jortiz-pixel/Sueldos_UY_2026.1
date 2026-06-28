import { useQuery } from '@tanstack/react-query';
import { Users, FileText, DollarSign, TrendingUp, AlertCircle } from 'lucide-react';
import { employeesApi, liquidationApi, reportsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import { formatPesos, MESES } from '../types';
import { Link } from 'react-router-dom';

export default function DashboardPage() {
  const { user } = useAuth();
  const { activeCompanyId: companyId } = useCompany();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const { data: employees } = useQuery({
    queryKey: ['employees', companyId],
    queryFn: () => employeesApi.list({ companyId, limit: 5 }),
    enabled: !!companyId,
  });

  const { data: periods } = useQuery({
    queryKey: ['periods', companyId, year],
    queryFn: () => liquidationApi.listPeriods({ companyId, year }),
    enabled: !!companyId,
  });

  const { data: nomina } = useQuery({
    queryKey: ['nomina', companyId, year, month],
    queryFn: () => reportsApi.nominaMensual({ companyId, year, month }),
    enabled: !!companyId,
  });

  const summary = nomina?.summary as Record<string, string> | undefined;

  const stats = [
    {
      label: 'Empleados Activos',
      value: employees?.pagination.total ?? '-',
      icon: Users,
      color: 'bg-blue-500',
      link: '/employees',
    },
    {
      label: `Total Haberes ${MESES[month]}`,
      value: summary ? formatPesos(summary.totalHaberes) : '-',
      icon: DollarSign,
      color: 'bg-green-500',
      link: '/reports',
    },
    {
      label: `Líquido a Pagar ${MESES[month]}`,
      value: summary ? formatPesos(summary.totalLiquidoPercibir) : '-',
      icon: TrendingUp,
      color: 'bg-indigo-500',
      link: '/reports',
    },
    {
      label: 'Períodos del Año',
      value: periods?.length ?? '-',
      icon: FileText,
      color: 'bg-orange-500',
      link: '/liquidation',
    },
  ];

  const currentPeriod = periods?.find((p) => p.month === month && p.year === year);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Panel Principal</h1>
        <p className="text-gray-500 text-sm mt-1">
          {MESES[month]} {year} — Bienvenido, {user?.nombre}
        </p>
      </div>

      {/* Alert si no hay período activo */}
      {!currentPeriod && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle className="text-amber-500 flex-shrink-0" size={20} />
          <div>
            <p className="text-sm font-medium text-amber-800">Sin período activo</p>
            <p className="text-xs text-amber-700">
              No hay un período de liquidación para {MESES[month]} {year}.{' '}
              <Link to="/liquidation" className="underline font-medium">Crear período</Link>
            </p>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color, link }) => (
          <Link key={label} to={link} className="card p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-gray-500">{label}</p>
              <div className={`w-8 h-8 ${color} rounded-lg flex items-center justify-center`}>
                <Icon className="text-white" size={16} />
              </div>
            </div>
            <p className="text-xl font-bold text-gray-900">{value}</p>
          </Link>
        ))}
      </div>

      {/* Recent employees */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Últimos Empleados</h2>
              <Link to="/employees" className="text-xs text-blue-600 hover:underline">Ver todos →</Link>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {employees?.data.slice(0, 5).map((emp) => (
              <Link
                key={emp.id}
                to={`/employees/${emp.id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-700 text-xs font-bold">
                    {emp.nombre[0]}{emp.apellido[0]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {emp.apellido}, {emp.nombre}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{emp.cargo || emp.categoria || 'Sin cargo'}</p>
                </div>
                <p className="text-xs font-mono text-gray-600 flex-shrink-0">
                  {formatPesos(emp.salarioNominal)}
                </p>
              </Link>
            ))}
          </div>
        </div>

        {/* Period summary */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Nómina {MESES[month]} {year}</h2>
              <Link to="/liquidation" className="text-xs text-blue-600 hover:underline">Gestionar →</Link>
            </div>
          </div>
          {summary ? (
            <div className="p-5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Empleados liquidados</span>
                <span className="font-medium">{summary.empleados}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total haberes</span>
                <span className="font-medium text-gray-800">{formatPesos(summary.totalHaberes)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total descuentos</span>
                <span className="font-medium text-red-600">({formatPesos(summary.totalDescuentos)})</span>
              </div>
              <div className="flex justify-between text-sm font-semibold border-t border-gray-100 pt-3">
                <span>Líquido a pagar</span>
                <span className="text-green-700">{formatPesos(summary.totalLiquidoPercibir)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-400 border-t border-gray-100 pt-2">
                <span>Aportes patronales</span>
                <span>{formatPesos(summary.totalPatronal)}</span>
              </div>
            </div>
          ) : (
            <div className="p-5 text-center text-sm text-gray-400">
              Sin liquidaciones para este período
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
