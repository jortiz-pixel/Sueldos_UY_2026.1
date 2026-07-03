import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, FileText, DollarSign, TrendingUp, AlertCircle, CalendarDays, Cake, AlertTriangle, UserPlus, UserMinus, X, Landmark, Plane } from 'lucide-react';
import { employeesApi, liquidationApi, reportsApi, calendarApi, CalendarEventType, contractsApi, catalogsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useForm } from 'react-hook-form';
import { useCompany } from '../hooks/useCompany';
import { formatPesos, MESES, Employee } from '../types';
import { Link } from 'react-router-dom';

const EVENT_META: Record<CalendarEventType, { color: string; icon: typeof Cake }> = {
  CUMPLEANOS: { color: 'text-pink-600 bg-pink-50', icon: Cake },
  VENC_CARNE_SALUD: { color: 'text-amber-600 bg-amber-50', icon: AlertTriangle },
  VENC_LIBRETA: { color: 'text-amber-600 bg-amber-50', icon: AlertTriangle },
  ALTA: { color: 'text-green-600 bg-green-50', icon: UserPlus },
  BAJA: { color: 'text-red-600 bg-red-50', icon: UserMinus },
  LICENCIA: { color: 'text-brand-700 bg-brand-50', icon: Plane },
  REINTEGRO: { color: 'text-brand-600 bg-brand-50', icon: UserPlus },
  VENC_NOMINA_BPS: { color: 'text-red-600 bg-red-50', icon: Landmark },
};

function relativo(fecha: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(fecha + 'T00:00:00');
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} días`;
}

export default function DashboardPage() {
  const { user, isOperator } = useAuth();
  const { activeCompanyId: companyId } = useCompany();
  const queryClient = useQueryClient();
  const [bajaOpen, setBajaOpen] = useState(false);
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

  const { data: eventos } = useQuery({
    queryKey: ['calendar', companyId],
    queryFn: () => calendarApi.upcoming(companyId, 45),
    enabled: !!companyId,
  });

  const summary = nomina?.summary as Record<string, string> | undefined;

  const stats = [
    {
      label: 'Empleados Activos',
      value: employees?.pagination.total ?? '-',
      icon: Users,
      tint: 'bg-brand-50 text-brand-600',
      link: '/employees',
    },
    {
      label: `Total Haberes ${MESES[month]}`,
      value: summary ? formatPesos(summary.totalHaberes) : '-',
      icon: DollarSign,
      tint: 'bg-emerald-50 text-emerald-600',
      link: '/reports',
    },
    {
      label: `Líquido a Pagar ${MESES[month]}`,
      value: summary ? formatPesos(summary.totalLiquidoPercibir) : '-',
      icon: TrendingUp,
      tint: 'bg-indigo-50 text-indigo-600',
      link: '/reports',
    },
    {
      label: 'Períodos del Año',
      value: periods?.length ?? '-',
      icon: FileText,
      tint: 'bg-amber-50 text-amber-600',
      link: '/liquidation',
    },
  ];

  const currentPeriod = periods?.find((p) => p.month === month && p.year === year);

  return (
    <div className="space-y-6">
      {/* Header + acciones rápidas */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink font-brand">Hola, {user?.nombre} 👋</h1>
          <p className="text-ink-subtle text-sm mt-1">
            Resumen de <span className="font-medium text-ink-muted">{MESES[month]} {year}</span>
          </p>
        </div>
        {isOperator && (
          <div className="flex items-center gap-2">
            <Link to="/employees/new" className="btn-primary btn-sm">
              <UserPlus size={15} /> Alta de personal
            </Link>
            <button onClick={() => setBajaOpen(true)} className="btn-secondary btn-sm">
              <UserMinus size={15} /> Baja de personal
            </button>
          </div>
        )}
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
        {stats.map(({ label, value, icon: Icon, tint, link }) => (
          <Link
            key={label}
            to={link}
            className="card p-5 hover:shadow-md hover:-translate-y-0.5 transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`w-11 h-11 ${tint} rounded-xl flex items-center justify-center`}>
                <Icon size={20} />
              </div>
            </div>
            <p className="text-2xl font-bold text-ink leading-none font-brand tabular-nums">{value}</p>
            <p className="text-xs font-medium text-ink-subtle mt-2 group-hover:text-ink-muted transition-colors">{label}</p>
          </Link>
        ))}
      </div>

      {/* Próximos eventos */}
      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <CalendarDays size={16} className="text-brand-600" />
          <h2 className="text-sm font-semibold text-gray-700">Próximos eventos (45 días)</h2>
        </div>
        {eventos && eventos.length > 0 ? (
          <div className="divide-y divide-gray-50 max-h-80 overflow-auto">
            {eventos.map((ev, i) => {
              const meta = EVENT_META[ev.tipo];
              const Icon = meta.icon;
              return (
                <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
                    <Icon size={15} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{ev.titulo}</p>
                    <p className="text-xs text-gray-400">{new Date(ev.fecha + 'T00:00:00').toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                  </div>
                  <span className="text-xs font-medium text-gray-500 shrink-0">{relativo(ev.fecha)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-5 text-center text-sm text-gray-400">Sin eventos próximos</div>
        )}
      </div>

      {/* Recent employees */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Últimos Empleados</h2>
              <Link to="/employees" className="text-xs text-brand-600 hover:underline font-medium">Ver todos →</Link>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {employees?.data.slice(0, 5).map((emp) => (
              <Link
                key={emp.id}
                to={`/employees/${emp.id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
              >
                <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-brand-700 text-xs font-bold">
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
              <Link to="/liquidation" className="text-xs text-brand-600 hover:underline font-medium">Gestionar →</Link>
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
      {/* Modal de baja de personal */}
      {bajaOpen && <BajaModal companyId={companyId} onClose={() => { setBajaOpen(false); queryClient.invalidateQueries({ queryKey: ['employees'] }); }} />}
    </div>
  );
}

