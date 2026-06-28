import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { UserPlus, Shield, X, AlertCircle, Ban, Building2 } from 'lucide-react';
import { membershipApi, entitlementApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Propietario',
  ADMIN: 'Administrador',
  OPERATOR: 'Operador',
  VIEWER: 'Consulta',
};

const ESTADO_BADGE: Record<string, string> = {
  ACTIVA: 'bg-green-100 text-green-700',
  PENDIENTE: 'bg-yellow-100 text-yellow-700',
  REVOCADA: 'bg-gray-100 text-gray-500',
};

interface ShareForm {
  email: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  nuevo: boolean;
  nombre: string;
  apellido: string;
  password: string;
}

const emptyForm: ShareForm = {
  email: '', role: 'OPERATOR', nuevo: false, nombre: '', apellido: '', password: '',
};

export default function AccessPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState('');

  const { register, handleSubmit, reset, watch } = useForm<ShareForm>({ defaultValues: emptyForm });
  const esNuevo = watch('nuevo');

  const { data: myCompanies } = useQuery({ queryKey: ['my-memberships'], queryFn: () => membershipApi.my() });
  const activeCompanyId = companyId || myCompanies?.[0]?.companyId || '';

  const { data: members } = useQuery({
    queryKey: ['memberships', activeCompanyId],
    queryFn: () => membershipApi.listByCompany(activeCompanyId),
    enabled: !!activeCompanyId,
  });

  const { data: entitlements } = useQuery({
    queryKey: ['entitlements', activeCompanyId],
    queryFn: () => entitlementApi.listByCompany(activeCompanyId),
    enabled: !!activeCompanyId,
  });

  const shareMutation = useMutation({
    mutationFn: (data: ShareForm) => membershipApi.share({
      companyId: activeCompanyId,
      email: data.email,
      role: data.role,
      ...(data.nuevo ? { nombre: data.nombre, apellido: data.apellido, password: data.password } : {}),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memberships', activeCompanyId] });
      setModalOpen(false);
      reset(emptyForm);
      setFormError('');
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string; details?: Array<{ message: string }> } } };
      setFormError(e.response?.data?.details?.[0]?.message || e.response?.data?.error || 'No se pudo compartir la empresa');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: string; estado?: string } }) =>
      membershipApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memberships', activeCompanyId] }),
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string } } };
      alert(e.response?.data?.error || 'No se pudo actualizar el acceso');
    },
  });

  const canManage = isAdmin || members?.some((m) => ['OWNER', 'ADMIN'].includes(m.role));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accesos a la empresa</h1>
          <p className="text-gray-500 text-sm">Compartí la empresa con otros usuarios y gestioná sus permisos.</p>
        </div>
        {activeCompanyId && (
          <button
            onClick={() => { reset(emptyForm); setFormError(''); setModalOpen(true); }}
            className="flex items-center gap-2 bg-[#003DA5] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-800"
          >
            <UserPlus size={16} /> Compartir empresa
          </button>
        )}
      </div>

      {/* Selector de empresa */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <label className="block text-xs font-medium text-gray-500 mb-1">Empresa</label>
        <select
          value={activeCompanyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="w-full md:w-96 border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          {(myCompanies ?? []).map((c) => (
            <option key={c.companyId} value={c.companyId}>
              {c.nombreFantasia || c.razonSocial}
            </option>
          ))}
        </select>
      </div>

      {/* Módulos contratados */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3 text-gray-700">
          <Building2 size={16} /> <span className="font-medium text-sm">Módulos contratados</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(entitlements as Array<{ module: string; estado: string }> | undefined)?.length
            ? (entitlements as Array<{ module: string; estado: string }>).map((e) => (
              <span key={e.module} className="px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                {e.module} · {e.estado}
              </span>
            ))
            : <span className="text-sm text-gray-400">Sin módulos</span>}
        </div>
      </div>

      {/* Tabla de accesos */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Usuario</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Rol</th>
              <th className="px-4 py-3 text-left">Estado</th>
              {canManage && <th className="px-4 py-3 text-right">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(members ?? []).map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3 font-medium text-gray-900">{m.user.nombre} {m.user.apellido}</td>
                <td className="px-4 py-3 text-gray-500">{m.user.email}</td>
                <td className="px-4 py-3">
                  {canManage && m.estado === 'ACTIVA' ? (
                    <select
                      value={m.role}
                      onChange={(e) => updateMutation.mutate({ id: m.id, data: { role: e.target.value } })}
                      className="border border-gray-200 rounded px-2 py-1 text-xs"
                    >
                      {['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'].map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  ) : ROLE_LABEL[m.role]}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[m.estado]}`}>
                    {m.estado}
                  </span>
                </td>
                {canManage && (
                  <td className="px-4 py-3 text-right">
                    {m.estado !== 'REVOCADA' && (
                      <button
                        onClick={() => {
                          if (confirm(`¿Revocar el acceso de ${m.user.email}?`)) {
                            updateMutation.mutate({ id: m.id, data: { estado: 'REVOCADA' } });
                          }
                        }}
                        className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-xs"
                      >
                        <Ban size={14} /> Revocar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!members?.length && (
              <tr><td colSpan={canManage ? 5 : 4} className="px-4 py-8 text-center text-gray-400">Sin accesos aún</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal compartir */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2"><Shield size={18} /> Compartir empresa</h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">
                <AlertCircle size={16} /> {formError}
              </div>
            )}

            <form onSubmit={handleSubmit((d) => shareMutation.mutate(d))} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email del usuario</label>
                <input type="email" {...register('email', { required: true })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="persona@empresa.uy" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Rol</label>
                <select {...register('role')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="ADMIN">Administrador</option>
                  <option value="OPERATOR">Operador</option>
                  <option value="VIEWER">Consulta</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" {...register('nuevo')} /> Es un usuario nuevo (crear cuenta)
              </label>

              {esNuevo && (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nombre</label>
                      <input {...register('nombre')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Apellido</label>
                      <input {...register('apellido')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Contraseña inicial</label>
                    <input type="text" {...register('password')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="mínimo 8 caracteres" />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
                <button type="submit" disabled={shareMutation.isPending}
                  className="bg-[#003DA5] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-50">
                  {shareMutation.isPending ? 'Compartiendo…' : 'Compartir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
