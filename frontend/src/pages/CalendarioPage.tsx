import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ChevronLeft, ChevronRight, Plus, X, AlertCircle, Trash2 } from 'lucide-react';
import { calendarApi, CalendarEvent, CalendarEventType, employeesApi } from '../services/api';
import { useCompany } from '../hooks/useCompany';
import { useAuth } from '../hooks/useAuth';
import { MESES, Employee } from '../types';

// Estilo por tipo de evento (color de chip en la grilla y en la lista).
const TIPO_STYLE: Record<CalendarEventType, { chip: string; label: string }> = {
  LICENCIA: { chip: 'bg-brand-100 text-brand-800', label: 'Licencia' },
  REINTEGRO: { chip: 'bg-brand-50 text-brand-600', label: 'Reintegro' },
  VENC_NOMINA_BPS: { chip: 'bg-bad-bg text-bad', label: 'Nómina BPS' },
  VENC_CARNE_SALUD: { chip: 'bg-warn-bg text-warn', label: 'Carné de salud' },
  VENC_LIBRETA: { chip: 'bg-warn-bg text-warn', label: 'Libreta' },
  CUMPLEANOS: { chip: 'bg-ok-bg text-ok', label: 'Cumpleaños' },
  ALTA: { chip: 'bg-canvas text-ink-muted', label: 'Alta' },
  BAJA: { chip: 'bg-canvas text-ink-muted', label: 'Baja' },
};

interface LeaveForm {
  employeeId: string;
  fechaInicio: string;
  fechaFin: string;
  motivo?: string;
}

