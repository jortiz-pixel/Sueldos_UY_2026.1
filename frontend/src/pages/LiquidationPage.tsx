import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Play, RefreshCw, CheckCircle, Eye, Download } from 'lucide-react';
import { liquidationApi, employeesApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { formatPesos, MESES, PayrollPeriod } from '../types';

export default function LiquidationPage() {
  const { user, isOperator } = useAuth();
  const queryClient = useQueryClient();
  const companyId = user?.companyId ?? '';
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [newPeriodMonth, setNewPeriodMonth] = useState(now.getMonth() + 1);

  const { data: periods, isLoading: periodsLoading } = useQuery({
    queryKey: ['periods', companyId, selectedYear],
    queryFn: () => liquidationApi.listPeriods({ companyId, year: selectedYear }),
    enabled: !!companyId,
  });

  const { data: periodLiquidations, isLoading: liqLoading } = useQuery({
    queryKey: ['period-liquidations', selectedPeriodId],
    queryFn: () => liquidationApi.byPeriod(selectedPeriodId!),
    enabled: !!selectedPeriodId,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-all', companyId],
    queryFn: () => employeesApi.list({ companyId, limit: 200 }),
    enabled: !!companyId,
  });

  const createPeriodMutation = useMutation({
    mutationFn: (data: { companyId: string; year: number; month: number }) =>
      liquidationApi.createPeriod(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods'] });
      setShowNewPeriod(false);
    },
  });

  const batchMutation = useMutation({
    mutationFn: (periodId: string) =>
      liquidationApi.generateBatch({ companyId, periodId, year: selectedYear, month: selectedPeriod?.month }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['period-liquidations'] });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (liquidacionId: string) => liquidationApi.confirm(liquidacionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['period-liquidations'] }),
  });

  const selectedPeriod = periods?.find((p: PayrollPeriod) => p.id === selectedPeriodId);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Liquidaciones</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gestión de períodos y liquidaciones de haberes</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Periods list */}
        <div className="card">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="text-sm font-semibold text-gray-700 border-0 bg-transparent focus:ring-0 p-0"
              >
                {[2023, 2024, 2025, 2026].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            {isOperator && (
              <button
                onClick={() => setShowNewPeriod(!showNewPeriod)}
                className="btn-primary btn-sm"
              >
                <Plus size={14} />
              </button>
            )}
          </div>

          {showNewPeriod && (
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-xs font-medium text-gray-600 mb-2">Crear período {selectedYear}</p>
              <div className="flex gap-2">
                <select
                  value={newPeriodMonth}
                  onChange={(e) => setNewPeriodMonth(parseInt(e.target.value))}
                  className="form-input text-xs flex-1"
                >
                  {MESES.slice(1).map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
                <button
                  onClick={() => createPeriodMutation.mutate({ companyId, year: selectedYear, month: newPeriodMonth })}
                  disabled={createPeriodMutation.isPending}
                  className="btn-primary btn-sm"
                >OK</button>
              </div>
            </div>
          )}

          <div className="divide-y divide-gray-50">
            {periodsLoading ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Cargando...</p>
            ) : !periods?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Sin períodos</p>
            ) : periods.map((period: PayrollPeriod) => (
              <button
                key={period.id}
                onClick={() => setSelectedPeriodId(period.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                  selectedPeriodId === period.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {MESES[period.month]} {period.year}
                  </p>
                  <p className="text-xs text-gray-500">
                    {period._count?.liquidations ?? 0} liquidaciones
                  </p>
                </div>
                <span className={`badge text-xs ${
                  period.status === 'CERRADO' ? 'badge-gray'
                  : period.status === 'CONFIRMADO' ? 'badge-green'
                  : 'badge-yellow'
                }`}>{period.status}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Liquidations panel */}
        <div className="lg:col-span-2 card">
          {!selectedPeriodId ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <FileIcon />
              <p className="text-sm mt-3">Seleccione un período para ver las liquidaciones</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">
                    {MESES[selectedPeriod?.month ?? 0]} {selectedPeriod?.year}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {(periodLiquidations as any[])?.length ?? 0} de {employees?.pagination.total ?? 0} empleados liquidados
                  </p>
                </div>
                {isOperator && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => batchMutation.mutate(selectedPeriodId)}
                      disabled={batchMutation.isPending}
                      className="btn-secondary btn-sm"
                    >
                      {batchMutation.isPending ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : <Play size={14} />}
                      Generar todos
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="table-header">
                      <th className="px-4 py-3 text-left">Empleado</th>
                      <th className="px-4 py-3 text-right">Haberes</th>
                      <th className="px-4 py-3 text-right">Descuentos</th>
                      <th className="px-4 py-3 text-right">Líquido</th>
                      <th className="px-4 py-3 text-left">Estado</th>
                      <th className="px-4 py-3 text-left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {liqLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
                    ) : !(periodLiquidations as any[])?.length ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                        Sin liquidaciones. Haga clic en "Generar todos" para calcular.
                      </td></tr>
                    ) : (periodLiquidations as any[]).map((liq: any) => (
                      <tr key={liq.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-sm text-gray-700">
                          {liq.employeeId}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatPesos(liq.totalHaberes)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-red-600">({formatPesos(liq.totalDescuentos)})</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-bold text-green-700">{formatPesos(liq.liquidoPercibir)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`badge ${liq.status === 'CONFIRMADO' ? 'badge-green' : liq.status === 'BORRADOR' ? 'badge-yellow' : 'badge-red'}`}>
                            {liq.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <Link to={`/liquidation/${liq.id}`} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Ver">
                              <Eye size={14} />
                            </Link>
                            {isOperator && liq.status === 'BORRADOR' && (
                              <button
                                onClick={() => confirmMutation.mutate(liq.id)}
                                className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                                title="Confirmar"
                              >
                                <CheckCircle size={14} />
                              </button>
                            )}
                            <a
                              href={liquidationApi.reciboUrl(liq.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded"
                              title="Recibo PDF"
                            >
                              <Download size={14} />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
