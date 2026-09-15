import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { HardHat, Plus, Pencil, Trash2, X, MapPin } from 'lucide-react';
import { obrasApi, companiesApi } from '../services/api';
import { useCompany } from '../hooks/useCompany';
import { useAuth } from '../hooks/useAuth';
import { esEmpresaConstruccion } from '../constants/conceptos';
import { Obra, Company } from '../types';

const DEPARTAMENTOS = [
  'Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno', 'Flores', 'Florida',
  'Lavalleja', 'Maldonado', 'Montevideo', 'Paysandú', 'Río Negro', 'Rivera', 'Rocha',
  'Salto', 'San José', 'Soriano', 'Tacuarembó', 'Treinta y Tres',
];
const ESTADOS_OBRA = ['Activa', 'Suspendida', 'Finalizada'];

interface ObraForm {
  // Datos de obra
  numeroObra: string;
  numeroIdentificador?: string;
  nombre: string;
  direccion?: string;
  departamento?: string;
  fRealizacion?: string;
  estado?: string;
  aportePatronal?: string;
  cajaActividad?: string;
  nroAutorizacion?: string;
  fechaInicio?: string;
  fechaFin?: string;
  observaciones?: string;
  activa: boolean;
  // Datos del titular (se guardan en la EMPRESA)
  empNumeroBps?: string;
  empRut?: string;
  empRepresentanteLegal?: string;
  empRazonSocial?: string;
  empEmail?: string;
  empTelefono?: string;
  empDomicilio?: string;
  empTipoAporte?: string;
  empActividadPrincipal?: string;
  empTipoContribuyente?: string;
  // Exoneración de aportes patronales (%) — en la EMPRESA
  exoApoJub?: string;
  exoFonasa?: string;
  exoFrl?: string;
  exoCcm?: string;
}

const OBRA_VACIA = {
  numeroObra: '', numeroIdentificador: '', nombre: '', direccion: '', departamento: '',
  fRealizacion: '', estado: 'Activa', aportePatronal: '', cajaActividad: '', nroAutorizacion: '',
  fechaInicio: '', fechaFin: '', observaciones: '', activa: true,
};

// Valores del titular (de la empresa) para prellenar el bloque editable.
function seedTitular(empresa?: Company): Partial<ObraForm> {
  return {
    empNumeroBps: empresa?.numeroBps ?? '',
    empRut: empresa?.rut ?? '',
    empRepresentanteLegal: empresa?.representanteLegal ?? '',
    empRazonSocial: empresa?.razonSocial ?? '',
    empEmail: empresa?.email ?? '',
    empTelefono: empresa?.telefono ?? '',
    empDomicilio: empresa?.domicilio ?? '',
    empTipoAporte: empresa?.tipoAporte != null ? String(empresa.tipoAporte) : '',
    empActividadPrincipal: empresa?.actividadPrincipal ?? '',
    empTipoContribuyente: empresa?.tipoContribuyente != null ? String(empresa.tipoContribuyente) : '',
    exoApoJub: String(empresa?.exoApoJub ?? 0),
    exoFonasa: String(empresa?.exoFonasa ?? 0),
    exoFrl: String(empresa?.exoFrl ?? 0),
    exoCcm: String(empresa?.exoCcm ?? 0),
  };
}

// tipoAporte/tipoContribuyente y las exoneraciones son enteros en el backend.
const intOrNull = (s?: string) => (s && s.trim() !== '' ? Math.round(Number(s)) : null);
const intOr0 = (s?: string) => (s && s.trim() !== '' ? Math.round(Number(s)) : 0);

