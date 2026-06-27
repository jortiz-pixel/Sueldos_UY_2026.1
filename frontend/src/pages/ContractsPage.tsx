import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Eye, Plus, X, AlertCircle } from 'lucide-react';
import { companiesApi, contractsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { formatPesos, SalaryType } from '../types';

interface ContractForm {
  personId: string;
  vigenciaDesde: string;
  fechaIngreso: string;
  tipoContrato?: string;
  cargo?: string;
  categoria?: string;
  nivel?: string;
  salaryType: SalaryType;
  salarioNominalPesos: number;
  jornalPesos?: number;
  sucursal?: string;
  observacion?: string;
}

export default function ContractsPage() {
  const { user, isOperator } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState('');

  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() });
  const companyId = selected || user?.companyId || companies?.[0]?.id || '';
  const empresaNombre = companies?.find((c) => c.id === companyId)?.razonSocial ?? '';

  const { data: contratos, isLoading } = useQuery({
    queryKey: ['contracts-company', companyId],
    queryFn: () => contractsApi.listByCompany(companyId),
    enabled: !!companyId,
  });

  const { data: persons } = useQuery({ queryKey: ['persons-picker'], queryFn: () => contractsApi.persons() });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ContractForm>({
    defaultValues: { personId: '', vigenciaDesde: '', fechaIngreso: '', salaryType: 'MENSUAL', salarioNominalPesos: 0 },
  });
  const salaryType = watch('salaryType');

  const openNew = () => {
    setFormError('');
    const hoy = new Date().toISOString().slice(0, 10);
    reset({ personId: '', vigenciaDesde: hoy, fechaIngreso: hoy, salaryType: 'MENSUAL', salarioNominalPesos: 0, cargo: '', categoria: '', nivel: '' });
    setModalOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: (data: ContractForm) => contractsApi.create(data.personId, {
      companyId,
      vigenciaDesde: data.vigenciaDesde,
      fechaIngreso: data.fechaIngreso,
      tipoContrato: data.tipoContrato || undefined,
      cargo: data.cargo || undefined,
      categoria: data.categoria || undefined,
      nivel: data.nivel || undefined,
      salaryType: data.salaryType,
      salarioNominal: String(Math.round(Number(data.salarioNominalPesos) * 100)),
      jornal: data.jornalPesos ? String(Math.round(Number(data.jornalPesos) * 100)) : undefined,
      sucursal: data.sucursal || undefined,
      observacion: data.observacion || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts-company', companyId] });
      setModalOpen(false);
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(message || 'Error al crear el contrato.');
    },
  });

  const fmt = (s?: string | null) => s ? new Date(s).toLocaleDateString('es-UY') : 'Vigente';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contratos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Vínculos laborales persona ↔ empresa · {contratos?.length ?? '—'} en la empresa</p>
        </div>
        <div className="flex items-center gap-2">
          {user?.role === 'ADMIN' && companies && companies.length > 1 && (
            <select value={companyId} onChange={(e) => setSelected(e.target.value)} className="form-input max-w-xs">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
            </select>
          )}
          {isOperator && (
            <button onClick={openNew} className="btn-primary" disabled={!companyId}>
              <Plus size={16} />
              Nuevo Contrato
            </button>
          )}
        </div>
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

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-gray-900">Nuevo Contrato — {empresaNombre}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-700"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit((d) => { setFormError(''); createMutation.mutate(d); })} className="p-6 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0" />{formError}
                </div>
              )}
              <p className="text-xs text-gray-500">
                Elegí una persona del padrón para vincularla a <b>{empresaNombre}</b>. Si la persona no existe aún, creála primero en <b>Personas → Nuevo Empleado</b>.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="form-label">Persona *</label>
                  <select {...register('personId', { required: 'Requerido' })} className="form-input">
                    <option value="">— Seleccionar persona —</option>
                    {persons?.map((p) => <option key={p.id} value={p.id}>{p.apellido}, {p.nombre} (CI {p.ci})</option>)}
                  </select>
                  {errors.personId && <p className="form-error">{errors.personId.message}</p>}
                </div>
                <div>
                  <label className="form-label">Vigencia desde *</label>
                  <input {...register('vigenciaDesde', { required: 'Requerido' })} type="date" className="form-input" />
                  {errors.vigenciaDesde && <p className="form-error">{errors.vigenciaDesde.message}</p>}
                </div>
                <div>
                  <label className="form-label">Fecha de ingreso *</label>
                  <input {...register('fechaIngreso', { required: 'Requerido' })} type="date" className="form-input" />
                  {errors.fechaIngreso && <p className="form-error">{errors.fechaIngreso.message}</p>}
                </div>
                <div>
                  <label className="form-label">Tipo de contrato</label>
                  <input {...register('tipoContrato')} className="form-input" placeholder="Permanente, Zafral..." />
                </div>
                <div>
                  <label className="form-label">Cargo</label>
                  <input {...register('cargo')} className="form-input" />
                </div>
                <div>
                  <label className="form-label">Categoría</label>
                  <input {...register('categoria')} className="form-input" />
                </div>
                <div>
                  <label className="form-label">Nivel</label>
                  <input {...register('nivel')} className="form-input" />
                </div>
                <div>
                  <label className="form-label">Tipo de remuneración</label>
                  <select {...register('salaryType')} className="form-input">
                    <option value="MENSUAL">Mensual</option>
                    <option value="JORNALERO">Jornalero</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Sueldo nominal mensual ($)</label>
                  <input {...register('salarioNominalPesos', { valueAsNumber: true, required: true, min: 0 })} type="number" step="0.01" className="form-input" />
                </div>
                {salaryType === 'JORNALERO' && (
                  <div>
                    <label className="form-label">Jornal diario ($)</label>
                    <input {...register('jornalPesos', { valueAsNumber: true, min: 0 })} type="number" step="0.01" className="form-input" />
                  </div>
                )}
                <div>
                  <label className="form-label">Sucursal</label>
                  <input {...register('sucursal')} className="form-input" />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Observación</label>
                  <input {...register('observacion')} className="form-input" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                  {createMutation.isPending ? 'Guardando...' : 'Crear contrato'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
