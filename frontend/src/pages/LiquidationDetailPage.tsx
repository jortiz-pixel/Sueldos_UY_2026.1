import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, CheckCircle, XCircle } from 'lucide-react';
import { liquidationApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { formatPesos, MESES, PayrollItem, ItemType } from '../types';

function ItemRow({ item }: { item: PayrollItem }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2.5 text-sm text-gray-700">{item.descripcion}</td>
      <td className="px-4 py-2.5 text-right text-xs font-mono text-gray-500">
        {item.baseCalculo ? formatPesos(item.baseCalculo) : '—'}
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-gray-500">
        {item.rate ? `${(item.rate / 100).toFixed(3)}%` : '—'}
      </td>
      <td className="px-4 py-2.5 text-right text-sm font-mono font-medium">
        {formatPesos(item.amount)}
      </td>
    </tr>
  );
}

function Section({ title, items, total, colorClass }: {
  title: string;
  items: PayrollItem[];
  total: string;
  colorClass: string;
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
          {items.map((item) => <ItemRow key={item.id} item={item} />)}
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
          <a
            href={liquidationApi.reciboUrl(id!)}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary btn-sm"
          >
            <Download size={14} />
            Recibo PDF
          </a>
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
        />
        <Section
          title="Descuentos Obreros"
          items={descuentos as PayrollItem[]}
          total={liq.totalDescuentos}
          colorClass="bg-red-50 text-red-800"
        />

        {/* Net */}
        <div className="px-4 py-4 bg-blue-50">
          <div className="flex justify-between items-center">
            <span className="font-bold text-blue-900">LÍQUIDO A PERCIBIR</span>
            <span className="font-bold text-xl text-blue-900 font-mono">{formatPesos(liq.liquidoPercibir)}</span>
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
