import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Building2, Pencil, X, Users, AlertCircle, Share2, Eye, EyeOff, Trash2, UserPlus } from 'lucide-react';
import { companiesApi, catalogsApi, membershipApi, CompanyMembership } from '../services/api';
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
  bseRate: number;
  // BPS / MTSS / BSE
  numeroBps?: string;
  numeroBse?: string;
  tipoAporte?: string;
  tipoContribuyente?: string;
  grupoActividadNum?: string;
  subgrupo?: string;
  naturalezaJuridica?: string;
  convenioColectivo?: string;
  representanteLegal?: string;
  representanteCi?: string;
  representanteCargo?: string;
  inicioActividadMtss?: string;
  fechaInscripcionBps?: string;
  // Exoneraciones (basis points)
  exoApoJub: number;
  exoFonasa: number;
  exoFrl: number;
  exoCcm: number;
  // Configuración de licencia / calendario
  diaVencimientoBps: number;
  diasLicenciaAnio: number;
  primerDiaExtraDesdeAnio: number;
  maxDiasExtras: number;
  diasTrabajadosMes: number;
  observaciones?: string;
}

const emptyForm: CompanyForm = {
  razonSocial: '', rut: '', nombreFantasia: '', email: '', telefono: '',
  domicilio: '', localidad: '', departamento: '', actividadPrincipal: '',
  bseRate: 25,
  numeroBps: '', numeroBse: '', tipoAporte: '', tipoContribuyente: '',
  grupoActividadNum: '', subgrupo: '', naturalezaJuridica: '', convenioColectivo: '',
  representanteLegal: '', representanteCi: '', representanteCargo: '',
  inicioActividadMtss: '', fechaInscripcionBps: '',
  exoApoJub: 0, exoFonasa: 0, exoFrl: 0, exoCcm: 0,
  diaVencimientoBps: 20, diasLicenciaAnio: 20, primerDiaExtraDesdeAnio: 5, maxDiasExtras: 35, diasTrabajadosMes: 30,
  observaciones: '',
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
  const { data: tiposAporte } = useQuery({ queryKey: ['tiposAporte'], queryFn: () => catalogsApi.tiposAporte() });
  const { data: tiposContribuyente } = useQuery({ queryKey: ['tiposContribuyente'], queryFn: () => catalogsApi.tiposContribuyente() });
  const { data: gruposActividad } = useQuery({ queryKey: ['gruposActividad'], queryFn: () => catalogsApi.gruposActividad() });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<CompanyForm>({
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
      bseRate: c.bseRate,
      numeroBps: c.numeroBps ?? '',
      numeroBse: c.numeroBse ?? '',
      tipoAporte: c.tipoAporte != null ? String(c.tipoAporte) : '',
      tipoContribuyente: c.tipoContribuyente != null ? String(c.tipoContribuyente) : '',
      grupoActividadNum: c.grupoActividadNum != null ? String(c.grupoActividadNum) : '',
      subgrupo: c.subgrupo ?? '',
      naturalezaJuridica: c.naturalezaJuridica ?? '',
      convenioColectivo: c.convenioColectivo ?? '',
      representanteLegal: c.representanteLegal ?? '',
      representanteCi: c.representanteCi ?? '',
      representanteCargo: c.representanteCargo ?? '',
      inicioActividadMtss: c.inicioActividadMtss ? c.inicioActividadMtss.slice(0, 10) : '',
      fechaInscripcionBps: c.fechaInscripcionBps ? c.fechaInscripcionBps.slice(0, 10) : '',
      exoApoJub: c.exoApoJub ?? 0,
      exoFonasa: c.exoFonasa ?? 0,
      exoFrl: c.exoFrl ?? 0,
      exoCcm: c.exoCcm ?? 0,
      diaVencimientoBps: c.diaVencimientoBps ?? 20,
      diasLicenciaAnio: c.diasLicenciaAnio ?? 20,
      primerDiaExtraDesdeAnio: c.primerDiaExtraDesdeAnio ?? 5,
      maxDiasExtras: c.maxDiasExtras ?? 35,
      diasTrabajadosMes: c.diasTrabajadosMes ?? 30,
      observaciones: c.observaciones ?? '',
    });
    setModalOpen(true);
  };

  const mutation = useMutation({
    mutationFn: (data: CompanyForm) => {
      const payload: Partial<Company> = {
        ...data,
        bseRate: Number(data.bseRate),
        tipoAporte: data.tipoAporte ? Number(data.tipoAporte) : null,
        tipoContribuyente: data.tipoContribuyente ? Number(data.tipoContribuyente) : null,
        grupoActividadNum: data.grupoActividadNum ? Number(data.grupoActividadNum) : null,
        exoApoJub: Number(data.exoApoJub),
        exoFonasa: Number(data.exoFonasa),
        exoFrl: Number(data.exoFrl),
        exoCcm: Number(data.exoCcm),
        diaVencimientoBps: Number(data.diaVencimientoBps),
        diasLicenciaAnio: Number(data.diasLicenciaAnio),
        primerDiaExtraDesdeAnio: Number(data.primerDiaExtraDesdeAnio),
        maxDiasExtras: Number(data.maxDiasExtras),
        diasTrabajadosMes: Number(data.diasTrabajadosMes),
      };
      return editing
        ? companiesApi.update(editing.id, payload)
        : companiesApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      // Refrescar el selector de empresa (usa 'my-companies') para que tome el nombre nuevo.
      queryClient.invalidateQueries({ queryKey: ['my-companies'] });
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

  // ---- Ocultar / Mostrar ----
  const visibilityMutation = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => companiesApi.setVisibility(id, hidden),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['my-companies'] });
    },
  });

  // ---- Eliminar ----
  const deleteMutation = useMutation({
    mutationFn: (id: string) => companiesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['my-companies'] });
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(message || 'No se pudo eliminar la empresa.');
    },
  });

  const handleDelete = (c: Company) => {
    if (!confirm(`¿Eliminar la empresa "${c.razonSocial}"?\n\nSe quita del sistema (baja lógica). Solo es posible si no tiene empleados activos.`)) return;
    deleteMutation.mutate(c.id);
  };

  // ---- Compartir (accesos por empresa) ----
  const [shareCompany, setShareCompany] = useState<Company | null>(null);

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
                <tr key={c.id} className={`hover:bg-canvas/60 transition-colors ${c.hidden ? 'opacity-55' : ''}`}>
                  <td className="table-cell">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-brand-50 rounded-full flex items-center justify-center flex-shrink-0">
                        <Building2 size={15} className="text-brand-600" />
                      </div>
                      <div>
                        <p className="font-medium text-ink text-sm flex items-center gap-2">
                          {c.razonSocial}
                          {c.hidden && <span className="badge-gray text-[10px]">Oculta</span>}
                        </p>
                        {c.nombreFantasia && <p className="text-xs text-ink-subtle">{c.nombreFantasia}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="table-cell font-mono text-xs">{c.rut}</td>
                  <td className="table-cell text-xs">{c.localidad || '-'}</td>
                  <td className="table-cell text-right">
                    <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
                      <Users size={12} />{c._count?.employees ?? 0}
                    </span>
                  </td>
                  <td className="table-cell text-right text-xs font-mono">{(c.bseRate / 100).toFixed(3)}%</td>
                  <td className="table-cell">
                    {isAdmin && (
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 text-ink-subtle hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => setShareCompany(c)}
                          className="p-1.5 text-ink-subtle hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                          title="Compartir (dar acceso a un usuario)"
                        >
                          <Share2 size={15} />
                        </button>
                        <button
                          onClick={() => visibilityMutation.mutate({ id: c.id, hidden: !c.hidden })}
                          disabled={visibilityMutation.isPending}
                          className="p-1.5 text-ink-subtle hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                          title={c.hidden ? 'Mostrar (volver a incluir en el selector)' : 'Ocultar del selector de trabajo'}
                        >
                          {c.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 text-ink-subtle hover:text-bad hover:bg-bad-bg rounded-lg transition-colors"
                          title="Eliminar empresa"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-gray-900">
                {editing ? 'Editar Empresa' : 'Nueva Empresa'}
              </h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  {formError}
                </div>
              )}

              {/* Datos generales */}
              <section className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Datos generales</h3>
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
                  <div className="col-span-2">
                    <label className="form-label">Actividad Principal</label>
                    <input {...register('actividadPrincipal')} className="form-input" />
                  </div>
                  <div className="col-span-2 pt-2 border-t border-hairline">
                    <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-3">Representante legal (firma los contratos de trabajo)</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="form-label">Nombre completo</label>
                        <input {...register('representanteLegal')} className="form-input" placeholder="Nombre y apellido" />
                      </div>
                      <div>
                        <label className="form-label">Cédula de identidad</label>
                        <input {...register('representanteCi')} className="form-input" />
                      </div>
                      <div className="col-span-2">
                        <label className="form-label">Calidad en que comparece</label>
                        <select {...register('representanteCargo')} className="form-input">
                          <option value="">— Seleccionar —</option>
                          <option value="Director">Director/a</option>
                          <option value="Administrador">Administrador/a</option>
                          <option value="Titular">Titular</option>
                          <option value="Representante legal">Representante legal</option>
                          <option value="Apoderado">Apoderado/a</option>
                          <option value="Socio administrador">Socio/a administrador/a</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* BPS / MTSS / BSE */}
              <section className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">BPS / MTSS / BSE</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Tipo de Aporte</label>
                    <select {...register('tipoAporte')} className="form-input">
                      <option value="">— Seleccionar —</option>
                      {tiposAporte?.map((t) => <option key={t.codigo} value={t.codigo}>{t.codigo} - {t.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Tipo de Contribuyente</label>
                    {/* Codificador BPS Tabla 1: los códigos van POR APORTACIÓN — se
                        filtran según el tipo de aporte elegido (IC muestra el 26
                        "Unipersonal con dependientes con cobertura médica", etc.). */}
                    <select {...register('tipoContribuyente')} className="form-input">
                      <option value="">— Seleccionar —</option>
                      {tiposContribuyente
                        ?.filter((t) => !watch('tipoAporte') || t.tipoAporte === Number(watch('tipoAporte')))
                        .map((t) => <option key={`${t.tipoAporte}-${t.codigo}`} value={t.codigo}>{t.codigo} - {t.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Grupo de Actividad (Consejo de Salarios)</label>
                    <select {...register('grupoActividadNum')} className="form-input">
                      <option value="">— Seleccionar —</option>
                      {gruposActividad?.map((g) => <option key={g.numero} value={g.numero}>{g.numero} - {g.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Subgrupo</label>
                    <input {...register('subgrupo')} className="form-input" placeholder="Número o nombre del subgrupo" />
                  </div>
                  <div>
                    <label className="form-label">N° BPS (empresa)</label>
                    <input {...register('numeroBps')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">N° BSE / Carpeta</label>
                    <input {...register('numeroBse')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Tasa BSE (basis points)</label>
                    <input {...register('bseRate', { valueAsNumber: true, min: 0, max: 10000 })} type="number" className="form-input" />
                    <p className="text-xs text-gray-400 mt-1">25 = 0,25%</p>
                  </div>
                  <div>
                    <label className="form-label">Naturaleza Jurídica</label>
                    <input {...register('naturalezaJuridica')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Convenio Colectivo</label>
                    <input {...register('convenioColectivo')} className="form-input" />
                  </div>
                  <div></div>
                  <div>
                    <label className="form-label">Inicio Actividad MTSS</label>
                    <input {...register('inicioActividadMtss')} type="date" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Fecha Inscripción BPS</label>
                    <input {...register('fechaInscripcionBps')} type="date" className="form-input" />
                  </div>
                </div>
              </section>

              {/* Exoneraciones */}
              <section className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Exoneraciones de aportes patronales (basis points, 10000 = 100%)</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="form-label">Apo. Jubilatorio</label>
                    <input {...register('exoApoJub', { valueAsNumber: true })} type="number" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">FONASA (S.E.)</label>
                    <input {...register('exoFonasa', { valueAsNumber: true })} type="number" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">FRL</label>
                    <input {...register('exoFrl', { valueAsNumber: true })} type="number" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">CCM</label>
                    <input {...register('exoCcm', { valueAsNumber: true })} type="number" className="form-input" />
                  </div>
                </div>
              </section>

              {/* Licencia */}
              <section className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Configuración de licencia</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="form-label">Días licencia/año</label>
                    <input {...register('diasLicenciaAnio', { valueAsNumber: true })} type="number" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">1er día extra desde año</label>
                    <input {...register('primerDiaExtraDesdeAnio', { valueAsNumber: true })} type="number" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Máx. días (con extras)</label>
                    <input {...register('maxDiasExtras', { valueAsNumber: true })} type="number" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Días trabajados/mes</label>
                    <input {...register('diasTrabajadosMes', { valueAsNumber: true })} type="number" className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Día vencimiento nómina BPS</label>
                    <input {...register('diaVencimientoBps', { valueAsNumber: true, min: 1, max: 28 })} type="number" className="form-input" />
                    <p className="text-xs text-gray-400 mt-1">Día del mes en que vence la nómina del mes anterior (cronograma ATyR)</p>
                  </div>
                </div>
              </section>

              <div>
                <label className="form-label">Observaciones</label>
                <textarea {...register('observaciones')} className="form-input" rows={2} />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={mutation.isPending} className="btn-primary">
                  {mutation.isPending ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear empresa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Compartir */}
      {shareCompany && (
        <ShareModal company={shareCompany} onClose={() => setShareCompany(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal "Compartir": gestiona los accesos (membresías) de una empresa.
// ---------------------------------------------------------------------------
interface ShareForm {
  email: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
  nombre?: string;
  apellido?: string;
  password?: string;
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Propietario', ADMIN: 'Administrador', OPERATOR: 'Operador', VIEWER: 'Solo lectura',
};

function ShareModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);

  const { data: members, isLoading } = useQuery({
    queryKey: ['company-members', company.id],
    queryFn: () => membershipApi.listByCompany(company.id),
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ShareForm>({
    defaultValues: { email: '', role: 'OPERATOR' },
  });

  // Una cuenta de Google ingresa con OAuth (sin contraseña): no pide más datos.
  const emailValue = watch('email');
  const esGoogle = /@(gmail\.com|googlemail\.com)$/i.test((emailValue || '').trim());

  const shareMutation = useMutation({
    mutationFn: (data: ShareForm) =>
      membershipApi.share({
        companyId: company.id,
        email: data.email,
        role: data.role,
        nombre: data.nombre || undefined,
        apellido: data.apellido || undefined,
        password: data.password || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-members', company.id] });
      queryClient.invalidateQueries({ queryKey: ['my-companies'] });
      reset({ email: '', role: 'OPERATOR' });
      setShowNew(false);
      setError('');
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message || 'No se pudo compartir el acceso.');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => membershipApi.update(id, { estado: 'REVOCADA' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['company-members', company.id] }),
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(message || 'No se pudo revocar el acceso.');
    },
  });

  const activos = (members ?? []).filter((m: CompanyMembership) => m.estado !== 'REVOCADA');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-bold text-ink">Compartir empresa</h2>
            <p className="text-xs text-ink-subtle">{company.razonSocial}</p>
          </div>
          <button onClick={onClose} className="p-1 text-ink-subtle hover:text-ink"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-bad-bg border border-bad/30 rounded-lg text-sm text-bad">
              <AlertCircle size={16} className="flex-shrink-0" />{error}
            </div>
          )}

          {/* Accesos actuales */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-2">Con acceso</h3>
            {isLoading ? (
              <p className="text-sm text-ink-subtle">Cargando…</p>
            ) : !activos.length ? (
              <p className="text-sm text-ink-subtle">Todavía nadie más tiene acceso a esta empresa.</p>
            ) : (
              <ul className="space-y-1.5">
                {activos.map((m: CompanyMembership) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-canvas/60">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{m.user.nombre} {m.user.apellido}</p>
                      <p className="text-xs text-ink-subtle truncate">{m.user.email}</p>
                    </div>
                    <span className="badge-blue shrink-0">{ROLE_LABEL[m.role] ?? m.role}</span>
                    <button
                      onClick={() => { if (confirm(`¿Revocar el acceso de ${m.user.email}?`)) revokeMutation.mutate(m.id); }}
                      className="p-1.5 text-ink-subtle hover:text-bad hover:bg-bad-bg rounded-lg transition-colors shrink-0"
                      title="Revocar acceso"
                    >
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Form: dar acceso */}
          <form onSubmit={handleSubmit((d) => shareMutation.mutate(d))} className="space-y-3 pt-2 border-t border-hairline">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Dar acceso</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Email del usuario</label>
                <input {...register('email', { required: 'Requerido' })} type="email" className="form-input" placeholder="persona@empresa.uy" />
                {errors.email && <p className="form-error">{errors.email.message}</p>}
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Rol</label>
                <select {...register('role')} className="form-input">
                  <option value="OPERATOR">Operador</option>
                  <option value="VIEWER">Solo lectura</option>
                  <option value="ADMIN">Administrador</option>
                  <option value="OWNER">Propietario</option>
                </select>
              </div>
            </div>

            {esGoogle ? (
              <p className="text-xs text-ink-subtle inline-flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
                Cuenta de Google: ingresará con "Iniciar sesión con Google", sin contraseña.
              </p>
            ) : (
              <button type="button" onClick={() => setShowNew((v) => !v)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
                <UserPlus size={13} /> {showNew ? 'El usuario ya existe' : '¿Es un usuario nuevo? Crear con contraseña'}
              </button>
            )}

            {!esGoogle && showNew && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Nombre</label>
                  <input {...register('nombre')} className="form-input" />
                </div>
                <div>
                  <label className="form-label">Apellido</label>
                  <input {...register('apellido')} className="form-input" />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Contraseña inicial</label>
                  <input {...register('password')} type="text" className="form-input" placeholder="mínimo 8 caracteres" />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-tertiary">Cerrar</button>
              <button type="submit" disabled={shareMutation.isPending} className="btn-primary">
                {shareMutation.isPending ? 'Compartiendo…' : 'Compartir'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
