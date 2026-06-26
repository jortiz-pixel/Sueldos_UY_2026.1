import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Building2, Pencil, X, Users, AlertCircle } from 'lucide-react';
import { companiesApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { Company } from '../types';

interface CompanyForm {
  razonSocial: string;
  rut: string;
  nombreFantasia?: string;
  email?: string;
  telefono?: string;
  domicilio?: string;
  localidad?: string;
  departamento?: string;
  actividadPrincipal?: string;
  grupoActividad?: string;
  bseRate: number;
}

const emptyForm: CompanyForm = {
  razonSocial: '', rut: '', nombreFantasia: '', email: '', telefono: '',
  domicilio: '', localidad: '', departamento: '', actividadPrincipal: '',
  grupoActividad: '', bseRate: 25,
};

export default function CompaniesPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [formError, setFormError] = useState('');

  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: () => companiesApi.list(),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CompanyForm>({
    defaultValues: emptyForm,
  });

  const openCreate = () => {
    setEditing(null);
    setFormError('');
    reset(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (c: Company) => {
    setEditing(c);
    setFormError('');
    reset({
      razonSocial: c.razonSocial,
      rut: c.rut,
      nombreFantasia: c.nombreFantasia ?? '',
      email: c.email ?? '',
      telefono: c.telefono ?? '',
      domicilio: c.domicilio ?? '',
      localidad: c.localidad ?? '',
      departamento: c.departamento ?? '',
      actividadPrincipal: c.actividadPrincipal ?? '',
      grupoActividad: c.grupoActividad ?? '',
      bseRate: c.bseRate,
    });
    setModalOpen(true);
  };

  const mutation = useMutation({
    mutationFn: (data: CompanyForm) => {
      const payload = { ...data, bseRate: Number(data.bseRate) };
      return editing
        ? companiesApi.update(editing.id, payload)
        : companiesApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setModalOpen(false);
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(message || 'Error al guardar la empresa. Verifique los datos.');
    },
  });

  const onSubmit = (data: CompanyForm) => {
    setFormError('');
    mutation.mutate(data);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Empresas</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {companies?.length ?? '—'} empresa(s) registrada(s)
          </p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn-primary">
            <Plus size={16} />
            Nueva Empresa
          </button>
        )}
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">Razón Social</th>
                <th className="px-4 py-3 text-left">RUT</th>
                <th className="px-4 py-3 text-left">Localidad</th>
                <th className="px-4 py-3 text-right">Empleados</th>
                <th className="px-4 py-3 text-right">Tasa BSE</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : !companies?.length ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin empresas registradas</td></tr>
              ) : companies.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="table-cell">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <Building2 size={15} className="text-blue-700" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-800 text-sm">{c.razonSocial}</p>
                        {c.nombreFantasia && <p className="text-xs text-gray-400">{c.nombreFantasia}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="table-cell font-mono text-xs">{c.rut}</td>
                  <td className="table-cell text-xs">{c.localidad || '-'}</td>
                  <td className="table-cell text-right">
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <Users size={12} />{c._count?.employees ?? 0}
                    </span>
                  </td>
                  <td className="table-cell text-right text-xs font-mono">{(c.bseRate / 100).toFixed(3)}%</td>
                  <td className="table-cell">
                    {isAdmin && (
                      <button
                        onClick={() => openEdit(c)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Editar"
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="text-lg font-bold text-gray-900">
                {editing ? 'Editar Empresa' : 'Nueva Empresa'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="form-label">Razón Social *</label>
                  <input {...register('razonSocial', { required: 'Requerido' })} className="form-input" placeholder="Mi Empresa S.A." />
                  {errors.razonSocial && <p className="form-error">{errors.razonSocial.message}</p>}
                </div>

                <div>
                  <label className="form-label">RUT *</label>
                  <input {...register('rut', { required: 'Requerido' })} className="form-input" placeholder="218765432019" />
                  {errors.rut && <p className="form-error">{errors.rut.message}</p>}
                </div>

                <div>
                  <label className="form-label">Nombre de Fantasía</label>
                  <input {...register('nombreFantasia')} className="form-input" />
                </div>

                <div>
                  <label className="form-label">Email</label>
                  <input {...register('email')} type="email" className="form-input" placeholder="contacto@empresa.uy" />
                </div>

                <div>
                  <label className="form-label">Teléfono</label>
                  <input {...register('telefono')} className="form-input" />
                </div>

                <div className="col-span-2">
                  <label className="form-label">Domicilio</label>
                  <input {...register('domicilio')} className="form-input" />
                </div>

                <div>
                  <label className="form-label">Localidad</label>
                  <input {...register('localidad')} className="form-input" />
                </div>

                <div>
                  <label className="form-label">Departamento</label>
                  <input {...register('departamento')} className="form-input" placeholder="Montevideo" />
                </div>

                <div>
                  <label className="form-label">Actividad Principal</label>
                  <input {...register('actividadPrincipal')} className="form-input" />
                </div>

                <div>
                  <label className="form-label">Grupo de Actividad (Consejo de Salarios)</label>
                  <input {...register('grupoActividad')} className="form-input" />
                </div>

                <div>
                  <label className="form-label">Tasa BSE (basis points)</label>
                  <input {...register('bseRate', { valueAsNumber: true, min: 0, max: 10000 })} type="number" className="form-input" />
                  <p className="text-xs text-gray-400 mt-1">25 = 0,25%. Seguro de accidentes laborales (BSE).</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={mutation.isPending} className="btn-primary">
                  {mutation.isPending ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