export default function CalendarioPage() {
  const { activeCompanyId: companyId } = useCompany();
  const { isOperator } = useAuth();
  const queryClient = useQueryClient();
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth() + 1);
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState('');

  const { data: events, isLoading } = useQuery({
    queryKey: ['calendar-month', companyId, year, month],
    queryFn: () => calendarApi.month(companyId, year, month),
    enabled: !!companyId,
  });

  const { data: personas } = useQuery({
    queryKey: ['employees-picker', companyId],
    queryFn: () => employeesApi.list({ companyId, page: 1, limit: 200 }),
    enabled: !!companyId && modalOpen,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<LeaveForm>();

  const createLeave = useMutation({
    mutationFn: (data: LeaveForm) => calendarApi.createLeave(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-month'] });
      setModalOpen(false);
    },
    onError: (err: unknown) => {
      const m = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(m || 'No se pudo registrar la licencia.');
    },
  });

  const deleteLeave = useMutation({
    mutationFn: (id: string) => calendarApi.deleteLeave(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-month'] }),
  });

  const mover = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  // Eventos por día (las licencias se expanden a cada día del rango).
  const porDia = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      if (e.tipo === 'LICENCIA' && e.hasta) {
        const d = new Date(e.fecha + 'T00:00:00');
        const fin = new Date(e.hasta + 'T00:00:00');
        while (d <= fin) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          map.set(key, [...(map.get(key) ?? []), e]);
          d.setDate(d.getDate() + 1);
        }
      } else {
        map.set(e.fecha, [...(map.get(e.fecha) ?? []), e]);
      }
    }
    return map;
  }, [events]);

  // Grilla del mes: celdas desde lunes.
  const celdas = useMemo(() => {
    const primero = new Date(year, month - 1, 1);
    const dias = new Date(year, month, 0).getDate();
    const offset = (primero.getDay() + 6) % 7; // lunes = 0
    const cells: Array<{ dia: number | null; key: string }> = [];
    for (let i = 0; i < offset; i++) cells.push({ dia: null, key: `x${i}` });
    for (let d = 1; d <= dias; d++) {
      cells.push({ dia: d, key: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    return cells;
  }, [year, month]);

  const esHoy = (dia: number) =>
    dia === hoy.getDate() && month === hoy.getMonth() + 1 && year === hoy.getFullYear();

  const abrirNueva = () => {
    setFormError('');
    const f = new Date().toISOString().slice(0, 10);
    reset({ employeeId: '', fechaInicio: f, fechaFin: f, motivo: '' });
    setModalOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink font-brand">Calendario</h1>
          <p className="text-ink-subtle text-sm mt-0.5">Licencias, vencimientos de nómina BPS, documentos y cumpleaños</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => mover(-1)} className="btn-tertiary btn-sm" aria-label="Mes anterior"><ChevronLeft size={16} /></button>
          <span className="text-sm font-semibold text-ink w-36 text-center">{MESES[month]} {year}</span>
          <button onClick={() => mover(1)} className="btn-tertiary btn-sm" aria-label="Mes siguiente"><ChevronRight size={16} /></button>
          {isOperator && (
            <button onClick={abrirNueva} className="btn-primary btn-sm ml-2">
              <Plus size={14} /> Nueva licencia
            </button>
          )}
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {(Object.keys(TIPO_STYLE) as CalendarEventType[]).map((t) => (
          <span key={t} className={`px-2 py-0.5 rounded-full font-medium ${TIPO_STYLE[t].chip}`}>{TIPO_STYLE[t].label}</span>
        ))}
      </div>

      {/* Grilla mensual */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-hairline bg-canvas/70">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
            <div key={d} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {celdas.map((c, i) => (
            <div key={c.key} className={`min-h-[92px] p-1.5 border-b border-hairline/60 ${(i + 1) % 7 !== 0 ? 'border-r' : ''} ${c.dia == null ? 'bg-canvas/40' : ''}`}>
              {c.dia != null && (
                <>
                  <span className={`inline-flex items-center justify-center w-6 h-6 text-xs rounded-full font-medium ${esHoy(c.dia) ? 'bg-brand-600 text-white' : 'text-ink-muted'}`}>
                    {c.dia}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {(porDia.get(c.key) ?? []).slice(0, 3).map((e, j) => (
                      <div key={j} className={`px-1.5 py-0.5 rounded text-[10px] leading-tight truncate ${TIPO_STYLE[e.tipo].chip}`} title={e.titulo}>
                        {e.titulo}
                      </div>
                    ))}
                    {(porDia.get(c.key)?.length ?? 0) > 3 && (
                      <p className="text-[10px] text-ink-subtle pl-1">+{(porDia.get(c.key)!.length) - 3} más</p>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Lista de eventos del mes */}
      <div className="card">
        <div className="px-5 py-3 border-b border-hairline">
          <h2 className="text-sm font-semibold text-ink">Eventos de {MESES[month]}</h2>
        </div>
        {isLoading ? (
          <p className="p-6 text-center text-sm text-ink-subtle">Cargando…</p>
        ) : !events?.length ? (
          <p className="p-6 text-center text-sm text-ink-subtle">Sin eventos este mes.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {events.map((e, i) => (
              <li key={i} className="px-5 py-2.5 flex items-center gap-3">
                <span className="figure text-xs text-ink-subtle w-20 shrink-0">
                  {new Date(e.fecha + 'T00:00:00').toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' })}
                  {e.hasta && e.hasta !== e.fecha ? ` – ${new Date(e.hasta + 'T00:00:00').toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' })}` : ''}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${TIPO_STYLE[e.tipo].chip}`}>{TIPO_STYLE[e.tipo].label}</span>
                <span className="text-sm text-ink-muted flex-1 min-w-0 truncate">{e.titulo}</span>
                {isOperator && e.tipo === 'LICENCIA' && e.leaveId && (
                  <button
                    onClick={() => { if (confirm(`¿Cancelar la licencia?\n${e.titulo}`)) deleteLeave.mutate(e.leaveId!); }}
                    className="p-1 text-ink-subtle hover:text-bad hover:bg-bad-bg rounded-lg shrink-0"
                    title="Cancelar licencia"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal nueva licencia */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
              <h2 className="text-lg font-bold text-ink">Nueva licencia</h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-ink-subtle hover:text-ink"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit((d) => createLeave.mutate(d))} className="p-6 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 p-3 bg-bad-bg border border-bad/30 rounded-lg text-sm text-bad">
                  <AlertCircle size={16} className="flex-shrink-0" /> {formError}
                </div>
              )}
              <div>
                <label className="form-label">Persona *</label>
                <select {...register('employeeId', { required: 'Requerido' })} className="form-input">
                  <option value="">— Seleccionar —</option>
                  {personas?.data.map((p: Employee) => (
                    <option key={p.id} value={p.id}>{p.apellido}, {p.nombre}</option>
                  ))}
                </select>
                {errors.employeeId && <p className="form-error">{errors.employeeId.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Desde *</label>
                  <input {...register('fechaInicio', { required: 'Requerido' })} type="date" className="form-input" />
                </div>
                <div>
                  <label className="form-label">Hasta *</label>
                  <input {...register('fechaFin', { required: 'Requerido' })} type="date" className="form-input" />
                </div>
              </div>
              <div>
                <label className="form-label">Motivo (opcional)</label>
                <input {...register('motivo')} className="form-input" placeholder="Licencia anual, estudio, etc." />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-tertiary">Cancelar</button>
                <button type="submit" disabled={createLeave.isPending} className="btn-primary">
                  {createLeave.isPending ? 'Guardando…' : 'Registrar licencia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
