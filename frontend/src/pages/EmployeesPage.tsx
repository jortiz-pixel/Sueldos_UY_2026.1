import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search, UserCheck, UserX, Eye, Pencil, X } from 'lucide-react';
import { employeesApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import { Employee, formatCedula } from '../types';

const ESTADO_CIVIL: Record<string, string> = {
  SOLTERO: 'Soltero/a', CASADO: 'Casado/a', CONCUBINATO: 'Concubinato',
  DIVORCIADO: 'Divorciado/a', VIUDO: 'Viudo/a',
};

export default function EmployeesPage() {
  const { isOperator } = useAuth();
  const { activeCompanyId: companyId } = useCompany();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', companyId, search, page, includeInactive],
    queryFn: () => employeesApi.list({
      companyId,
      search: search || undefined,
      page,
      limit: 20,
      includeInactive,
    }),
    enabled: !!companyId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => employeesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });

  const deletePermanentMutation = useMutation({
    mutationFn: (id: string) => employeesApi.deletePermanent(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(message || 'No se pudo eliminar la persona.');
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Personas</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {data?.pagination.total ?? '—'} personas · datos de la ficha (lo laboral se gestiona en Contratos)
          </p>
        </div>
        {isOperator && (
          <Link to="/employees/new" className="btn-primary">
            <Plus size={16} />
            Nuevo Empleado
          </Link>
        )}
      </div>

      <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Buscar por nombre, apellido o CI..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="form-input pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="rounded"
          />
          Incluir inactivos
        </label>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">Persona</th>
                <th className="px-4 py-3 text-left">Cédula</th>
                <th className="px-4 py-3 text-left">Estado civil</th>
                <th className="px-4 py-3 text-left">Cargas familiares</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : !data?.data.length ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin resultados</td></tr>
              ) : data.data.map((emp: Employee) => (
                <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                  <td className="table-cell">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-700 text-xs font-bold">
                          {emp.nombre[0]}{emp.apellido[0]}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-800 text-sm">{emp.apellido}, {emp.nombre}</p>
                        <p className="text-xs text-gray-400">Legajo {emp.employeeNumber ?? '—'} · Ingreso: {new Date(emp.fechaIngreso).toLocaleDateString('es-UY')}</p>
                      </div>
                    </div>
                  </td>
                  <td className="table-cell font-mono text-xs">{formatCedula(emp.ci)}</td>
                  <td className="table-cell text-xs">{ESTADO_CIVIL[emp.estadoCivil] ?? emp.estadoCivil}</td>
                  <td className="table-cell text-xs text-gray-500">
                    {[
                      emp.hijosACargo > 0 && `${emp.hijosACargo} hijo(s)`,
                      emp.conyugeACargo && 'Cónyuge',
                      emp.fonasaFamilia && 'FONASA F.',
                    ].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="table-cell">
                    {emp.active
                      ? <span className="badge-green badge"><UserCheck size={12} className="mr-1" />Activo</span>
                      : <span className="badge-red badge"><UserX size={12} className="mr-1" />Inactivo</span>
                    }
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <Link to={`/employees/${emp.id}`} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Ver ficha y contratos">
                        <Eye size={15} />
                      </Link>
                      {isOperator && (
                        <Link to={`/employees/${emp.id}/edit`} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar persona">
                          <Pencil size={15} />
                        </Link>
                      )}
                      {isOperator && emp.active && (
                        <button
                          onClick={() => {
                            if (confirm(`¿Desactivar a ${emp.nombre} ${emp.apellido}?`)) {
                              deleteMutation.mutate(emp.id);
                            }
                          }}
                          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          title="Desactivar"
                        >
                          <UserX size={15} />
                        </button>
                      )}
                      {isOperator && (
                        <button
                          onClick={() => {
                            if (confirm(`¿Eliminar DEFINITIVAMENTE a ${emp.nombre} ${emp.apellido}?\n\nSolo es posible si no tiene contratos ni liquidaciones. Esta acción no se puede deshacer.`)) {
                              deletePermanentMutation.mutate(emp.id);
                            }
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar definitivamente (solo si no tiene contratos)"
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.pagination.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-500">
              Mostrando {(page - 1) * 20 + 1}–{Math.min(page * 20, data.pagination.total)} de {data.pagination.total}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary btn-sm">← Anterior</button>
              <button onClick={() => setPage((p) => Math.min(data.pagination.pages, p + 1))} disabled={page === data.pagination.pages} className="btn-secondary btn-sm">Siguiente →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
