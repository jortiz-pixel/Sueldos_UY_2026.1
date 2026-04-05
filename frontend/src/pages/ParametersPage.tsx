import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Settings, RefreshCw, Plus } from 'lucide-react';
import { parametersApi } from '../services/api';
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
    </div>
  );
}
