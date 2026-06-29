import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Play, RefreshCw, CheckCircle, Eye, Download } from 'lucide-react';
import { liquidationApi, employeesApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import { abrirBlobEnPestania } from '../utils/file';
import { formatPesos, MESES, PayrollPeriod, Employee } from '../types';

interface LiqRow {
  id: string;
  employeeId: string;
  status: string;
  totalHaberes: string;
  totalDescuentos: string;
  liquidoPercibir: string;
}

export default function LiquidationPage() {
  const { isOperator } = useAuth();
  const { activeCompanyId: companyId } = useCompany();
  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [newPeriodMonth, setNewPeriodMonth] = useState(now.getMonth() + 1);

  // Al cambiar de empresa (selector global), limpiar el período seleccionado.
  useEffect(() => { setSelectedPeriodId(null); }, [companyId]);

  const { data: periods, isLoading: periodsLoading } = useQuery({
    queryKey: ['periods', companyId, selectedYear],
    queryFn: () => liquidationApi.listPeriods({ companyId, year: selectedYear }),
    enabled: !!companyId,
  });

  const { data: periodLiquidations } = useQuery({
    queryKey: ['period-liquidations', selectedPeriodId],
    queryFn: () => liquidationApi.byPeriod(selectedPeriodId!) as Promise<LiqRow[]>,
    enabled: !!selectedPeriodId,
  });

  const { data: employees } = useQuery({
    queryKey: ['employees-roster', companyId],
    queryFn: () => employeesApi.list({ companyId, limit: 500 }),
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

  const selectedPeriod = periods?.find((p: PayrollPeriod) => p.id === selectedPeriodId);

  const batchMutation = useMutation({
    mutationFn: () =>
      liquidationApi.generateBatch({ companyId, periodId: selectedPeriodId, year: selectedYear, month: selectedPeriod?.month }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['period-liquidations'] }),
  });

  const genOneMutation = useMutation({
    mutationFn: (employeeId: string) =>
      liquidationApi.generate({ employeeId, periodId: selectedPeriodId, year: selectedYear, month: selectedPeriod?.month }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['period-liquidations'] }),
  });

  const confirmMutation = useMutation({
    mutationFn: (liquidacionId: string) => liquidationApi.confirm(liquidacionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['period-liquidations'] }),
  });

  const liqByEmp = new Map((periodLiquidations ?? []).map((l) => [l.employeeId, l]));
  const roster: Employee[] = employees?.data ?? [];
  const liquidados = periodLiquidations?.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Liquidaciones</h1>
          <p className="text-gray-500 text-sm mt-0.5">Períodos y liquidaciones por empresa</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Periods list */}
        <div className="card">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="text-sm font-semibold text-gray-700 border-0 bg-transparent focus:ring-0 p-0"
            >
              {[2023, 2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            {isOperator && (
              <button onClick={() => setShowNewPeriod(!showNewPeriod)} className="btn-primary btn-sm">
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
                  {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
                <button
                  onClick={() => createPeriodMutation.mutate({ companyId, year: selectedYear, month: newPeriodMonth })}
                  disabled={createPeriodMutation.isPending || !companyId}
                  className="btn-primary btn-sm"
                >OK</button>
              </div>
            </div>
          )}

          <div className="divide-y divide-gray-50">
            {periodsLoading ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Cargando...</p>
            ) : !periods?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Sin períodos. Creá uno con +</p>
            ) : periods.map((period: PayrollPeriod) => (
              <button
                key={period.id}
                onClick={() => setSelectedPeriodId(period.id)}
                className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                  selectedPeriodId === period.id ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-gray-800">{MESES[period.month]} {period.year}</p>
                  <p className="text-xs text-gray-500">{period._count?.liquidations ?? 0} liquidaciones</p>
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

        {/* Roster + liquidations */}
        <div className="lg:col-span-2 card">
          {!selectedPeriodId ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <FileIcon />
              <p className="text-sm mt-3">Seleccioná un período para liquidar</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">{MESES[selectedPeriod?.month ?? 0]} {selectedPeriod?.year}</h2>
                  <p className="text-xs text-gray-500">{liquidados} de {roster.length} personas liquidadas</p>
                </div>
                {isOperator && (
                  <button onClick={() => batchMutation.mutate()} disabled={batchMutation.isPending} className="btn-secondary btn-sm">
                    {batchMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                    Generar todos
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="table-header">
                      <th className="px-4 py-3 text-left">Persona</th>
                      <th className="px-4 py-3 text-right">Haberes</th>
                      <th className="px-4 py-3 text-right">Descuentos</th>
                      <th className="px-4 py-3 text-right">Líquido</th>
                      <th className="px-4 py-3 text-left">Estado</th>
                      <th className="px-4 py-3 text-left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {!roster.length ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                        Sin contratos vigentes en esta empresa
                      </td></tr>
                    ) : roster.map((emp) => {
                      const liq = liqByEmp.get(emp.id);
                      return (
                        <tr key={emp.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-sm text-gray-700 font-medium">{emp.apellido}, {emp.nombre}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs">{liq ? formatPesos(liq.totalHaberes) : '—'}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-red-600">{liq ? `(${formatPesos(liq.totalDescuentos)})` : '—'}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-bold text-green-700">{liq ? formatPesos(liq.liquidoPercibir) : '—'}</td>
                          <td className="px-4 py-2.5">
                            {liq
                              ? <span className={`badge ${liq.status === 'CONFIRMADO' ? 'badge-green' : liq.status === 'BORRADOR' ? 'badge-yellow' : 'badge-red'}`}>{liq.status}</span>
                              : <span className="badge-gray badge">Pendiente</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1">
                              {!liq && isOperator && (
                                <button onClick={() => genOneMutation.mutate(emp.id)} disabled={genOneMutation.isPending} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Generar liquidación">
                                  <Play size={14} />
                                </button>
                              )}
                              {liq && (
                                <Link to={`/liquidation/${liq.id}`} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Ver">
                                  <Eye size={14} />
                                </Link>
                              )}
                              {liq && isOperator && liq.status === 'BORRADOR' && (
                                <button onClick={() => confirmMutation.mutate(liq.id)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded" title="Confirmar">
                                  <CheckCircle size={14} />
                                </button>
                              )}
                              {liq && (
                                <button type="button" onClick={() => abrirBlobEnPestania(() => liquidationApi.recibo(liq.id), `recibo_${liq.id}.pdf`)} className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded" title="Recibo PDF">
                                  <Download size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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
