import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, CheckCircle, XCircle, RotateCcw, RefreshCw, X, Plus, Pencil, Check, HardHat } from 'lucide-react';
import { liquidationApi, conceptsApi, companiesApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import { abrirBlobEnPestania } from '../utils/file';
import { CONCEPTOS_SISTEMA, esEmpresaConstruccion } from '../constants/conceptos';
import { formatPesos, MESES, PayrollItem } from '../types';

interface OpcionConcepto { key: string; nombre: string; grupo: string; montoFijo?: number }

// Tasa del ítem: los conceptos PORCENTAJE_CIENMIL (Fondo Social/Vivienda de la
// construcción) guardan el rate en cienmilésimas (5809 → 0,5809%); el resto en
// basis points (rate/100).
function formatTasa(item: PayrollItem): string {
  if (!item.rate) return '—';
  const det = item.calculationDetail as { tipoCalculo?: string } | null | undefined;
  if (det?.tipoCalculo === 'PORCENTAJE_CIENMIL') return `${(item.rate / 10000).toFixed(4)}%`;
  return `${(item.rate / 100).toFixed(3)}%`;
}

function ItemRow({ item, editable, onEdit, onDelete }: {
  item: PayrollItem;
  editable?: boolean;
  onEdit?: (itemId: string, data: { descripcion: string; monto: number }) => void;
  onDelete?: (id: string) => void;
}) {
  // Conceptos agregados a mano (ajustes y faltas): se pueden editar y eliminar.
  const manual = item.concepto.startsWith('AJUSTE') || ['FALTAS', 'HORAS_TARDE', 'REINTEGRO_GASTOS', 'PRIMA_ANTIGUEDAD', 'VIATICOS', 'VIATICOS_GRAVADOS'].includes(item.concepto);
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(item.descripcion);
  const [m, setM] = useState(Number(item.amount) / 100);

  if (editing) {
    return (
      <tr className="bg-amber-50/50">
        <td className="px-4 py-2">
          <input value={d} onChange={(e) => setD(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
        </td>
        <td colSpan={2} />
        <td className="px-4 py-2 text-right whitespace-nowrap">
          <input type="number" value={m} onChange={(e) => setM(Number(e.target.value))} className="border border-gray-300 rounded px-2 py-1 text-sm w-28 text-right" />
          <button onClick={() => { onEdit?.(item.id, { descripcion: d, monto: m }); setEditing(false); }} className="ml-2 text-green-600 hover:text-green-700 align-middle" title="Guardar"><Check size={15} /></button>
          <button onClick={() => { setD(item.descripcion); setM(Number(item.amount) / 100); setEditing(false); }} className="ml-1 text-gray-400 hover:text-gray-600 align-middle" title="Cancelar"><X size={15} /></button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2.5 text-sm text-gray-700">
        {item.descripcion}
        {manual && <span className="ml-2 text-[10px] uppercase bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">manual</span>}
      </td>
      <td className="px-4 py-2.5 text-right text-xs font-mono text-gray-500">
        {item.baseCalculo ? formatPesos(item.baseCalculo) : '—'}
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-gray-500">
        {formatTasa(item)}
      </td>
      <td className="px-4 py-2.5 text-right text-sm font-mono font-medium whitespace-nowrap">
        <span className="align-middle">{formatPesos(item.amount)}</span>
        {editable && onEdit && (
          <button onClick={() => setEditing(true)} className="ml-2 text-blue-500 hover:text-blue-700 align-middle" title="Editar"><Pencil size={13} /></button>
        )}
        {editable && manual && onDelete && (
          <button onClick={() => onDelete(item.id)} className="ml-1 text-red-500 hover:text-red-700 align-middle" title="Quitar concepto"><X size={13} /></button>
        )}
      </td>
    </tr>
  );
}

function Section({ title, items, total, colorClass, opciones, editable, onAdd, onEdit, onDelete }: {
  title: string;
  items: PayrollItem[];
  total: string;
  colorClass: string;
  opciones?: OpcionConcepto[];
  editable?: boolean;
  onAdd?: (descripcion: string, monto: number, cantidad?: number) => void;
  onEdit?: (itemId: string, data: { descripcion: string; monto: number }) => void;
  onDelete?: (id: string) => void;
}) {
  const [sel, setSel] = useState('');
  const [desc, setDesc] = useState('');
  const [monto, setMonto] = useState(0);
  const [cantidad, setCantidad] = useState(0);

  const nombreSel = sel === 'OTRO' ? desc : (opciones?.find((x) => x.key === sel)?.nombre ?? desc);
  const esFalta = /\bfaltas?\b/i.test(nombreSel);
  // Horas tardes: se carga la CANTIDAD de horas y el monto sale solo
  // (jornal ÷ 8 × horas); resta de los haberes igual que las faltas.
  const esHorasTarde = /\bhoras?\s+tardes?\b|\bllegadas?\s+tardes?\b/i.test(nombreSel);
  // La prima por antigüedad se calcula sola en el backend (0,5% del sueldo por
  // año completo, tope 5%): no se pide monto.
  const esPrima = /prima.*antig/i.test(nombreSel);

  const onSel = (value: string) => {
    setSel(value);
    setCantidad(0);
    if (value && value !== 'OTRO') {
      const o = opciones?.find((x) => x.key === value);
      setDesc(o?.nombre ?? '');
      setMonto(o?.montoFijo ?? 0);
    } else {
      setDesc(''); setMonto(0);
    }
  };

  const reset = () => { setSel(''); setDesc(''); setMonto(0); setCantidad(0); };

  const agregar = () => {
    const d = nombreSel;
    if (!d.trim()) return;
    if (esFalta || esHorasTarde) {
      if (cantidad > 0) { onAdd?.(d.trim(), 0, cantidad); reset(); }
    } else if (esPrima) {
      onAdd?.(d.trim(), 0); reset();
    } else if (monto > 0) {
      onAdd?.(d.trim(), monto); reset();
    }
  };

  const grupos = Array.from(new Set((opciones ?? []).map((o) => o.grupo)));

  return (
    <div>
      <div className={`px-4 py-2 ${colorClass} text-xs font-semibold uppercase tracking-wider`}>
        {title}
      </div>
      <table className="w-full">
        <thead>
          <tr className="table-header">
            <th className="px-4 py-2 text-left text-xs">Concepto</th>
            <th className="px-4 py-2 text-right text-xs">Base</th>
            <th className="px-4 py-2 text-right text-xs">Tasa</th>
            <th className="px-4 py-2 text-right text-xs">Importe</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map((item) => <ItemRow key={item.id} item={item} editable={editable} onEdit={onEdit} onDelete={onDelete} />)}
          {editable && onAdd && (
            <tr className="bg-blue-50/30">
              <td colSpan={4} className="px-4 py-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <Plus size={13} className="text-blue-500" />
                  <select value={sel} onChange={(e) => onSel(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm">
                    <option value="">Agregar {title.toLowerCase()}…</option>
                    {grupos.map((g) => (
                      <optgroup key={g} label={g}>
                        {(opciones ?? []).filter((o) => o.grupo === g).map((o) => <option key={o.key} value={o.key}>{o.nombre}</option>)}
                      </optgroup>
                    ))}
                    <option value="OTRO">Otro (escribir)</option>
                  </select>
                  {sel === 'OTRO' && <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descripción" className="border border-gray-300 rounded-lg px-2 py-1 text-sm flex-1 min-w-[140px]" />}
                  {sel && (esFalta || esHorasTarde) && (
                    <input type="number" step="0.01" min="0" value={cantidad || ''} onChange={(e) => setCantidad(Number(e.target.value))} placeholder={esFalta ? 'N° de faltas' : 'N° de horas'} className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-32" />
                  )}
                  {sel && !esFalta && !esHorasTarde && !esPrima && <input type="number" value={monto || ''} onChange={(e) => setMonto(Number(e.target.value))} placeholder="Monto $" className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-28" />}
                  {sel && esFalta && <span className="text-xs text-gray-500">el monto se calcula solo (básico ÷ 30 × faltas)</span>}
                  {sel && esHorasTarde && <span className="text-xs text-gray-500">el monto se calcula solo (jornal ÷ 8 × horas)</span>}
                  {sel && esPrima && <span className="text-xs text-gray-500">se calcula sola: 0,5% del sueldo por año de antigüedad (tope 5%)</span>}
                  {sel && <button type="button" onClick={agregar} className="btn-primary btn-sm">Agregar</button>}
                </div>
              </td>
            </tr>
          )}
          <tr className="bg-gray-50 font-semibold">
            <td className="px-4 py-2 text-sm">Total {title}</td>
            <td colSpan={2} />
            <td className="px-4 py-2 text-right text-sm font-mono">{formatPesos(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function LiquidationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isOperator, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const { data: liq, isLoading } = useQuery({
    queryKey: ['liquidation', id],
    queryFn: () => liquidationApi.preview(id!),
    enabled: !!id,
  });

  const confirmMutation = useMutation({
    mutationFn: () => liquidationApi.confirm(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => liquidationApi.cancel(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
  });

  const recalcularMutation = useMutation({
    mutationFn: () => liquidationApi.recalcular(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo recalcular');
    },
  });

  const unconfirmMutation = useMutation({
    mutationFn: () => liquidationApi.unconfirm(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo desconfirmar');
    },
  });

  const { activeCompanyId } = useCompany();
  const { data: conceptos } = useQuery({
    queryKey: ['concepts', activeCompanyId],
    queryFn: () => conceptsApi.list(activeCompanyId),
    enabled: !!activeCompanyId,
  });

  // CONSTRUCCIÓN: si la empresa tiene aportación CT, se muestran las horas del
  // mes y las cantidades del laudo; al aplicar se REGENERA la liquidación y el
  // motor calcula todas las partidas (presentismo, ropa, transporte, etc.).
  const { data: empresa } = useQuery({
    queryKey: ['company', activeCompanyId],
    queryFn: () => companiesApi.get(activeCompanyId),
    enabled: !!activeCompanyId,
  });
  const esConstruccion = esEmpresaConstruccion(empresa);
  const [horasMes, setHorasMes] = useState('');
  const [horasLluvia, setHorasLluvia] = useState('');
  const [ticketCant, setTicketCant] = useState('');
  const [mediasHoras, setMediasHoras] = useState('');

  const construccionMutation = useMutation({
    mutationFn: () => liquidationApi.generate({
      employeeId: liq!.employeeId,
      periodId: liq!.periodId,
      year: liq!.year,
      month: liq!.month,
      ...(horasMes !== '' ? { horasTrabajadas: Number(horasMes) } : {}),
      cantidadesConcepto: {
        ...(horasLluvia !== '' ? { HORAS_LLUVIA: Number(horasLluvia) } : {}),
        ...(ticketCant !== '' ? { TICKET_ALIMENTACION: Number(ticketCant) } : {}),
        ...(mediasHoras !== '' ? { MEDIAS_HORAS: Number(mediasHoras) } : {}),
      },
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo recalcular la liquidación.');
    },
  });

  const addItemMutation = useMutation({
    mutationFn: (vars: { descripcion: string; monto?: number; cantidad?: number; itemType: 'HABER' | 'DESCUENTO_OBRERO' }) => liquidationApi.addItem(id!, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo agregar el concepto');
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: (vars: { itemId: string; descripcion: string; monto: number }) =>
      liquidationApi.updateItem(id!, vars.itemId, { descripcion: vars.descripcion, monto: vars.monto }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo editar el concepto');
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => liquidationApi.deleteItem(id!, itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo quitar el concepto');
    },
  });

  if (isLoading) return <div className="text-center py-12 text-gray-400">Cargando...</div>;
  if (!liq) return <div className="text-center py-12 text-gray-400">Liquidación no encontrada</div>;

  const haberes = liq.items?.filter((i) => i.itemType === 'HABER') ?? [];
  const descuentos = liq.items?.filter((i) => i.itemType === 'DESCUENTO_OBRERO') ?? [];
  const patronal = liq.items?.filter((i) => i.itemType === 'APORTE_PATRONAL') ?? [];
  const puedeEditar = liq.status === 'BORRADOR' && isOperator;
  // Opciones unificadas para el selector: conceptos del sistema + configurados.
  const opcionesPorTipo = (tipo: string): OpcionConcepto[] => [
    ...CONCEPTOS_SISTEMA.filter((c) => c.tipo === tipo).map((c) => ({ key: 'SYS:' + c.nombre, nombre: c.nombre, grupo: 'Sistema' })),
    ...(conceptos ?? []).filter((c) => c.tipoOperacion === tipo && !c.oculto).map((c) => ({
      key: c.id,
      nombre: c.nombre,
      grupo: c.esComun ? 'Comunes' : 'Propios',
      montoFijo: c.tipoCalculo === 'VALOR_FIJO' && c.valorFijo ? Number(c.valorFijo) / 100 : undefined,
    })),
  ];
  const haberOptions = opcionesPorTipo('HABER');
  const descuentoOptions = opcionesPorTipo('DESCUENTO_OBRERO');

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link to="/liquidation" className="btn-secondary btn-sm self-start">
          <ArrowLeft size={14} />
          Volver
        </Link>
        <div className="flex-1 min-w-0">
          {(() => {
            const emp = (liq as unknown as { employee?: { nombre: string; apellido: string; ci: string; employeeNumber?: number | null } }).employee;
            const empresa = (liq as unknown as { period?: { company?: { razonSocial: string; nombreFantasia?: string | null } } }).period?.company;
            const nombreEmpresa = empresa?.nombreFantasia || empresa?.razonSocial;
            return (
              <>
                <h1 className="text-xl font-bold text-gray-900">
                  {emp ? `${emp.apellido}, ${emp.nombre}` : 'Liquidación'}
                </h1>
                <p className="text-gray-500 text-sm">
                  {nombreEmpresa ? <span className="font-medium text-gray-700">{nombreEmpresa}</span> : null}
                  {nombreEmpresa ? ' · ' : ''}{MESES[liq.month]} {liq.year} · {liq.type} · {liq.diasTrabajados} días
                  {emp?.employeeNumber ? ` · Legajo ${emp.employeeNumber}` : ''}
                  {emp?.ci ? ` · C.I. ${emp.ci}` : ''}
                </p>
              </>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`badge ${
            liq.status === 'CONFIRMADO' ? 'badge-green'
            : liq.status === 'BORRADOR' ? 'badge-yellow'
            : 'badge-red'
          }`}>{liq.status}</span>
          <button
            type="button"
            onClick={() => abrirBlobEnPestania(() => liquidationApi.recibo(id!), `recibo_${id}.pdf`)}
            className="btn-secondary btn-sm"
          >
            <Download size={14} />
            Recibo PDF
          </button>
          {isOperator && liq.status === 'BORRADOR' && (
            <button
              onClick={() => recalcularMutation.mutate()}
              disabled={recalcularMutation.isPending}
              className="btn-secondary btn-sm"
              title="Recalcular aportes (BPS/FONASA/FRL/IRPF) sobre la base gravada actual"
            >
              <RefreshCw size={14} className={recalcularMutation.isPending ? 'animate-spin' : ''} />
              Recalcular
            </button>
          )}
          {isOperator && liq.status === 'BORRADOR' && (
            <button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
              className="btn-primary btn-sm"
            >
              <CheckCircle size={14} />
              Confirmar
            </button>
          )}
          {isOperator && liq.status === 'CONFIRMADO' && (
            <button
              type="button"
              onClick={() => {
                if (confirm('¿Desconfirmar y reabrir esta liquidación para editarla?')) unconfirmMutation.mutate();
              }}
              disabled={unconfirmMutation.isPending}
              className="btn-secondary btn-sm"
            >
              <RotateCcw size={14} />
              Desconfirmar
            </button>
          )}
          {isAdmin && liq.status !== 'ANULADO' && (
            <button
              onClick={() => {
                if (confirm('¿Anular esta liquidación?')) cancelMutation.mutate();
              }}
              className="btn-danger btn-sm"
            >
              <XCircle size={14} />
              Anular
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500">Total Haberes</p>
          <p className="text-lg font-bold text-gray-900 mt-1">{formatPesos(liq.totalHaberes)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500">Total Descuentos</p>
          <p className="text-lg font-bold text-red-600 mt-1">({formatPesos(liq.totalDescuentos)})</p>
        </div>
        <div className="card p-4 text-center ring-2 ring-emerald-200 col-span-2 sm:col-span-1">
          <p className="text-xs text-gray-500">Líquido a Percibir</p>
          <p className="text-lg font-bold text-emerald-700 mt-1">{formatPesos(liq.liquidoPercibir)}</p>
        </div>
      </div>

      {/* Construcción: horas del mes y cantidades del laudo */}
      {esConstruccion && liq.type === 'MENSUAL' && puedeEditar && (
        <div className="card p-4 border-t-4 border-t-amber-400 space-y-3">
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <HardHat size={16} className="text-amber-500" /> Construcción — horas del mes
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="form-label">Horas comunes</label>
              <input type="number" min="0" step="0.5" value={horasMes} onChange={(e) => setHorasMes(e.target.value)} placeholder="ej. 176" className="form-input" />
            </div>
            <div>
              <label className="form-label">Horas lluvia</label>
              <input type="number" min="0" step="0.5" value={horasLluvia} onChange={(e) => setHorasLluvia(e.target.value)} placeholder="0" className="form-input" />
            </div>
            <div>
              <label className="form-label">Tickets alim. (cant.)</label>
              <input type="number" min="0" value={ticketCant} onChange={(e) => setTicketCant(e.target.value)} placeholder="auto: 1 c/8 hs" className="form-input" />
            </div>
            <div>
              <label className="form-label">Medias horas (cant.)</label>
              <input type="number" min="0" value={mediasHoras} onChange={(e) => setMediasHoras(e.target.value)} placeholder="auto: 1 c/8 hs" className="form-input" />
            </div>
            <div className="flex items-end">
              <button onClick={() => construccionMutation.mutate()} disabled={construccionMutation.isPending} className="btn-primary btn-sm w-full">
                {construccionMutation.isPending ? 'Calculando…' : 'Aplicar y recalcular'}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-gray-400">
            Cargando solo las horas, todo sale automático: Horas Comunes (horas × laudo vigente de la categoría, o el jornal del
            contrato si es mayor), presentismos, ropa, transporte, herramientas (según categoría), ticket de alimentación y media
            hora (1 por jornada de 8 hs), y Fondo Social/Vivienda. Solo la lluvia se indica a mano; tickets y medias horas se pueden
            corregir acá. Recalcular pisa los conceptos manuales agregados.
          </p>
        </div>
      )}

      {/* Itemized breakdown */}
      <div className="card overflow-hidden divide-y divide-gray-100">
        <Section
          title="Haberes"
          items={haberes as PayrollItem[]}
          total={liq.totalHaberes}
          colorClass="bg-green-50 text-green-800"
          opciones={haberOptions}
          editable={puedeEditar}
          onAdd={(descripcion, monto, cantidad) => addItemMutation.mutate({ descripcion, ...(cantidad ? { cantidad } : monto ? { monto } : {}), itemType: 'HABER' })}
          onEdit={(itemId, dd) => updateItemMutation.mutate({ itemId, ...dd })}
          onDelete={puedeEditar ? deleteItemMutation.mutate : undefined}
        />
        <Section
          title="Descuentos Obreros"
          items={descuentos as PayrollItem[]}
          total={liq.totalDescuentos}
          colorClass="bg-red-50 text-red-800"
          opciones={descuentoOptions}
          editable={puedeEditar}
          onAdd={(descripcion, monto, cantidad) => addItemMutation.mutate({ descripcion, ...(cantidad ? { cantidad } : monto ? { monto } : {}), itemType: 'DESCUENTO_OBRERO' })}
          onEdit={(itemId, dd) => updateItemMutation.mutate({ itemId, ...dd })}
          onDelete={puedeEditar ? deleteItemMutation.mutate : undefined}
        />

        {/* Net */}
        <div className="px-4 py-4 bg-brand-50">
          <div className="flex justify-between items-center gap-2">
            <span className="font-bold text-brand-900 text-sm sm:text-base">LÍQUIDO A PERCIBIR</span>
            <span className="font-bold text-lg sm:text-xl text-brand-900 font-mono">{formatPesos(liq.liquidoPercibir)}</span>
          </div>
        </div>

        {patronal.length > 0 && (
          <div>
            <div className="px-4 py-2 bg-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-600">
              Aportes Patronales (informativos — no deducidos del neto)
            </div>
            <table className="w-full">
              <tbody className="divide-y divide-gray-50">
                {(patronal as PayrollItem[]).map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-sm text-gray-600">{item.descripcion}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-mono text-gray-400">
                      {item.rate ? formatTasa(item) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-mono text-gray-600">
                      {formatPesos(item.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 text-sm font-semibold text-gray-600">
                  <td className="px-4 py-2">Total Patronal</td>
                  <td />
                  <td className="px-4 py-2 text-right font-mono">{formatPesos(liq.totalPatronal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