// ── Baja de personal desde el panel: elegí la persona, fecha y causal BPS;
//    cierra el contrato vigente y genera la liquidación final (egreso). ──
interface BajaForm {
  employeeId: string;
  fechaEgreso: string;
  causalEgresoCod: string;
  motivo?: string;
}

function BajaModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const { data: personas } = useQuery({
    queryKey: ['employees-picker', companyId],
    queryFn: () => employeesApi.list({ companyId, page: 1, limit: 200 }),
    enabled: !!companyId,
  });
  const { data: causales } = useQuery({
    queryKey: ['cat-causales'],
    queryFn: () => catalogsApi.causalesEgreso(),
    staleTime: Infinity,
  });

  const { register, handleSubmit, formState: { errors } } = useForm<BajaForm>({
    defaultValues: { employeeId: '', fechaEgreso: new Date().toISOString().slice(0, 10), causalEgresoCod: '1', motivo: '' },
  });

  const onSubmit = async (data: BajaForm) => {
    setError('');
    setEnviando(true);
    try {
      // Buscar el contrato vigente de la persona en esta empresa.
      const contratos = await contractsApi.list(data.employeeId);
      const vigente = contratos.find((c) =>
        c.activo && !c.fechaFin && !c.vigenciaHasta && (!c.companyId || c.companyId === companyId));
      if (!vigente) {
        setError('La persona no tiene un contrato vigente en esta empresa.');
        setEnviando(false);
        return;
      }
      if (!confirm('La baja cierra el contrato y genera la liquidación final (egreso). ¿Confirmar?')) {
        setEnviando(false);
        return;
      }
      const r = await contractsApi.baja(data.employeeId, vigente.id, data.fechaEgreso, data.motivo || undefined, Number(data.causalEgresoCod));
      alert(r.aviso
        ? r.aviso
        : 'Baja registrada. Se generó la liquidación final (egreso) en BORRADOR — revisala en Liquidaciones.'
          + (r.desvinculadaTotal ? '\nLa persona quedó inactiva.' : ''));
      onClose();
    } catch (e) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(m || 'No se pudo registrar la baja.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <h2 className="text-lg font-bold text-ink">Baja de personal</h2>
          <button onClick={onClose} className="p-1 text-ink-subtle hover:text-ink"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-bad-bg border border-bad/30 rounded-lg text-sm text-bad">
              <AlertCircle size={16} className="flex-shrink-0" /> {error}
            </div>
          )}
          <div>
            <label className="form-label">Persona *</label>
            <select {...register('employeeId', { required: 'Requerido' })} className="form-input">
              <option value="">— Seleccionar —</option>
              {personas?.data.map((p: Employee) => (
                <option key={p.id} value={p.id}>{p.apellido}, {p.nombre} · CI {p.ci}</option>
              ))}
            </select>
            {errors.employeeId && <p className="form-error">{errors.employeeId.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Fecha de egreso *</label>
              <input {...register('fechaEgreso', { required: 'Requerido' })} type="date" className="form-input" />
            </div>
            <div>
              <label className="form-label">Causal (BPS Tabla 9)</label>
              <select {...register('causalEgresoCod')} className="form-input">
                {causales?.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Motivo (opcional)</label>
            <input {...register('motivo')} className="form-input" />
          </div>
          <p className="text-xs text-ink-subtle">
            Se cierra el contrato vigente en la empresa activa y se genera automáticamente la liquidación final
            (sueldo de los días trabajados, aguinaldo y licencia proporcionales, salario vacacional e IPD si corresponde).
          </p>
          <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
            <button type="button" onClick={onClose} className="btn-tertiary">Cancelar</button>
            <button type="submit" disabled={enviando} className="btn-danger">
              {enviando ? 'Procesando…' : 'Registrar baja'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
