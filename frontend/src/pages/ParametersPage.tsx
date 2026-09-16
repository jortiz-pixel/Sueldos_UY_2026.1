import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Settings, RefreshCw, Plus, HardHat, Coins, Upload, Download, Trash2, CalendarDays } from 'lucide-react';
import { parametersApi, construccionApi } from '../services/api';
import type { LaudoDoc } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { IrpfBracket } from '../types';

export default function ParametersPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [showAddParam, setShowAddParam] = useState(false);
  const [newParam, setNewParam] = useState({ key: '', value: '', description: '', effectiveDate: '' });

  const { data: params, isLoading } = useQuery({
    queryKey: ['parameters'],
    queryFn: () => parametersApi.current(),
  });

  const { data: brackets } = useQuery({
    queryKey: ['tax-brackets'],
    queryFn: () => parametersApi.getTaxBrackets(),
  });

  const { data: allParams } = useQuery({
    queryKey: ['all-parameters'],
    queryFn: () => parametersApi.list(),
    enabled: isAdmin,
  });

  const createParamMutation = useMutation({
    mutationFn: (data: object) => parametersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parameters'] });
      setShowAddParam(false);
      setNewParam({ key: '', value: '', description: '', effectiveDate: '' });
    },
  });

  const formatRate = (bp: number, decimals: number = 2) => {
    return `${(bp / 100).toFixed(decimals)}%`;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Parámetros</h1>
          <p className="text-gray-500 text-sm mt-0.5">Tasas, BPC y escala IRPF vigentes</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowAddParam(!showAddParam)} className="btn-primary">
            <Plus size={16} />
            Nuevo Parámetro
          </button>
        )}
      </div>

      {showAddParam && isAdmin && (
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Agregar Parámetro</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Clave</label>
              <input
                className="form-input"
                placeholder="BPC, BPS_JUBILATORIO_RATE_BP, ..."
                value={newParam.key}
                onChange={(e) => setNewParam({ ...newParam, key: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label">Valor</label>
              <input
                className="form-input"
                placeholder="6756"
                value={newParam.value}
                onChange={(e) => setNewParam({ ...newParam, value: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label">Descripción</label>
              <input
                className="form-input"
                value={newParam.description}
                onChange={(e) => setNewParam({ ...newParam, description: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label">Fecha de vigencia</label>
              <input
                type="datetime-local"
                className="form-input"
                value={newParam.effectiveDate}
                onChange={(e) => setNewParam({ ...newParam, effectiveDate: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => createParamMutation.mutate({
                key: newParam.key,
                value: parseFloat(newParam.value) || newParam.value,
                description: newParam.description,
                effectiveDate: newParam.effectiveDate ? new Date(newParam.effectiveDate).toISOString() : new Date().toISOString(),
              })}
              disabled={createParamMutation.isPending || !newParam.key || !newParam.value}
              className="btn-primary"
            >
              {createParamMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : null}
              Guardar
            </button>
            <button onClick={() => setShowAddParam(false)} className="btn-secondary">Cancelar</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Current parameters */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Settings size={16} />
              Parámetros Vigentes
            </div>
          </div>
          {isLoading ? (
            <p className="px-5 py-6 text-sm text-gray-400">Cargando...</p>
          ) : params ? (
            <div className="divide-y divide-gray-50">
              {[
                { label: 'BPC (Base Prestaciones y Contribuciones)', value: `$${(parseInt(params.bpc) / 100).toLocaleString('es-UY')}` },
                { label: 'BPS Jubilatorio Obrero', value: formatRate(params.bpsJubilatorioRate) },
                { label: 'FONASA Básico Obrero', value: formatRate(params.fonasaBasicRate) },
                { label: 'FONASA Familia Adicional', value: formatRate(params.fonasaFamiliaRate) },
                { label: 'FRL Obrero', value: formatRate(params.frlObreroRate, 3) },
                { label: 'IRPF — Deducción por hijo', value: `${params.irpfHijosBpc} BPC/año` },
                { label: 'IRPF — Deducción por cónyuge', value: `${params.irpfConyugeBpc} BPC/año` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between px-5 py-3 text-sm">
                  <span className="text-gray-600">{label}</span>
                  <span className="font-semibold text-gray-900 font-mono">{value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* IRPF brackets */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Settings size={16} />
              Escala IRPF Vigente (Categoría II)
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="px-4 py-3 text-left text-xs">Desde (BPC/año)</th>
                  <th className="px-4 py-3 text-left text-xs">Hasta (BPC/año)</th>
                  <th className="px-4 py-3 text-right text-xs">Tasa</th>
                  {params && (
                    <th className="px-4 py-3 text-right text-xs">Desde ($)</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(brackets as IrpfBracket[] | undefined)?.map((b, i) => {
                  const bpcPesos = params ? parseInt(params.bpc) / 100 : 0;
                  return (
                    <tr key={i} className={`hover:bg-gray-50 ${b.ratePercent === 0 ? 'text-gray-400' : ''}`}>
                      <td className="px-4 py-2.5 text-sm font-mono">{b.fromBpc}</td>
                      <td className="px-4 py-2.5 text-sm font-mono">{b.toBpc ?? '∞'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-sm">
                        {b.ratePercent === 0 ? 'Exento' : `${b.ratePercent}%`}
                      </td>
                      {params && (
                        <td className="px-4 py-2.5 text-right text-xs font-mono text-gray-400">
                          ${(b.fromBpc * bpcPesos).toLocaleString('es-UY')}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              * Las franjas son anuales. La retención mensual = impuesto anual / 12.
              La base imponible = sueldo neto de BPS y FONASA - deducciones por cargas familiares.
            </p>
          </div>
        </div>
      </div>

      {/* All parameters history (admin only) */}
      {isAdmin && allParams && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Historial de Parámetros</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="px-4 py-3 text-left">Clave</th>
                  <th className="px-4 py-3 text-left">Valor</th>
                  <th className="px-4 py-3 text-left">Descripción</th>
                  <th className="px-4 py-3 text-left">Vigente desde</th>
                  <th className="px-4 py-3 text-left">Expira</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(allParams as any[]).map((p: any) => (
                  <tr key={p.id} className="hover:bg-gray-50 text-xs">
                    <td className="px-4 py-2.5 font-mono font-medium">{p.key}</td>
                    <td className="px-4 py-2.5 font-mono">{p.value}</td>
                    <td className="px-4 py-2.5 text-gray-500">{p.description ?? '—'}</td>
                    <td className="px-4 py-2.5">{new Date(p.effectiveDate).toLocaleDateString('es-UY')}</td>
                    <td className="px-4 py-2.5 text-gray-400">{p.expiresDate ? new Date(p.expiresDate).toLocaleDateString('es-UY') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ValoresComunes />
      <ValoresPorMes />
      <JornalesConstruccion />
      <ConveniosLaudo />
    </div>
  );
}

// ── Valores comunes (índices) ─────────────────────────────────────────────
// Tabla de referencia con los índices que usa el estudio: BPC (base de todos
// los cálculos), UI, UR y BFC. Se guardan versionados por fecha de vigencia
// (misma tabla de parámetros); se muestra el valor vigente a hoy.
const INDICES: Array<{ key: string; label: string }> = [
  { key: 'BPC', label: 'BPC — Base de Prestaciones y Contribuciones' },
  { key: 'BFC_UNIPERSONAL', label: 'BFC — Base Ficta de Contribución' },
  { key: 'UI', label: 'UI — Unidad Indexada' },
  { key: 'UR', label: 'UR — Unidad Reajustable' },
  { key: 'SALARIO_MINIMO', label: 'Salario mínimo nacional' },
  { key: 'CPE', label: 'CPE — Costo Promedio Equivalente' },
  { key: 'CUOTA_MUTUAL', label: 'Cuota mutual' },
  { key: 'CUOTA_MUTUAL_CONSTRUCCION', label: 'Cuota mutual — construcción' },
];

function ValoresComunes() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));

  const { data: all } = useQuery({
    queryKey: ['all-parameters'],
    queryFn: () => parametersApi.list() as Promise<Array<{ key: string; value: string; effectiveDate: string }>>,
    enabled: isAdmin,
  });

  const guardar = useMutation({
    mutationFn: (d: { key: string; value: number; effectiveDate: string }) =>
      parametersApi.create({ key: d.key, value: d.value, effectiveDate: new Date(d.effectiveDate).toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-parameters'] });
      queryClient.invalidateQueries({ queryKey: ['parameters'] });
      setEditKey(null); setValor('');
    },
  });

  const [bpsMsg, setBpsMsg] = useState('');
  const actualizarBps = useMutation({
    mutationFn: () => parametersApi.actualizarBps(),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['all-parameters'] });
      queryClient.invalidateQueries({ queryKey: ['parameters'] });
      setBpsMsg(r.actualizados.length
        ? `Actualizados desde BPS: ${r.actualizados.map((a) => a.key).join(', ')}.`
        : 'Todo al día — ningún valor cambió respecto a BPS.');
    },
    onError: (e: unknown) => setBpsMsg((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo conectar con la página de BPS.'),
  });

  const hoy = new Date();
  const vigente = (key: string): { value: number; date: string } | null => {
    const rows = (all ?? [])
      .filter((p) => p.key === key && new Date(p.effectiveDate) <= hoy)
      .sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime());
    if (!rows.length) return null;
    let v: number;
    try { v = Number(JSON.parse(rows[0].value)); } catch { v = Number(rows[0].value); }
    return { value: v, date: rows[0].effectiveDate };
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Coins size={18} className="text-brand-600" /> Valores comunes (índices)
          </h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">Valor vigente a hoy. Se actualizan solos desde la página de BPS (a diario); también podés forzarlo.</p>
        </div>
        {isAdmin && (
          <button onClick={() => { setBpsMsg(''); actualizarBps.mutate(); }} disabled={actualizarBps.isPending} className="btn-secondary btn-sm shrink-0">
            <RefreshCw size={14} className={actualizarBps.isPending ? 'animate-spin' : ''} /> {actualizarBps.isPending ? 'Consultando BPS…' : 'Actualizar desde BPS'}
          </button>
        )}
      </div>
      {bpsMsg && <p className="text-xs mb-2 rounded-lg px-3 py-2 bg-brand-50 text-brand-700">{bpsMsg}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-hairline">
              <th className="py-2">Índice</th>
              <th className="py-2">Valor vigente</th>
              <th className="py-2">Vigencia desde</th>
              {isAdmin && <th className="py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {INDICES.map((ix) => {
              const v = vigente(ix.key);
              const editando = editKey === ix.key;
              return (
                <tr key={ix.key} className="border-b border-gray-50">
                  <td className="py-2 pr-3">{ix.label}</td>
                  <td className="py-2 pr-3 figure font-semibold">{v ? `$ ${v.value.toLocaleString('es-UY', { maximumFractionDigits: 4 })}` : '—'}</td>
                  <td className="py-2 pr-3 text-gray-500">{v ? new Date(v.date).toLocaleDateString('es-UY') : '—'}</td>
                  {isAdmin && (
                    <td className="py-2 text-right">
                      {editando ? (
                        <div className="flex items-center gap-2 justify-end">
                          <input type="number" step="0.0001" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="valor" className="form-input w-28 py-1" />
                          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="form-input w-36 py-1" />
                          <button
                            onClick={() => { if (valor !== '') guardar.mutate({ key: ix.key, value: Number(valor), effectiveDate: fecha }); }}
                            disabled={guardar.isPending}
                            className="btn-primary btn-sm"
                          >Guardar</button>
                          <button onClick={() => { setEditKey(null); setValor(''); }} className="btn-secondary btn-sm">Cancelar</button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditKey(ix.key); setValor(v ? String(v.value) : ''); setFecha(new Date().toISOString().slice(0, 10)); }} className="text-xs text-blue-600 hover:underline">Actualizar</button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">El <b>BPC</b> se usa en todos los cálculos (aportes, IRPF, topes). UI, UR y BFC quedan como referencia del estudio.</p>
    </div>
  );
}

// ── Jornales de la construcción (laudo, por categoría y recuadro) ─────────
// Al elegir la categoría en un contrato de una empresa de construcción, el
// valor hora se autocompleta desde esta tabla: recuadro INCLUIDOS en la ley
// (aportación CT) o NO INCLUIDOS (grupo 9 con aportación Industria y
// Comercio). Guardar también recalcula ropa/transporte/herramientas (5% ·
// 4,375% · 2% del ½ Oficial Albañil incluidos).
function JornalesConstruccion() {
  const queryClient = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState('');
  const [pct, setPct] = useState('');
  const [fechaAjuste, setFechaAjuste] = useState(new Date().toISOString().slice(0, 10));

  const { data } = useQuery({ queryKey: ['jornales-construccion'], queryFn: () => construccionApi.jornales() });

  const key = (cat: string, rec: string) => `${cat}|${rec}`;
  const vigente = (cat: string, rec: string) => {
    const j = data?.jornales.find((x) => x.categoria === cat && x.recuadro === rec);
    return j ? (Number(j.valorHora) / 100).toFixed(2) : '';
  };

  const guardar = useMutation({
    mutationFn: () => {
      const valores: Array<{ categoria: string; recuadro: 'INCLUIDOS' | 'NO_INCLUIDOS'; valorHoraPesos: number }> = [];
      for (const [k, v] of Object.entries(vals)) {
        const n = Number(v.replace(',', '.'));
        if (!v || isNaN(n) || n <= 0) continue;
        const [categoria, recuadro] = k.split('|');
        valores.push({ categoria, recuadro: recuadro as 'INCLUIDOS' | 'NO_INCLUIDOS', valorHoraPesos: n });
      }
      return construccionApi.saveJornales(new Date(fecha).toISOString(), valores);
    },
    onSuccess: (r) => {
      setMsg(`Guardado: ${r.guardados} jornales · ${r.partidasActualizadas} partidas derivadas actualizadas (ropa/transporte/herramientas).`);
      setVals({});
      queryClient.invalidateQueries({ queryKey: ['jornales-construccion'] });
    },
    onError: () => setMsg('No se pudieron guardar los jornales.'),
  });

  const ajuste = useMutation({
    mutationFn: () => construccionApi.aplicarAjuste(Number(pct.replace(',', '.')), fechaAjuste),
    onSuccess: (r) => {
      setMsg(`Aumento ${r.porcentaje}% aplicado: ${r.guardados} categorías con vigencia nueva · ${r.partidasActualizadas} partidas derivadas actualizadas.`);
      setPct('');
      queryClient.invalidateQueries({ queryKey: ['jornales-construccion'] });
    },
    onError: (e: unknown) => setMsg((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo aplicar el ajuste.'),
  });
  const pctNum = Number(pct.replace(',', '.'));
  const ajusteValido = !!pct && !isNaN(pctNum) && pctNum > -100 && pctNum !== 0;

  return (
    <div className="card p-5 space-y-3 border-t-4 border-t-amber-400">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <HardHat size={18} className="text-amber-500" /> Jornales de la construcción (laudo)
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Valor HORA por categoría. "Incluidos en la ley" = aportación Construcción (CT) · "No incluidos" = grupo 9 con
            aportación Industria y Comercio. Al elegir la categoría en el contrato, el jornal se carga solo desde acá.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Vigencia</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="form-input text-sm" />
          <button onClick={() => guardar.mutate()} disabled={guardar.isPending} className="btn-primary btn-sm">
            {guardar.isPending ? 'Guardando…' : 'Guardar jornales'}
          </button>
        </div>
      </div>
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {data?.vencido && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          ⚠ El convenio vigente rige hasta el {new Date(data.convenioVigenteHasta + 'T00:00:00').toLocaleDateString('es-UY')} y todavía no se
          cargó una vigencia nueva. Buscá el acta de ajuste del Grupo 9 en la web del MTSS y cargá los nuevos valores acá:{' '}
          <a href={data.mtssUrl} target="_blank" rel="noreferrer" className="underline font-medium">Consejos de Salarios — MTSS</a>.
        </div>
      )}
      {!data?.vencido && data?.convenioVigenteHasta && (
        <p className="text-xs text-gray-400">
          Convenio vigente hasta el {new Date(data.convenioVigenteHasta + 'T00:00:00').toLocaleDateString('es-UY')} (acta 22/4/2025, ajuste 5,95%).
          Los nuevos montos se publican en la <a href={data.mtssUrl} target="_blank" rel="noreferrer" className="underline">web del MTSS</a>.
        </p>
      )}
      {/* Aplicar aumento por acta: multiplica TODAS las categorías (ambos
          recuadros) por (1 + %) y crea una vigencia nueva. Rige para todas las
          empresas; las vigencias anteriores no se tocan. */}
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
        <p className="text-sm font-semibold text-amber-900">Aplicar ajuste % (aumento del acta)</p>
        <p className="text-xs text-amber-700">
          Aumenta TODAS las categorías (ambos recuadros) por el % indicado y crea una vigencia nueva desde la fecha.
          Rige para todas las empresas; las vigencias anteriores no se modifican.
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Aumento %</label>
            <input
              type="number" step="0.01" value={pct}
              onChange={(e) => setPct(e.target.value)}
              className="form-input w-28" placeholder="5,95"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Vigencia desde</label>
            <input type="date" value={fechaAjuste} onChange={(e) => setFechaAjuste(e.target.value)} className="form-input" />
          </div>
          <button
            onClick={() => ajuste.mutate()}
            disabled={ajuste.isPending || !ajusteValido}
            className="btn-secondary btn-sm"
          >
            {ajuste.isPending ? 'Aplicando…' : 'Aplicar aumento'}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-3 py-2 text-left">Categoría</th>
              <th className="px-3 py-2 text-right">Incluidos en la ley ($/hora)</th>
              <th className="px-3 py-2 text-right">No incluidos en la ley ($/hora)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(data?.categorias ?? []).map((cat) => (
              <tr key={cat} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 text-sm text-gray-700">{cat}</td>
                {(['INCLUIDOS', 'NO_INCLUIDOS'] as const).map((rec) => (
                  <td key={rec} className="px-3 py-1.5 text-right">
                    <input
                      type="number" step="0.01" min="0"
                      value={vals[key(cat, rec)] ?? vigente(cat, rec)}
                      onChange={(e) => setVals((v) => ({ ...v, [key(cat, rec)]: e.target.value }))}
                      className="form-input text-right w-36 inline-block"
                      placeholder="—"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        Al guardar, ropa (5%), transporte (4,375%) y herramientas (2%) se recalculan desde el ½ Oficial Albañil del recuadro
        "incluidos en la ley" y se actualizan en los conceptos de todas las empresas de construcción.
      </p>
    </div>
  );
}
// ── Ver valores por mes ───────────────────────────────────────────────────
// Elegí un mes y muestra los valores VIGENTES ese mes: índices comunes + los
// jornales del laudo por categoría. Sirve para consultar históricos.
function vigenteEn(all: Array<{ key: string; value: string; effectiveDate: string }> | undefined, key: string, fecha: Date): number | null {
  const rows = (all ?? [])
    .filter((p) => p.key === key && new Date(p.effectiveDate) <= fecha)
    .sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime());
  if (!rows.length) return null;
  try { return Number(JSON.parse(rows[0].value)); } catch { return Number(rows[0].value); }
}

function ValoresPorMes() {
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const fechaStr = `${mes}-15`; // mitad del mes elegido
  const fecha = new Date(`${fechaStr}T00:00:00`);
  const { data: jorn } = useQuery({ queryKey: ['jornales-mes', fechaStr], queryFn: () => construccionApi.jornales(fechaStr) });
  const { data: all } = useQuery({ queryKey: ['all-parameters'], queryFn: () => parametersApi.list() as Promise<Array<{ key: string; value: string; effectiveDate: string }>> });

  const fmt = (n: number | null) => (n == null ? '—' : `$ ${n.toLocaleString('es-UY', { maximumFractionDigits: 4 })}`);
  const incluidos = (jorn?.jornales ?? []).filter((j) => j.recuadro === 'INCLUIDOS');
  const noIncluidos = (jorn?.jornales ?? []).filter((j) => j.recuadro === 'NO_INCLUIDOS');
  const catConValor = (jorn?.categorias ?? []).map((cat) => ({
    cat,
    inc: incluidos.find((j) => j.categoria === cat)?.valorHora,
    noinc: noIncluidos.find((j) => j.categoria === cat)?.valorHora,
  }));

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <CalendarDays size={18} className="text-brand-600" /> Ver valores por mes
        </h2>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="form-input w-auto" />
      </div>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">Valores vigentes en el mes elegido (índices y jornales del laudo).</p>

      <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-1">Índices comunes</p>
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <tbody>
            {INDICES.map((ix) => (
              <tr key={ix.key} className="border-b border-gray-50">
                <td className="py-1.5 pr-3">{ix.label}</td>
                <td className="py-1.5 figure font-semibold">{fmt(vigenteEn(all, ix.key, fecha))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-1">Jornales del laudo (valor hora)</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-hairline">
              <th className="py-2">Categoría</th>
              <th className="py-2">Incluidos (CT)</th>
              <th className="py-2">No incluidos (IC)</th>
            </tr>
          </thead>
          <tbody>
            {catConValor.map((r) => (
              <tr key={r.cat} className="border-b border-gray-50">
                <td className="py-1.5 pr-3">{r.cat}</td>
                <td className="py-1.5 figure">{r.inc ? fmt(Number(r.inc) / 100) : '—'}</td>
                <td className="py-1.5 figure">{r.noinc ? fmt(Number(r.noinc) / 100) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Convenios del laudo (PDF de respaldo por vigencia) ─────────────────────
function ConveniosLaudo() {
  const { isOperator } = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fecha, setFecha] = useState('');
  const [nombre, setNombre] = useState('');
  const [msg, setMsg] = useState('');
  const { data: docs } = useQuery({ queryKey: ['laudo-convenios'], queryFn: () => construccionApi.laudos() });

  const subir = useMutation({
    mutationFn: () => construccionApi.subirLaudo(file as File, fecha, nombre),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['laudo-convenios'] }); setFile(null); setFecha(''); setNombre(''); setMsg('Convenio adjuntado.'); },
    onError: (e: unknown) => setMsg((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo adjuntar (¿tamaño?).'),
  });
  const borrar = useMutation({
    mutationFn: (id: string) => construccionApi.eliminarLaudo(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['laudo-convenios'] }),
  });

  const descargar = async (d: LaudoDoc) => {
    try {
      const blob = await construccionApi.descargarLaudo(d.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { alert('No se pudo abrir el convenio.'); }
  };

  return (
    <div className="card p-5 space-y-3">
      <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
        <HardHat size={18} className="text-amber-500" /> Convenios del laudo (PDF de respaldo)
      </h2>
      <p className="text-xs text-gray-500">
        Adjuntá el acta del MTSS a su fecha de vigencia; queda como respaldo del laudo. Los valores se cargan a mano arriba
        (el acta es un PDF escaneado). No modifica las vigencias anteriores.
      </p>
      {isOperator && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end bg-gray-50 rounded-lg p-3">
          <div>
            <label className="form-label">Archivo (PDF)</label>
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
          </div>
          <div>
            <label className="form-label">Vigencia desde</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">Nombre</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Undécima Ronda" className="form-input" />
          </div>
          <button
            onClick={() => { setMsg(''); if (file && fecha && nombre) subir.mutate(); }}
            disabled={!file || !fecha || !nombre || subir.isPending}
            className="btn-primary btn-sm"
          ><Upload size={14} /> {subir.isPending ? 'Subiendo…' : 'Adjuntar convenio'}</button>
        </div>
      )}
      {msg && <p className="text-xs rounded-lg px-3 py-2 bg-brand-50 text-brand-700">{msg}</p>}
      {!docs?.length ? (
        <p className="text-sm text-gray-400">Todavía no hay convenios adjuntos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-hairline">
                <th className="py-2">Convenio</th>
                <th className="py-2">Vigencia desde</th>
                <th className="py-2">Tamaño</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3">{d.nombre} <span className="text-gray-400">· {d.filename}</span></td>
                  <td className="py-2 pr-3">{new Date(d.effectiveDate).toLocaleDateString('es-UY')}</td>
                  <td className="py-2 pr-3 text-gray-500">{(d.size / 1024 / 1024).toFixed(1)} MB</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button onClick={() => descargar(d)} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"><Download size={13} /> Ver</button>
                    {isOperator && (
                      <button onClick={() => { if (confirm(`¿Eliminar el convenio "${d.nombre}"?`)) borrar.mutate(d.id); }} className="ml-3 text-xs text-red-600 hover:underline inline-flex items-center gap-1"><Trash2 size={13} /> Quitar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
