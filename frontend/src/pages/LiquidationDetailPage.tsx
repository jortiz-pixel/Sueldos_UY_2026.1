import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, CheckCircle, XCircle, RotateCcw, RefreshCw, X, Plus, Pencil, Check, HardHat } from 'lucide-react';
import { liquidationApi, conceptsApi, companiesApi, employeesApi } from '../services/api';
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
  onEdit?: (itemId: string, data: { descripcion: string; monto?: number; base?: number; porcentaje?: number }) => void;
  onDelete?: (id: string) => void;
}) {
  // Conceptos agregados a mano (ajustes y faltas): se pueden editar y eliminar.
  const manual = item.concepto.startsWith('AJUSTE') || ['FALTAS', 'HORAS_TARDE', 'DESCANSO_TRABAJADO', 'REINTEGRO_GASTOS', 'PRIMA_ANTIGUEDAD', 'RETENCION_JUDICIAL', 'VIATICOS', 'VIATICOS_GRAVADOS'].includes(item.concepto);
  // La prima por antigüedad se edita distinto: el usuario carga el monto BASE y
  // el PORCENTAJE, y la prima sale sola (base × %).
  const esPrima = item.concepto === 'PRIMA_ANTIGUEDAD';
  // La retención judicial: solo se edita el PORCENTAJE; la base es el total de
  // haberes (no se ingresa) y el monto = % × total de haberes.
  const esRetencion = item.concepto === 'RETENCION_JUDICIAL';
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(item.descripcion);
  const [m, setM] = useState(Number(item.amount) / 100);
  // Para la prima: montos como texto libre, así se pueden borrar y escribir
  // decimales sin que el input numérico descarte los valores intermedios.
  const baseInicial = item.baseCalculo ? String(Number(item.baseCalculo) / 100) : '';
  const pctInicial = item.rate ? String(item.rate / 100) : '';
  const [baseStr, setBaseStr] = useState(baseInicial);
  const [pctStr, setPctStr] = useState(pctInicial);

  if (editing) {
    if (esPrima) {
      const baseNum = parseFloat(baseStr.replace(',', '.')) || 0;
      const pctNum = parseFloat(pctStr.replace(',', '.')) || 0;
      const primaCentesimos = Math.round(baseNum * pctNum); // prima = base × % (en centésimos)
      return (
        <tr className="bg-amber-50/50">
          <td className="px-4 py-2">
            <input value={d} onChange={(e) => setD(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </td>
          <td className="px-4 py-2 text-right">
            <input type="text" inputMode="decimal" value={baseStr} onChange={(e) => setBaseStr(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-28 text-right" title="Monto base" placeholder="Base" />
          </td>
          <td className="px-4 py-2 text-right">
            <div className="inline-flex items-center">
              <input type="text" inputMode="decimal" value={pctStr} onChange={(e) => setPctStr(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-16 text-right" title="Porcentaje" placeholder="%" />
              <span className="ml-1 text-xs text-gray-500">%</span>
            </div>
          </td>
          <td className="px-4 py-2 text-right whitespace-nowrap">
            <span className="text-sm font-mono text-gray-600 align-middle" title="Prima = base × %">{formatPesos(String(primaCentesimos))}</span>
            <button onClick={() => { onEdit?.(item.id, { descripcion: d, base: baseNum, porcentaje: pctNum }); setEditing(false); }} className="ml-2 text-green-600 hover:text-green-700 align-middle" title="Guardar"><Check size={15} /></button>
            <button onClick={() => { setD(item.descripcion); setBaseStr(baseInicial); setPctStr(pctInicial); setEditing(false); }} className="ml-1 text-gray-400 hover:text-gray-600 align-middle" title="Cancelar"><X size={15} /></button>
          </td>
        </tr>
      );
    }
    if (esRetencion) {
      const baseNum = item.baseCalculo ? Number(item.baseCalculo) / 100 : 0; // total de haberes (fijo)
      const pctNum = parseFloat(pctStr.replace(',', '.')) || 0;
      const retCentesimos = Math.round(baseNum * pctNum); // retención = total de haberes × %
      return (
        <tr className="bg-amber-50/50">
          <td className="px-4 py-2">
            <input value={d} onChange={(e) => setD(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
          </td>
          <td className="px-4 py-2 text-right text-xs font-mono text-gray-500" title="Total de haberes (base)">
            {item.baseCalculo ? formatPesos(item.baseCalculo) : '—'}
          </td>
          <td className="px-4 py-2 text-right">
            <div className="inline-flex items-center">
              <input type="text" inputMode="decimal" value={pctStr} onChange={(e) => setPctStr(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-16 text-right" title="Porcentaje" placeholder="%" />
              <span className="ml-1 text-xs text-gray-500">%</span>
            </div>
          </td>
          <td className="px-4 py-2 text-right whitespace-nowrap">
            <span className="text-sm font-mono text-gray-600 align-middle" title="Retención = total de haberes × %">{formatPesos(String(retCentesimos))}</span>
            <button onClick={() => { onEdit?.(item.id, { descripcion: d, porcentaje: pctNum }); setEditing(false); }} className="ml-2 text-green-600 hover:text-green-700 align-middle" title="Guardar"><Check size={15} /></button>
            <button onClick={() => { setD(item.descripcion); setPctStr(pctInicial); setEditing(false); }} className="ml-1 text-gray-400 hover:text-gray-600 align-middle" title="Cancelar"><X size={15} /></button>
          </td>
        </tr>
      );
    }
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
  onAdd?: (descripcion: string, monto: number, cantidad?: number, porcentaje?: number) => void;
  onEdit?: (itemId: string, data: { descripcion: string; monto?: number; base?: number; porcentaje?: number }) => void;
  onDelete?: (id: string) => void;
}) {
  const [sel, setSel] = useState('');
  const [desc, setDesc] = useState('');
  const [monto, setMonto] = useState(0);
  const [cantidad, setCantidad] = useState(0);
  const [porcentajeStr, setPorcentajeStr] = useState('');

  const nombreSel = sel === 'OTRO' ? desc : (opciones?.find((x) => x.key === sel)?.nombre ?? desc);
  const esFalta = /\bfaltas?\b/i.test(nombreSel);
  // Retención judicial (embargo): descuento con % editable sobre el total de
  // haberes. Se pide el porcentaje; el monto lo calcula el backend.
  const esRetencion = /retenci[oó]n\s+judicial/i.test(nombreSel);
  // Horas tardes: se carga la CANTIDAD de horas y el monto sale solo
  // (jornal ÷ 8 × horas); resta de los haberes igual que las faltas.
  const esHorasTarde = /\bhoras?\s+tardes?\b|\bllegadas?\s+tardes?\b/i.test(nombreSel);
  // Descansos trabajados: se carga la CANTIDAD y el monto sale solo
  // (cantidad × jornal — un día más por cada descanso trabajado).
  const esDescanso = /\bdescansos?\s+trabajados?\b/i.test(nombreSel);
  // La prima por antigüedad se calcula sola en el backend (0,5% del sueldo por
  // año completo, tope 5%): no se pide monto.
  const esPrima = /prima.*antig/i.test(nombreSel);

  const onSel = (value: string) => {
    setSel(value);
    setCantidad(0);
    setPorcentajeStr('');
    if (value && value !== 'OTRO') {
      const o = opciones?.find((x) => x.key === value);
      setDesc(o?.nombre ?? '');
      setMonto(o?.montoFijo ?? 0);
    } else {
      setDesc(''); setMonto(0);
    }
  };

  const reset = () => { setSel(''); setDesc(''); setMonto(0); setCantidad(0); setPorcentajeStr(''); };

  const agregar = () => {
    const d = nombreSel;
    if (!d.trim()) return;
    if (esFalta || esHorasTarde || esDescanso) {
      if (cantidad > 0) { onAdd?.(d.trim(), 0, cantidad); reset(); }
    } else if (esRetencion) {
      const pct = parseFloat(porcentajeStr.replace(',', '.'));
      if (pct > 0) { onAdd?.(d.trim(), 0, undefined, pct); reset(); }
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
                  {sel && (esFalta || esHorasTarde || esDescanso) && (
                    <input type="number" step="0.01" min="0" value={cantidad || ''} onChange={(e) => setCantidad(Number(e.target.value))} placeholder={esFalta ? 'N° de faltas' : esHorasTarde ? 'N° de horas' : 'N° de descansos'} className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-32" />
                  )}
                  {sel && esRetencion && (
                    <div className="inline-flex items-center">
                      <input type="text" inputMode="decimal" value={porcentajeStr} onChange={(e) => setPorcentajeStr(e.target.value)} placeholder="%" className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-20 text-right" />
                      <span className="ml-1 text-xs text-gray-500">% del total de haberes</span>
                    </div>
                  )}
                  {sel && !esFalta && !esHorasTarde && !esDescanso && !esPrima && !esRetencion && <input type="number" value={monto || ''} onChange={(e) => setMonto(Number(e.target.value))} placeholder="Monto $" className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-28" />}
                  {sel && esFalta && <span className="text-xs text-gray-500">el monto se calcula solo (básico ÷ 30 × faltas)</span>}
                  {sel && esHorasTarde && <span className="text-xs text-gray-500">el monto se calcula solo (jornal ÷ 8 × horas)</span>}
                  {sel && esDescanso && <span className="text-xs text-gray-500">el monto se calcula solo (un jornal por descanso trabajado)</span>}
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
  // Salario vacacional a gozar (liquidación LICENCIA / especial).
  const [vacDias, setVacDias] = useState('');
  const [vacAnticipar, setVacAnticipar] = useState(false);

  // Salario vacacional: días que le CORRESPONDEN / DISPONIBLES, para prellenar
  // "días a gozar" (editable si no se toma toda la licencia).
  const esFinal = liq?.type === 'LIQUIDACION_FINAL';
  const { data: vacInfo } = useQuery({
    queryKey: ['vac-disponibles', liq?.employeeId, liq?.year, liq?.month, activeCompanyId],
    queryFn: () => employeesApi.vacacionDisponibles(liq!.employeeId, liq!.year, liq!.month, activeCompanyId),
    enabled: !!liq && (liq.type === 'LICENCIA' || liq.type === 'LIQUIDACION_FINAL'),
  });
  const vacPrefillDone = useRef(false);
  useEffect(() => {
    if (vacPrefillDone.current || !liq) return;
    if (liq.type === 'LICENCIA' && vacInfo) {
      setVacDias(String(vacInfo.diasDisponibles));
      vacPrefillDone.current = true;
    } else if (liq.type === 'LIQUIDACION_FINAL' && liq.items) {
      // La final trae los días de licencia no gozada en el detalle del ítem.
      const it = liq.items.find((i) => i.concepto === 'SALARIO_VACACIONAL' || i.concepto === 'LICENCIA_NO_GOZADA');
      const det = it?.calculationDetail as { diasNoGozadas?: number } | null | undefined;
      if (det?.diasNoGozadas != null) { setVacDias(String(det.diasNoGozadas)); vacPrefillDone.current = true; }
    }
  }, [liq?.type, vacInfo, liq?.items]);

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

  // Regenera el SALARIO VACACIONAL (liquidación LICENCIA) con los días a gozar.
  // Se dispara con el botón o AUTOMÁTICAMENTE (silent) al cambiar los días.
  const vacacionalMutation = useMutation({
    mutationFn: (vars: { dias: number; silent?: boolean }) => liquidationApi.generateLicencia({
      employeeId: liq!.employeeId,
      periodId: liq!.periodId,
      year: liq!.year,
      month: liq!.month,
      diasHabilesTomar: vars.dias,
      anticipar: vacAnticipar,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['liquidation', id] });
      queryClient.invalidateQueries({ queryKey: ['vac-disponibles'] });
    },
    onError: (e: unknown, vars) => {
      if (vars?.silent) return; // recálculo automático: no molestar mientras se tipea
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo recalcular el salario vacacional.');
    },
  });

  // Regenera la liquidación por EGRESO con los días de licencia a pagar.
  const finalDiasMutation = useMutation({
    mutationFn: (vars: { dias: number; silent?: boolean }) => liquidationApi.recalcFinalDias(id!, vars.dias),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['liquidation', id] });
      queryClient.invalidateQueries({ queryKey: ['vac-disponibles'] });
    },
    onError: (e: unknown, vars) => {
      if (vars?.silent) return;
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo recalcular la liquidación por egreso.');
    },
  });

  // Al cambiar los días a gozar, recalcula el total solo (debounce). No dispara
  // en el prellenado (ese usa setVacDias directo, sin pasar por acá).
  const vacTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVacDiasChange = (val: string) => {
    setVacDias(val);
    if (vacTimer.current) clearTimeout(vacTimer.current);
    const n = Number(val);
    if (!(n > 0)) return;
    if (esFinal) {
      vacTimer.current = setTimeout(() => finalDiasMutation.mutate({ dias: n, silent: true }), 700);
      return;
    }
    // No auto-recalcular si supera los disponibles sin "anticipar" (evita el error a cada tecla).
    if (vacInfo && n > vacInfo.diasDisponibles && !vacAnticipar) return;
    vacTimer.current = setTimeout(() => vacacionalMutation.mutate({ dias: n, silent: true }), 700);
  };

  const addItemMutation = useMutation({
    mutationFn: (vars: { descripcion: string; monto?: number; cantidad?: number; porcentaje?: number; itemType: 'HABER' | 'DESCUENTO_OBRERO' }) => liquidationApi.addItem(id!, vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo agregar el concepto');
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: (vars: { itemId: string; descripcion: string; monto?: number; base?: number; porcentaje?: number }) =>
      liquidationApi.updateItem(id!, vars.itemId, { descripcion: vars.descripcion, monto: vars.monto, base: vars.base, porcentaje: vars.porcentaje }),
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

      {/* Salario vacacional (liquidación LICENCIA): días a gozar */}
      {liq.type === 'LICENCIA' && puedeEditar && (
        <div className="card p-4 border-t-4 border-t-blue-400 space-y-3">
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <RefreshCw size={16} className="text-blue-500" /> Salario vacacional — días a gozar
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="form-label">Días hábiles a gozar</label>
              <input type="number" min="0" max="31" step="0.01" value={vacDias} onChange={(e) => onVacDiasChange(e.target.value)} placeholder="ej. 20" className="form-input" />
              {vacInfo && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Le corresponden {vacInfo.diasCorresponden} · tomados {vacInfo.diasTomados} · <b>disponibles {vacInfo.diasDisponibles}</b>
                </p>
              )}
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={vacAnticipar} onChange={(e) => setVacAnticipar(e.target.checked)} /> Anticipar (más que disponibles)
              </label>
            </div>
            <div className="flex items-start">
              <button onClick={() => { const n = Number(vacDias); if (n > 0) vacacionalMutation.mutate({ dias: n }); }} disabled={!vacDias || vacacionalMutation.isPending} className="btn-primary btn-sm w-full">
                {vacacionalMutation.isPending ? 'Calculando…' : 'Recalcular ahora'}
              </button>
            </div>
          </div>
          {vacInfo && Number(vacDias) > 0 && (
            <div className="text-xs bg-blue-50/60 rounded-lg px-3 py-2 text-gray-700 space-y-0.5">
              <div><b>{Number(vacDias)}</b> días × {formatPesos(vacInfo.jornalLiquido)} (jornal líquido) = <b className="text-blue-700">{formatPesos(String(Math.round(Number(vacInfo.jornalLiquido) * Number(vacDias))))}</b> salario vacacional (exento)</div>
              <div className="text-gray-400">Base: promedio del imponible (concepto 1) de los últimos 6 meses = {formatPesos(vacInfo.jornalNominal)}/día; el líquido le descuenta los aportes de seguridad social.</div>
            </div>
          )}
          <p className="text-[11px] text-gray-400">
            El salario vacacional es 100% del JORNAL LÍQUIDO por cada día de licencia (exento, sin descuentos).
            Los días de licencia gozada se pagan aparte en la mensualidad, con sus aportes. Se prellenan los días DISPONIBLES.
          </p>
        </div>
      )}

      {/* Liquidación por EGRESO: días de licencia a pagar (no gozada + vacacional egreso) */}
      {esFinal && puedeEditar && (
        <div className="card p-4 border-t-4 border-t-blue-400 space-y-3">
          <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <RefreshCw size={16} className="text-blue-500" /> Licencia por egreso — días a pagar
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="form-label">Días de licencia a pagar</label>
              <input type="number" min="0" max="60" step="0.01" value={vacDias} onChange={(e) => onVacDiasChange(e.target.value)} placeholder="ej. 4,72" className="form-input" />
              {vacInfo && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Le corresponden {vacInfo.diasCorresponden} · tomados {vacInfo.diasTomados} · <b>disponibles {vacInfo.diasDisponibles}</b>
                </p>
              )}
            </div>
            <div className="flex items-start">
              <button onClick={() => { const n = Number(vacDias); if (n >= 0) finalDiasMutation.mutate({ dias: n }); }} disabled={vacDias === '' || finalDiasMutation.isPending} className="btn-primary btn-sm w-full">
                {finalDiasMutation.isPending ? 'Calculando…' : 'Recalcular ahora'}
              </button>
            </div>
          </div>
          {(() => {
            const it = liq.items?.find((i) => i.concepto === 'LICENCIA_NO_GOZADA' || i.concepto === 'SALARIO_VACACIONAL');
            const jornal = it?.baseCalculo ? Number(it.baseCalculo) : (vacInfo ? Number(vacInfo.jornalNominal) : 0);
            const n = Number(vacDias);
            if (!(jornal > 0 && n > 0)) return null;
            return (
              <div className="text-xs bg-blue-50/60 rounded-lg px-3 py-2 text-gray-700 space-y-0.5">
                <div><b>{n}</b> días × {formatPesos(String(jornal))} (jornal) = <b>{formatPesos(String(Math.round(jornal * n)))}</b> por partida</div>
                <div>Licencia no gozada + Salario vacacional por egreso (ambos EXENTOS)</div>
              </div>
            );
          })()}
          <p className="text-[11px] text-gray-400">
            Editá los días de licencia a pagar por el egreso; el total (licencia no gozada + salario vacacional por egreso = días × jornal, exentos) se recalcula solo.
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
          onAdd={(descripcion, monto, cantidad, porcentaje) => addItemMutation.mutate({ descripcion, ...(porcentaje !== undefined ? { porcentaje } : cantidad ? { cantidad } : monto ? { monto } : {}), itemType: 'DESCUENTO_OBRERO' })}
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
