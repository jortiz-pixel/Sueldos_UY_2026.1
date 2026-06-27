import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { companiesApi, contractsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { formatPesos } from '../types';

export default function ContractsPage() {
  const { user } = useAuth();
  const [selected, setSelected] = useState('');

  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() });
  const companyId = selected || user?.companyId || companies?.[0]?.id || '';

  const { data: contratos, isLoading } = useQuery({
    queryKey: ['contracts-company', companyId],
    queryFn: () => contractsApi.listByCompany(companyId),
    enabled: !!companyId,
  });

  const fmt = (s?: string | null) => s ? new Date(s).toLocaleDateString('es-UY') : 'Vigente';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contratos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Vínculos laborales persona ↔ empresa · {contratos?.length ?? '—'} en la empresa</p>
        </div>
        {user?.role === 'ADMIN' && companies && companies.length > 1 && (
          <select value={companyId} onChange={(e) => setSelected(e.target.value)} className="form-input max-w-xs">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
          </select>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">Persona</th>
                <th className="px-4 py-3 text-left">CI</th>
                <th className="px-4 py-3 text-left">Cargo</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-right">Salario / Jornal</th>
                <th className="px-4 py-3 text-left">Vigencia</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : !contratos?.length ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Sin contratos en esta empresa</td></tr>
              ) : contratos.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="table-cell">
                    <p className="font-medium text-gray-800 text-sm">{c.employee.apellido}, {c.employee.nombre}</p>
                    <p className="text-xs text-gray-400">Contrato N° {c.numero}</p>
                  </td>
                  <td className="table-cell font-mono text-xs">{c.employee.ci}</td>
                  <td className="table-cell text-xs">{c.cargo || '-'}</td>
                  <td className="table-cell">
                    <span className={`badge ${c.salaryType === 'MENSUAL' ? 'badge-blue' : 'badge-gray'}`}>{c.salaryType === 'MENSUAL' ? 'Mensual' : 'Jornalero'}</span>
                  </td>
                  <td className="table-cell text-right font-mono text-xs">
                    {c.salaryType === 'MENSUAL' ? formatPesos(c.salarioNominal) : (c.jornal ? `${formatPesos(c.jornal)}/día` : formatPesos(c.salarioNominal))}
                  </td>
                  <td className="table-cell text-xs">{fmt(c.vigenciaDesde)} — {c.vigenciaHasta ? fmt(c.vigenciaHasta) : 'Vigente'}</td>
                  <td className="table-cell">
                    {!c.vigenciaHasta && c.activo
                      ? <span className="badge-green badge">Vigente</span>
                      : <span className="badge-gray badge">Histórico</span>}
                  </td>
                  <td className="table-cell">
                    <Link to={`/employees/${c.employee.id}`} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg inline-flex" title="Ver persona"><Eye size={15} /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
