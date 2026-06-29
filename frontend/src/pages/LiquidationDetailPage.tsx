import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, CheckCircle, XCircle, RotateCcw, X, Plus } from 'lucide-react';
import { liquidationApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { abrirBlobEnPestania } from '../utils/file';
import { formatPesos, MESES, PayrollItem } from '../types';

function ItemRow({ item, onDelete }: { item: PayrollItem; onDelete?: (id: string) => void }) {
  const manual = item.concepto === 'AJUSTE';
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
        {item.rate ? `${(item.rate / 100).toFixed(3)}%` : '—'}
      </td>
      <td className="px-4 py-2.5 text-right text-sm font-mono font-medium">
        <span className="align-middle">{formatPesos(item.amount)}</span>
        {onDelete && manual && (
          <button onClick={() => onDelete(item.id)} className="ml-2 text-red-500 hover:text-red-700 align-middle" title="Quitar concepto"><X size={13} /></button>
        )}
      </td>
    </tr>
  );
}

function Section({ title, items, total, colorClass, onDelete }: {
  title: string;
  items: PayrollItem[];
  total: string;
  colorClass: string;
  onDelete?: (id: string) => void;
}) {
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
          {items.map((item) => <ItemRow key={item.id} item={item} onDelete={onDelete} />)}
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

  const unconfirmMutation = useMutation({
    mutationFn: () => liquidationApi.unconfirm(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['liquidation', id] }),
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo desconfirmar');
    },
  });

  const [tipo, setTipo] = useState<'HABER' | 'DESCUENTO_OBRERO'>('HABER');
  const [desc, setDesc] = useState('');
  const [monto, setMonto] = useState(0);

  const addItemMutation = useMutation({
    mutationFn: () => liquidationApi.addItem(id!, { descripcion: desc, monto, itemType: tipo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['liquidation', id] });
      setDesc(''); setMonto(0);
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      alert(err.response?.data?.error || 'No se pudo agregar el concepto');
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

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/liquidation" className="btn-secondary btn-sm">
          <ArrowLeft size={14} />
          Volver
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            Liquidación — {MESES[liq.month]} {liq.year}
          </h1>
          <p className="text-gray-500 text-sm">Tipo: {liq.type} · {liq.diasTrabajados} días trabajados</p>
        </div>
        <div className="flex items-center gap-2">
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
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500">Total Haberes</p>
          <p className="text-lg font-bold text-gray-900 mt-1">{formatPesos(liq.totalHaberes)}</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-xs text-gray-500">Total Descuentos</p>
          <p className="text-lg font-bold text-red-600 mt-1">({formatPesos(liq.totalDescuentos)})</p>
        </div>
        <div className="card p-4 text-center border-2 border-green-200">
          <p className="text-xs text-gray-500">Líquido a Percibir</p>
          <p className="text-lg font-bold text-green-700 mt-1">{formatPesos(liq.liquidoPercibir)}</p>
        </div>
      </div>

      {/* Itemized breakdown */}
      <div className="card overflow-hidden divide-y divide-gray-100">
        <Section
          title="Haberes"
          items={haberes as PayrollItem[]}
          total={liq.totalHaberes}
          colorClass="bg-green-50 text-green-800"
          onDelete={liq.status === 'BORRADOR' && isOperator ? deleteItemMutation.mutate : undefined}
        />
        <Section
          title="Descuentos Obreros"
          items={descuentos as PayrollItem[]}
          total={liq.totalDescuentos}
          colorClass="bg-red-50 text-red-800"
          onDelete={liq.status === 'BORRADOR' && isOperator ? deleteItemMutation.mutate : undefined}
        />

        {/* Net */}
        <div className="px-4 py-4 bg-blue-50">
          <div className="flex justify-between items-center">
            <span className="font-bold text-blue-900">LÍQUIDO A PERCIBIR</span>
            <span className="font-bold text-xl text-blue-900 font-mono">{formatPesos(liq.liquidoPercibir)}</span>
          </div>
        </div>

        {liq.status === 'BORRADOR' && isOperator && (
          <div className="px-4 py-4 bg-gray-50/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1"><Plus size={13} /> Agregar concepto</p>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={tipo} onChange={(e) => setTipo(e.target.value as 'HABER' | 'DESCUENTO_OBRERO')} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                <option value="HABER">Suma (haber)</option>
                <option value="DESCUENTO_OBRERO">Resta (descuento)</option>
              </select>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descripción (ej. Premio, Adelanto…)" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[180px]" />
              <input type="number" value={monto || ''} onChange={(e) => setMonto(Number(e.target.value))} placeholder="Monto $" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-32" />
              <button
                type="button"
                onClick={() => { if (desc.trim() && monto > 0) addItemMutation.mutate(); }}
                disabled={addItemMutation.isPending || !desc.trim() || monto <= 0}
                className="btn-primary btn-sm"
              >
                {addItemMutation.isPending ? 'Agregando…' : 'Agregar'}
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Los conceptos que sumás (haber) o restás (descuento) se reflejan en el líquido al instante.</p>
          </div>
        )}

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
                      {item.rate ? `${(item.rate / 100).toFixed(3)}%` : ''}
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