export default function ObrasPage() {
  const { activeCompanyId } = useCompany();
  const { isOperator } = useAuth();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Obra | null>(null);
  const [formError, setFormError] = useState('');
  const { register, handleSubmit, reset } = useForm<ObraForm>({ defaultValues: OBRA_VACIA });

  const { data: empresa } = useQuery({
    queryKey: ['company', activeCompanyId],
    queryFn: () => companiesApi.get(activeCompanyId),
    enabled: !!activeCompanyId,
  });
  const esConstruccion = esEmpresaConstruccion(empresa);

  const { data: obras, isLoading } = useQuery({
    queryKey: ['obras', activeCompanyId],
    queryFn: () => obrasApi.list(activeCompanyId),
    enabled: !!activeCompanyId && esConstruccion,
  });

  const guardar = useMutation({
    mutationFn: async (data: ObraForm) => {
      // 1) Obra (sus datos propios).
      const obraPayload = {
        companyId: activeCompanyId,
        numeroObra: data.numeroObra,
        numeroIdentificador: data.numeroIdentificador || null,
        nombre: data.nombre,
        direccion: data.direccion || null,
        departamento: data.departamento || null,
        fRealizacion: data.fRealizacion || null,
        estado: data.estado || null,
        aportePatronal: data.aportePatronal || null,
        cajaActividad: data.cajaActividad || null,
        nroAutorizacion: data.nroAutorizacion || null,
        fechaInicio: data.fechaInicio || null,
        fechaFin: data.fechaFin || null,
        observaciones: data.observaciones || null,
        activa: data.activa,
      };
      await (editing ? obrasApi.update(editing.id, obraPayload) : obrasApi.create(obraPayload));
      // 2) Datos del titular + exoneraciones → se guardan en la EMPRESA.
      await companiesApi.update(activeCompanyId, {
        numeroBps: data.empNumeroBps || undefined,
        rut: data.empRut || undefined,
        representanteLegal: data.empRepresentanteLegal || undefined,
        razonSocial: data.empRazonSocial || undefined,
        email: data.empEmail || undefined,
        telefono: data.empTelefono || undefined,
        domicilio: data.empDomicilio || undefined,
        tipoAporte: intOrNull(data.empTipoAporte),
        actividadPrincipal: data.empActividadPrincipal || undefined,
        tipoContribuyente: intOrNull(data.empTipoContribuyente),
        exoApoJub: intOr0(data.exoApoJub),
        exoFonasa: intOr0(data.exoFonasa),
        exoFrl: intOr0(data.exoFrl),
        exoCcm: intOr0(data.exoCcm),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obras', activeCompanyId] });
      queryClient.invalidateQueries({ queryKey: ['company', activeCompanyId] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setModalOpen(false);
    },
    onError: (err: unknown) => {
      setFormError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo guardar.');
    },
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => obrasApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['obras', activeCompanyId] }),
  });

  const abrirNueva = () => {
    setEditing(null);
    setFormError('');
    reset({ ...OBRA_VACIA, ...seedTitular(empresa) });
    setModalOpen(true);
  };
  const abrirEdicion = (o: Obra) => {
    setEditing(o);
    setFormError('');
    reset({
      numeroObra: o.numeroObra, numeroIdentificador: o.numeroIdentificador ?? '', nombre: o.nombre,
      direccion: o.direccion ?? '', departamento: o.departamento ?? '',
      fRealizacion: o.fRealizacion ?? '', estado: o.estado ?? '', aportePatronal: o.aportePatronal ?? '',
      cajaActividad: o.cajaActividad ?? '', nroAutorizacion: o.nroAutorizacion ?? '',
      fechaInicio: o.fechaInicio ?? '', fechaFin: o.fechaFin ?? '',
      observaciones: o.observaciones ?? '', activa: o.activa,
      ...seedTitular(empresa),
    });
    setModalOpen(true);
  };

  if (!esConstruccion) {
    return (
      <div className="card p-8 text-center text-ink-muted">
        <HardHat size={28} className="mx-auto mb-3 text-amber-500" />
        <p className="font-semibold text-ink">Obras es solo para empresas de construcción</p>
        <p className="text-sm mt-1">Esta sección aparece cuando la empresa activa es de la industria de la construcción (Grupo 9).</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2"><HardHat size={20} className="text-amber-500" /> Obras</h1>
          <p className="text-gray-500 text-sm mt-0.5">Datos de las obras de la empresa, para tomar en las nóminas · {obras?.length ?? '—'} cargada(s)</p>
        </div>
        {isOperator && (
          <button onClick={abrirNueva} className="btn-primary btn-sm"><Plus size={15} /> Nueva obra</button>
        )}
      </div>

      {isLoading ? (
        <div className="card p-8 text-center text-gray-400">Cargando…</div>
      ) : !obras?.length ? (
        <div className="card p-8 text-center text-gray-400">Todavía no hay obras cargadas.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {obras.map((o) => (
            <div key={o.id} className={`card p-4 ${!o.activa ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink truncate">{o.nombre}</p>
                  <p className="text-xs text-ink-muted figure">Obra Nº {o.numeroObra}{o.numeroIdentificador ? ` · Ident. ${o.numeroIdentificador}` : ''}</p>
                </div>
                {o.estado
                  ? <span className={`badge ${o.estado === 'Activa' ? 'badge-green' : 'badge-gray'}`}>{o.estado}</span>
                  : (!o.activa && <span className="badge badge-gray">Inactiva</span>)}
              </div>
              {(o.direccion || o.departamento) && (
                <p className="text-xs text-gray-500 mt-2 flex items-start gap-1">
                  <MapPin size={13} className="shrink-0 mt-0.5" />
                  <span>{[o.direccion, o.departamento].filter(Boolean).join(', ')}</span>
                </p>
              )}
              {(o.fechaInicio || o.fechaFin) && (
                <p className="text-[11px] text-gray-400 mt-1">
                  {o.fechaInicio ? `Inicio ${o.fechaInicio}` : ''}{o.fechaFin ? ` · Fin ${o.fechaFin}` : ''}
                </p>
              )}
              {isOperator && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-hairline">
                  <button onClick={() => abrirEdicion(o)} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"><Pencil size={13} /> Editar</button>
                  <button
                    onClick={() => { if (confirm(`¿Eliminar la obra "${o.nombre}"?`)) eliminar.mutate(o.id); }}
                    className="text-xs text-red-600 hover:underline inline-flex items-center gap-1"
                  ><Trash2 size={13} /> Eliminar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSubmit((d) => { setFormError(''); guardar.mutate(d); })} className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-ink">{editing ? 'Datos de obra' : 'Nueva obra'}</h2>
                <button type="button" onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>

              {formError && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{formError}</div>}

              <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Datos de obra</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">N° Obra *</label>
                  <input {...register('numeroObra', { required: true })} className="form-input" placeholder="Ej. 648H4881" />
                </div>
                <div>
                  <label className="form-label">N° Identificador</label>
                  <input {...register('numeroIdentificador')} className="form-input" />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Nombre de obra *</label>
                  <input {...register('nombre', { required: true })} className="form-input" placeholder="Ej. Edificio Río Dulce" />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Dirección obra</label>
                  <input {...register('direccion')} className="form-input" />
                </div>
                <div>
                  <label className="form-label">Departamento</label>
                  <select {...register('departamento')} className="form-input">
                    <option value="">—</option>
                    {DEPARTAMENTOS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">F. de Realización</label>
                  <input {...register('fRealizacion')} className="form-input" placeholder="(lista a definir)" />
                </div>
                <div>
                  <label className="form-label">Estado</label>
                  <select {...register('estado')} className="form-input">
                    <option value="">—</option>
                    {ESTADOS_OBRA.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Ap. Pat.</label>
                  <input {...register('aportePatronal')} className="form-input" placeholder="(lista a definir)" />
                </div>
                <div>
                  <label className="form-label">Inicio Act.</label>
                  <input type="date" {...register('fechaInicio')} className="form-input" />
                </div>
                <div>
                  <label className="form-label">Fin</label>
                  <input type="date" {...register('fechaFin')} className="form-input" />
                </div>
                <div>
                  <label className="form-label">Caja Act.</label>
                  <input {...register('cajaActividad')} className="form-input" placeholder="(lista a definir)" />
                </div>
                <div>
                  <label className="form-label">N° Aut.</label>
                  <input {...register('nroAutorizacion')} className="form-input" />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Observación</label>
                  <input {...register('observaciones')} className="form-input" />
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" {...register('activa')} className="rounded" /> Obra activa
                </label>
              </div>

              {/* Datos del titular: editables. Se guardan en la EMPRESA (valen para
                  todas sus obras). */}
              <div className="border-t border-hairline pt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-2">
                  Datos del titular <span className="normal-case font-normal text-ink-subtle">— se guardan en la empresa</span>
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="form-label">N° Empresa</label>
                    <input {...register('empNumeroBps')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">RUT</label>
                    <input {...register('empRut')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Contacto</label>
                    <input {...register('empRepresentanteLegal')} className="form-input" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="form-label">Razón Social</label>
                    <input {...register('empRazonSocial')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">E-Mail</label>
                    <input {...register('empEmail')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Teléfono</label>
                    <input {...register('empTelefono')} className="form-input" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="form-label">Dirección</label>
                    <input {...register('empDomicilio')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Tipo Ap.</label>
                    <input type="number" {...register('empTipoAporte')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Tipo Cont.</label>
                    <input type="number" {...register('empTipoContribuyente')} className="form-input" />
                  </div>
                  <div className="md:col-span-1">
                    <label className="form-label">Act. Pri.</label>
                    <input {...register('empActividadPrincipal')} className="form-input" />
                  </div>
                </div>
              </div>

              {/* Exoneración de aportes patronales (%): editable, en la EMPRESA. */}
              <div className="border-t border-hairline pt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-2">Exoneración de aportes patronales <span className="normal-case font-normal">(basis points · 10000 = 100%)</span></p>
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <label className="form-label">Apo. Jub.</label>
                    <input type="number" step="1" min="0" max="10000" {...register('exoApoJub')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">S.E.</label>
                    <input type="number" step="1" min="0" max="10000" {...register('exoFonasa')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">F.R.L</label>
                    <input type="number" step="1" min="0" max="10000" {...register('exoFrl')} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">C.C.M</label>
                    <input type="number" step="1" min="0" max="10000" {...register('exoCcm')} className="form-input" />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={guardar.isPending} className="btn-primary">{guardar.isPending ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
