import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ListChecks, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, AlertTriangle, X } from 'lucide-react';
import { tareasApi, companiesApi, Tarea, Vencimiento, EstadoVenc } from '../services/api';
import { MESES } from '../types';

const RECURRENCIAS = ['MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];
const CATEGORIAS = ['BPS', 'DGI', 'Sueldos', 'Balances', 'Interno', 'Otros'];

const ESTADO_INFO: Record<string, { label: string; badge: string; dot: string }> = {
  PENDIENTE: { label: 'Pendiente', badge: 'badge-yellow', dot: 'bg-warn' },
  COMPLETADA: { label: 'Realizada', badge: 'badge-green', dot: 'bg-ok' },
  NO_COMPLETADA: { label: 'No realizada', badge: 'badge-red', dot: 'bg-bad' },
  CON_FALTAS: { label: 'Con faltantes', badge: 'badge-yellow', dot: 'bg-orange-500' },
};

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function nombreCliente(t: Tarea): string {
  return t.company ? (t.company.nombreFantasia || t.company.razonSocial) : 'Estudio (interna)';
}
function esVencido(v: Vencimiento): boolean {
  return v.estado === 'PENDIENTE' && new Date(v.fecha) < new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
}

export default function TareasPage() {
  const [tab, setTab] = useState<'agenda' | 'tareas'>('agenda');
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink font-brand">Agenda del estudio</h1>
          <p className="text-ink-subtle text-sm mt-0.5">Tareas y vencimientos de los clientes — uso interno del estudio.</p>
        </div>
      </div>
      <div className="flex gap-1 bg-canvas p-1 rounded-lg w-fit">
        {([{ key: 'agenda', label: 'Agenda', icon: CalendarDays }, { key: 'tareas', label: 'Tareas', icon: ListChecks }] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === key ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tab === 'agenda' ? <Agenda /> : <Tareas />}
    </div>
  );
}

// ══════════════════════ AGENDA (calendario + vencimientos) ═══════════
function Agenda() {
  const qc = useQueryClient();
  const hoy = new Date();
  const [cursor, setCursor] = useState({ y: hoy.getUTCFullYear(), m: hoy.getUTCMonth() + 1 });
  const [fCliente, setFCliente] = useState('');
  const [fCategoria, setFCategoria] = useState('');
  const [fEstado, setFEstado] = useState('');

  const from = ymd(new Date(Date.UTC(cursor.y, cursor.m - 1, 1)));
  const to = ymd(new Date(Date.UTC(cursor.y, cursor.m, 0)));

  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() });
  const { data: resumen } = useQuery({ queryKey: ['agenda-resumen'], queryFn: () => tareasApi.resumen(), staleTime: 0 });
  const { data: vencimientos = [], isLoading } = useQuery({
    queryKey: ['agenda-venc', from, to, fCliente, fCategoria, fEstado],
    queryFn: () => tareasApi.vencimientos(from, to, { companyId: fCliente || undefined, categoria: fCategoria || undefined, estado: fEstado || undefined }),
    staleTime: 0,
  });

  const estadoMut = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: EstadoVenc }) => tareasApi.setEstado(id, estado),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agenda-venc'] });
      qc.invalidateQueries({ queryKey: ['agenda-resumen'] });
    },
  });

  const mover = (delta: number) => setCursor((c) => {
    const nm = c.m + delta;
    if (nm < 1) return { y: c.y - 1, m: 12 };
    if (nm > 12) return { y: c.y + 1, m: 1 };
    return { y: c.y, m: nm };
  });

  // El CALENDARIO muestra solo los vencimientos FISCALES (pagos de impuestos y
  // presentación de DDJJ). Las tareas comunes quedan en la lista de abajo.
  const porDia = useMemo(() => {
    const map = new Map<number, Vencimiento[]>();
    for (const v of vencimientos) {
      if (!v.tarea.esVencimiento) continue;
      const d = new Date(v.fecha).getUTCDate();
      (map.get(d) ?? map.set(d, []).get(d)!).push(v);
    }
    return map;
  }, [vencimientos]);

  const primerDia = new Date(Date.UTC(cursor.y, cursor.m - 1, 1)).getUTCDay(); // 0=Dom
  const diasMes = new Date(Date.UTC(cursor.y, cursor.m, 0)).getUTCDate();
  const celdas: (number | null)[] = [...Array(primerDia).fill(null), ...Array.from({ length: diasMes }, (_, i) => i + 1)];
  const hoyDia = hoy.getUTCFullYear() === cursor.y && hoy.getUTCMonth() + 1 === cursor.m ? hoy.getUTCDate() : -1;

  return (
    <div className="space-y-4">
      {/* Alertas: vencidos y próximos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <AlertaCard titulo="Vencidas" icon={AlertTriangle} color="text-bad" items={resumen?.vencidos ?? []} />
        <AlertaCard titulo="Próximas (15 días)" icon={CalendarDays} color="text-brand-600" items={resumen?.proximos ?? []} />
      </div>

      {/* Barra: mes + filtros */}
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={() => mover(-1)} className="p-1.5 rounded hover:bg-canvas"><ChevronLeft size={16} /></button>
          <span className="font-semibold text-ink w-40 text-center">{MESES[cursor.m]} {cursor.y}</span>
          <button onClick={() => mover(1)} className="p-1.5 rounded hover:bg-canvas"><ChevronRight size={16} /></button>
        </div>
        <select value={fCliente} onChange={(e) => setFCliente(e.target.value)} className="form-input w-auto">
          <option value="">Todos los clientes</option>
          {companies?.map((c) => <option key={c.id} value={c.id}>{c.nombreFantasia || c.razonSocial}</option>)}
        </select>
        <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)} className="form-input w-auto">
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} className="form-input w-auto">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Calendario del mes — solo vencimientos fiscales (impuestos / DDJJ) */}
      <div className="card p-3">
        <div className="flex items-center gap-2 text-xs text-ink-subtle mb-2 px-1">
          <CalendarDays size={13} className="text-brand-600" />
          Vencimientos de pagos de impuestos y presentación de declaraciones juradas.
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink-subtle mb-1">
          {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {celdas.map((dia, i) => (
            <div key={i} className={`min-h-[68px] rounded-lg border p-1 ${dia === null ? 'border-transparent' : 'border-hairline'} ${dia === hoyDia ? 'ring-2 ring-brand-300' : ''}`}>
              {dia !== null && (
                <>
                  <div className="text-[11px] text-ink-subtle text-right pr-0.5">{dia}</div>
                  <div className="space-y-0.5">
                    {(porDia.get(dia) ?? []).slice(0, 3).map((v) => (
                      <div key={v.id} title={`${v.tarea.titulo} · ${nombreCliente(v.tarea)}`}
                        className={`flex items-center gap-1 text-[10px] truncate px-1 py-0.5 rounded ${esVencido(v) ? 'bg-bad-bg text-bad' : 'bg-canvas text-ink-muted'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${esVencido(v) ? 'bg-bad' : ESTADO_INFO[v.estado].dot}`} />
                        <span className="truncate">{v.tarea.titulo}</span>
                      </div>
                    ))}
                    {(porDia.get(dia)?.length ?? 0) > 3 && <div className="text-[10px] text-ink-subtle pl-1">+{(porDia.get(dia)!.length - 3)} más</div>}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Lista detallada con acciones de estado */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-hairline text-sm font-semibold text-ink">Vencimientos del mes ({vencimientos.length})</div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-ink-subtle">Cargando…</div>
        ) : vencimientos.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-subtle">Sin vencimientos en este mes con estos filtros.</div>
        ) : (
          <div className="divide-y divide-hairline/60">
            {vencimientos.map((v) => (
              <div key={v.id} className={`px-4 py-3 flex items-center gap-3 flex-wrap ${esVencido(v) ? 'bg-bad-bg/20' : ''}`}>
                <div className="w-16 text-center shrink-0">
                  <div className="text-lg font-bold text-ink figure">{new Date(v.fecha).getUTCDate()}</div>
                  <div className="text-[10px] text-ink-subtle uppercase">{MESES[new Date(v.fecha).getUTCMonth() + 1]?.slice(0, 3)}</div>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <p className="font-medium text-ink">
                    {v.tarea.titulo}
                    {v.tarea.esVencimiento && <span className="ml-2 text-[10px] uppercase tracking-wide badge badge-blue">Vencimiento</span>}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {nombreCliente(v.tarea)}
                    {v.tarea.categoria && ` · ${v.tarea.categoria}`}
                    {v.tarea.responsable && ` · ${v.tarea.responsable.nombre} ${v.tarea.responsable.apellido}`}
                  </p>
                </div>
                {esVencido(v) && <span className="badge badge-red shrink-0">Vencida</span>}
                <span className={`w-2 h-2 rounded-full shrink-0 ${ESTADO_INFO[v.estado].dot}`} title={ESTADO_INFO[v.estado].label} />
                <select
                  value={v.estado}
                  onChange={(e) => estadoMut.mutate({ id: v.id, estado: e.target.value as EstadoVenc })}
                  className="form-input w-auto text-sm py-1.5"
                  title="Cambiar estado"
                >
                  <option value="PENDIENTE">Pendiente</option>
                  <option value="COMPLETADA">Realizada</option>
                  <option value="CON_FALTAS">Con faltantes</option>
                  <option value="NO_COMPLETADA">No realizada</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AlertaCard({ titulo, icon: Icon, color, items }: { titulo: string; icon: typeof CalendarDays; color: string; items: Vencimiento[] }) {
  return (
    <div className="card p-4">
      <div className={`flex items-center gap-2 text-sm font-semibold ${color} mb-2`}>
        <Icon size={16} /> {titulo} <span className="figure">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-ink-subtle">Nada por ahora.</p>
      ) : (
        <ul className="space-y-1 max-h-40 overflow-y-auto">
          {items.slice(0, 8).map((v) => (
            <li key={v.id} className="text-xs text-ink-muted flex items-center justify-between gap-2">
              <span className="truncate">{v.tarea.titulo} · {nombreCliente(v.tarea)}</span>
              <span className="text-ink-subtle shrink-0 figure">{ymd(new Date(v.fecha)).slice(5)}</span>
            </li>
          ))}
          {items.length > 8 && <li className="text-xs text-ink-subtle">+{items.length - 8} más</li>}
        </ul>
      )}
    </div>
  );
}

// ══════════════════════ TAREAS (definiciones) ═══════════════════════
interface FormState {
  titulo: string; descripcion: string; categoria: string; responsableId: string;
  tipo: 'PUNTUAL' | 'RECURRENTE'; recurrencia: string; diaVencimiento: string; mesAncla: string;
  fechaVencimiento: string; companyIds: string[]; interna: boolean; esVencimiento: boolean; activa: boolean;
}
const emptyForm: FormState = {
  titulo: '', descripcion: '', categoria: '', responsableId: '', tipo: 'RECURRENTE',
  recurrencia: 'MENSUAL', diaVencimiento: '', mesAncla: '', fechaVencimiento: '', companyIds: [], interna: false, esVencimiento: false, activa: true,
};

function Tareas() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState('');

  const { data: tareas = [] } = useQuery({ queryKey: ['tareas'], queryFn: () => tareasApi.list() });
  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() });
  const { data: usuarios } = useQuery({ queryKey: ['tareas-usuarios'], queryFn: () => tareasApi.usuarios() });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['tareas'] });
    qc.invalidateQueries({ queryKey: ['agenda-venc'] });
    qc.invalidateQueries({ queryKey: ['agenda-resumen'] });
  };
  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        titulo: form.titulo,
        descripcion: form.descripcion || null,
        categoria: form.categoria || null,
        responsableId: form.responsableId || null,
        tipo: form.tipo,
        recurrencia: form.tipo === 'RECURRENTE' ? form.recurrencia : null,
        diaVencimiento: form.tipo === 'RECURRENTE' && form.diaVencimiento ? Number(form.diaVencimiento) : null,
        mesAncla: form.tipo === 'RECURRENTE' && form.mesAncla ? Number(form.mesAncla) : null,
        fechaVencimiento: form.tipo === 'PUNTUAL' ? form.fechaVencimiento : null,
        esVencimiento: form.esVencimiento,
      };
      if (editId) {
        return tareasApi.update(editId, { ...payload, companyId: form.interna ? null : (form.companyIds[0] ?? null) });
      }
      // Alta: interna (companyId null), o uno/varios clientes.
      const companyIds = form.interna ? [] : form.companyIds;
      return tareasApi.create({ ...payload, companyId: form.interna ? null : undefined, companyIds: companyIds.length ? companyIds : undefined });
    },
    onSuccess: () => { invalidar(); setModal(false); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo guardar.'),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => tareasApi.remove(id),
    onSuccess: invalidar,
  });

  const abrirNueva = () => { setEditId(null); setForm(emptyForm); setError(''); setModal(true); };
  const abrirEdit = (t: Tarea) => {
    setEditId(t.id);
    setForm({
      titulo: t.titulo, descripcion: t.descripcion ?? '', categoria: t.categoria ?? '', responsableId: t.responsableId ?? '',
      tipo: t.tipo, recurrencia: t.recurrencia ?? 'MENSUAL', diaVencimiento: t.diaVencimiento != null ? String(t.diaVencimiento) : '',
      mesAncla: t.mesAncla != null ? String(t.mesAncla) : '', fechaVencimiento: t.fechaVencimiento ? t.fechaVencimiento.slice(0, 10) : '',
      companyIds: t.companyId ? [t.companyId] : [], interna: !t.companyId, esVencimiento: !!t.esVencimiento, activa: t.activa,
    });
    setError(''); setModal(true);
  };

  const toggleCompany = (id: string) => setForm((f) => ({
    ...f, companyIds: f.companyIds.includes(id) ? f.companyIds.filter((x) => x !== id) : [...f.companyIds, id], interna: false,
  }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={abrirNueva} className="btn-primary btn-sm"><Plus size={15} /> Nueva tarea</button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-2 text-left">Tarea</th>
                <th className="px-4 py-2 text-left">Cliente</th>
                <th className="px-4 py-2 text-left">Periodicidad</th>
                <th className="px-4 py-2 text-left">Responsable</th>
                <th className="px-4 py-2 text-left">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {tareas.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-subtle">Todavía no hay tareas. Creá la primera.</td></tr>}
              {tareas.map((t) => (
                <tr key={t.id} className={t.activa ? '' : 'opacity-50'}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-ink">{t.titulo}</p>
                    {t.categoria && <span className="text-xs text-ink-subtle">{t.categoria}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{nombreCliente(t)}</td>
                  <td className="px-4 py-2.5 text-ink-muted text-xs">
                    {t.tipo === 'PUNTUAL' ? `Puntual · ${t.fechaVencimiento?.slice(0, 10) ?? ''}` : `${t.recurrencia}${t.diaVencimiento ? ` · día ${t.diaVencimiento}` : ''}`}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted text-xs">{t.responsable ? `${t.responsable.nombre} ${t.responsable.apellido}` : '—'}</td>
                  <td className="px-4 py-2.5">{t.activa ? <span className="badge badge-green">Activa</span> : <span className="badge badge-gray">Inactiva</span>}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => abrirEdit(t)} className="btn-secondary btn-sm"><Pencil size={13} /> Editar</button>
                      <button onClick={() => { if (confirm(`¿Eliminar "${t.titulo}" y sus vencimientos?`)) delMut.mutate(t.id); }} className="p-1.5 text-bad/70 hover:text-bad hover:bg-bad-bg rounded" title="Eliminar"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-hairline flex items-center justify-between">
              <h2 className="font-semibold text-ink">{editId ? 'Editar tarea' : 'Nueva tarea'}</h2>
              <button onClick={() => setModal(false)} className="text-ink-subtle hover:text-ink"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              {error && <div className="p-2 bg-bad-bg text-bad text-sm rounded">{error}</div>}
              <div>
                <label className="form-label">Título *</label>
                <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className="form-input" placeholder="Presentar nómina BPS" />
              </div>
              <div>
                <label className="form-label">Descripción</label>
                <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className="form-input" rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Categoría</label>
                  <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className="form-input">
                    <option value="">—</option>
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Responsable</label>
                  <select value={form.responsableId} onChange={(e) => setForm({ ...form, responsableId: e.target.value })} className="form-input">
                    <option value="">—</option>
                    {usuarios?.map((u) => <option key={u.id} value={u.id}>{u.nombre} {u.apellido}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Tipo</label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as 'PUNTUAL' | 'RECURRENTE' })} className="form-input">
                    <option value="RECURRENTE">Recurrente</option>
                    <option value="PUNTUAL">Puntual</option>
                  </select>
                </div>
                {form.tipo === 'RECURRENTE' ? (
                  <div>
                    <label className="form-label">Periodicidad</label>
                    <select value={form.recurrencia} onChange={(e) => setForm({ ...form, recurrencia: e.target.value })} className="form-input">
                      {RECURRENCIAS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="form-label">Fecha de vencimiento</label>
                    <input type="date" value={form.fechaVencimiento} onChange={(e) => setForm({ ...form, fechaVencimiento: e.target.value })} className="form-input" />
                  </div>
                )}
              </div>
              {form.tipo === 'RECURRENTE' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Día de vencimiento</label>
                    <input type="number" min={1} max={31} value={form.diaVencimiento} onChange={(e) => setForm({ ...form, diaVencimiento: e.target.value })} className="form-input" placeholder="Ej. 20" />
                  </div>
                  {form.recurrencia !== 'MENSUAL' && (
                    <div>
                      <label className="form-label">Mes de anclaje</label>
                      <select value={form.mesAncla} onChange={(e) => setForm({ ...form, mesAncla: e.target.value })} className="form-input">
                        <option value="">Enero (default)</option>
                        {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                      </select>
                      <p className="text-[11px] text-ink-subtle mt-0.5">Desde qué mes arranca el ciclo.</p>
                    </div>
                  )}
                </div>
              )}
              <label className="flex items-start gap-2 text-sm p-2.5 rounded-lg bg-canvas border border-hairline cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={form.esVencimiento} onChange={(e) => setForm({ ...form, esVencimiento: e.target.checked })} />
                <span>
                  <span className="font-medium text-ink">Es un vencimiento fiscal</span> (pago de impuesto o presentación de DDJJ)
                  <span className="block text-[11px] text-ink-subtle">Si lo marcás, aparece en el calendario. Las tareas comunes solo van en la lista.</span>
                </span>
              </label>
              <div>
                <label className="form-label">Cliente(s)</label>
                <label className="flex items-center gap-2 text-sm mb-1.5">
                  <input type="checkbox" checked={form.interna} onChange={(e) => setForm({ ...form, interna: e.target.checked, companyIds: e.target.checked ? [] : form.companyIds })} />
                  Tarea interna del estudio (sin cliente)
                </label>
                {!form.interna && (
                  <div className="border border-hairline rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
                    {companies?.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.companyIds.includes(c.id)} onChange={() => toggleCompany(c.id)} disabled={!!editId && form.companyIds.length >= 1 && !form.companyIds.includes(c.id)} />
                        {c.nombreFantasia || c.razonSocial}
                      </label>
                    ))}
                  </div>
                )}
                {!editId && <p className="text-[11px] text-ink-subtle mt-1">Podés elegir varios: se crea la tarea para cada cliente.</p>}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-hairline flex justify-end gap-2">
              <button onClick={() => setModal(false)} className="btn-secondary btn-sm">Cancelar</button>
              <button onClick={() => { setError(''); if (!form.titulo.trim()) { setError('El título es obligatorio.'); return; } if (!editId && !form.interna && form.companyIds.length === 0) { setError('Elegí al menos un cliente o marcá "interna".'); return; } saveMut.mutate(); }} disabled={saveMut.isPending} className="btn-primary btn-sm">
                {saveMut.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
