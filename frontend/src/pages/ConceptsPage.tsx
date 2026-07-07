import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Calculator, Pencil, Trash2, X, AlertCircle, Copy, Eye, EyeOff } from 'lucide-react';
import { conceptsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import { Concepto, ItemType, formatPesos } from '../types';
import { CONCEPTOS_SISTEMA, ConceptoSistema } from '../constants/conceptos';

interface ConceptoForm {
  alcance: 'COMUN' | 'PROPIA';
  codigo: string;
  nombre: string;
  orden: number;
  tipoOperacion: ItemType;
  tipoCalculo: 'VALOR_FIJO' | 'PORCENTAJE' | 'CANTIDAD_VALOR' | 'PORCENTAJE_CIENMIL';
  baseCalculo: string;
  valorRate: number;
  valorFijoPesos: number;
  gravado: boolean;
  activo: boolean;
}

const emptyForm: ConceptoForm = {
  alcance: 'PROPIA', codigo: '', nombre: '', orden: 100, tipoOperacion: 'HABER',
  tipoCalculo: 'VALOR_FIJO', baseCalculo: 'NOMINAL', valorRate: 0,
  valorFijoPesos: 0, gravado: true, activo: true,
};

const OP_LABEL: Record<string, string> = {
  HABER: 'Haber', DESCUENTO_OBRERO: 'Descuento', APORTE_PATRONAL: 'Aporte patronal', INFORMATIVO: 'Informativo',
};

export default function ConceptsPage() {
  const { isOperator, isAdmin } = useAuth();
  const { activeCompanyId: companyId } = useCompany();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Concepto | null>(null);
  const [formError, setFormError] = useState('');

  const { data: conceptos } = useQuery({
    queryKey: ['concepts', companyId],
    queryFn: () => conceptsApi.list(companyId),
    enabled: !!companyId,
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ConceptoForm>({ defaultValues: emptyForm });
  const tipoCalculo = watch('tipoCalculo');

  const comunes = (conceptos ?? []).filter((c) => c.esComun);
  const propios = (conceptos ?? []).filter((c) => !c.esComun);

  const openCreate = () => { setEditing(null); setFormError(''); reset({ ...emptyForm, alcance: isAdmin ? 'COMUN' : 'PROPIA' }); setModalOpen(true); };

  const openEdit = (c: Concepto) => {
    setEditing(c);
    setFormError('');
    reset({
      alcance: c.esComun ? 'COMUN' : 'PROPIA',
      codigo: c.codigo, nombre: c.nombre, orden: c.orden,
      tipoOperacion: c.tipoOperacion, tipoCalculo: c.tipoCalculo,
      baseCalculo: c.baseCalculo ?? 'NOMINAL', valorRate: c.valorRate ?? 0,
      valorFijoPesos: c.valorFijo ? Number(c.valorFijo) / 100 : 0,
      gravado: c.gravado, activo: c.activo,
    });
    setModalOpen(true);
  };

  // Duplicar un concepto existente como uno nuevo (propio de la empresa activa por defecto).
  const openDuplicate = (c: Concepto) => {
    setEditing(null);
    setFormError('');
    reset({
      alcance: 'PROPIA',
      codigo: `${c.codigo}_COPIA`, nombre: `${c.nombre} (copia)`, orden: c.orden,
      tipoOperacion: c.tipoOperacion, tipoCalculo: c.tipoCalculo,
      baseCalculo: c.baseCalculo ?? 'NOMINAL', valorRate: c.valorRate ?? 0,
      valorFijoPesos: c.valorFijo ? Number(c.valorFijo) / 100 : 0,
      gravado: c.gravado, activo: c.activo,
    });
    setModalOpen(true);
  };

  // Usar un concepto del sistema como plantilla para crear uno editable.
  const openFromSistema = (c: ConceptoSistema) => {
    setEditing(null);
    setFormError('');
    reset({
      ...emptyForm,
      alcance: 'PROPIA',
      codigo: '', nombre: `${c.nombre} (personalizado)`,
      tipoOperacion: c.tipo as ItemType,
      gravado: c.gravado.toLowerCase().startsWith('s'),
    });
    setModalOpen(true);
  };

  const mutation = useMutation({
    mutationFn: (data: ConceptoForm) => {
      const payload = {
        companyId: data.alcance === 'COMUN' ? null : companyId,
        codigo: data.codigo,
        nombre: data.nombre,
        orden: Number(data.orden),
        tipoOperacion: data.tipoOperacion,
        tipoCalculo: data.tipoCalculo,
        baseCalculo: (data.tipoCalculo === 'PORCENTAJE' || data.tipoCalculo === 'PORCENTAJE_CIENMIL') ? data.baseCalculo : null,
        valorRate: (data.tipoCalculo === 'PORCENTAJE' || data.tipoCalculo === 'PORCENTAJE_CIENMIL') ? Number(data.valorRate) : null,
        valorFijo: (data.tipoCalculo === 'VALOR_FIJO' || data.tipoCalculo === 'CANTIDAD_VALOR')
          ? String(Math.round(Number(data.valorFijoPesos) * 100)) : null,
        gravado: data.gravado,
        activo: data.activo,
      };
      return editing ? conceptsApi.update(editing.id, payload) : conceptsApi.create(payload);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['concepts', companyId] }); setModalOpen(false); },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(message || 'Error al guardar el concepto.');
    },
  });

  const toggleActivo = useMutation({
    mutationFn: (c: Concepto) => conceptsApi.update(c.id, { activo: !c.activo }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['concepts', companyId] }),
  });

  const toggleOculto = useMutation({
    mutationFn: (c: Concepto) => conceptsApi.setVisibility(c.id, companyId, !c.oculto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['concepts', companyId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => conceptsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['concepts', companyId] }),
  });

  const resumenCalculo = (c: Concepto) => {
    if (c.tipoCalculo === 'PORCENTAJE') return `${(c.valorRate ?? 0) / 100}% sobre ${c.baseCalculo}`;
    if (c.tipoCalculo === 'PORCENTAJE_CIENMIL') return `${((c.valorRate ?? 0) / 10000).toFixed(4).replace('.', ',')}% sobre ${c.baseCalculo}`;
    if (c.tipoCalculo === 'VALOR_FIJO') return `${c.valorFijo ? formatPesos(c.valorFijo) : '$0'} fijo`;
    return `${c.valorFijo ? formatPesos(c.valorFijo) : '$0'} × cantidad`;
  };

  // ¿Puede el usuario administrar (editar/eliminar) este concepto según su alcance?
  const puedeAdministrar = (c: Concepto) => (c.esComun ? isAdmin : isOperator);

  const renderRow = (c: Concepto) => (
    <tr key={c.id} className={`hover:bg-gray-50 ${c.oculto ? 'opacity-50' : ''}`}>
      <td className="table-cell text-sm">
        {c.nombre}<span className="block font-mono text-[11px] text-gray-400">{c.codigo}</span>
      </td>
      <td className="table-cell">
        <span className={`badge ${c.tipoOperacion === 'HABER' ? 'badge-green' : c.tipoOperacion === 'DESCUENTO_OBRERO' ? 'badge-red' : 'badge-gray'}`}>
          {OP_LABEL[c.tipoOperacion]}
        </span>
      </td>
      <td className="table-cell text-xs text-gray-600">{resumenCalculo(c)}</td>
      <td className="table-cell text-xs">{c.gravado ? 'Sí' : 'No'}</td>
      <td className="table-cell">
        {c.esComun
          ? <span className="badge bg-violet-50 text-violet-600">Común</span>
          : <span className="badge bg-blue-50 text-blue-600">Propio</span>}
      </td>
      <td className="table-cell">
        <button
          onClick={() => puedeAdministrar(c) && toggleActivo.mutate(c)}
          className={`badge ${c.activo ? 'badge-green' : 'badge-gray'} ${puedeAdministrar(c) ? 'cursor-pointer' : ''}`}
          title={puedeAdministrar(c) ? 'Click para activar/desactivar' : ''}
        >
          {c.activo ? 'Activo' : 'Inactivo'}
        </button>
      </td>
      <td className="table-cell">
        <div className="flex items-center gap-1">
          {isOperator && (
            <button onClick={() => openDuplicate(c)} className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg" title="Duplicar"><Copy size={15} /></button>
          )}
          {/* Mostrar/ocultar en esta empresa (sobre todo para comunes) */}
          {isOperator && (
            <button
              onClick={() => toggleOculto.mutate(c)}
              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"
              title={c.oculto ? 'Mostrar en esta empresa' : 'Ocultar en esta empresa'}
            >
              {c.oculto ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          {puedeAdministrar(c) && (
            <>
              <button onClick={() => openEdit(c)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Editar"><Pencil size={15} /></button>
              <button onClick={() => { if (confirm(`¿Eliminar el concepto ${c.codigo}?`)) deleteMutation.mutate(c.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Eliminar"><Trash2 size={15} /></button>
            </>
          )}
        </div>
      </td>
    </tr>
  );

  const tableHead = (
    <thead>
      <tr className="table-header">
        <th className="px-4 py-3 text-left">Concepto</th>
        <th className="px-4 py-3 text-left">Tipo</th>
        <th className="px-4 py-3 text-left">Cálculo</th>
        <th className="px-4 py-3 text-left">Gravado</th>
        <th className="px-4 py-3 text-left">Alcance</th>
        <th className="px-4 py-3 text-left">Estado</th>
        <th className="px-4 py-3 text-left">Acciones</th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conceptos</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {comunes.length} comunes · {propios.length} propios · {CONCEPTOS_SISTEMA.length} del sistema
          </p>
        </div>
        {isOperator && (
          <button onClick={openCreate} className="btn-primary" disabled={!companyId}>
            <Plus size={16} />
            Nuevo Concepto
          </button>
        )}
      </div>

      {/* Conceptos comunes a todas las empresas */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Comunes <span className="font-normal text-gray-400">(disponibles en todas las empresas)</span></h2>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              {tableHead}
              <tbody className="divide-y divide-gray-50">
                {comunes.length === 0
                  ? <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">Sin conceptos comunes. {isAdmin ? 'Creá uno con alcance "Común".' : 'Solo un administrador de plataforma puede crearlos.'}</td></tr>
                  : comunes.map(renderRow)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Conceptos propios de la empresa activa */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Propios de esta empresa</h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              {tableHead}
              <tbody className="divide-y divide-gray-50">
                {propios.length === 0
                  ? <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">Sin conceptos propios todavía.</td></tr>
                  : propios.map(renderRow)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Conceptos del sistema (núcleo legal, calculados por el motor) */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Del sistema <span className="font-normal text-gray-400">(calculados por el motor)</span></h2>
        <p className="text-xs text-gray-400 mb-2">Son el núcleo legal: no se editan ni se borran (cambiarlos no cambiaría el cálculo). Usá <b>Duplicar</b> para crear tu propia versión editable, o <b>+ Nuevo Concepto</b> para uno nuevo (esos sí se editan y eliminan).</p>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="px-4 py-3 text-left">Concepto</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Cálculo</th>
                  <th className="px-4 py-3 text-left">Gravado</th>
                  <th className="px-4 py-3 text-left">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {CONCEPTOS_SISTEMA.map((c) => (
                  <tr key={`sys-${c.nombre}`} className="hover:bg-gray-50">
                    <td className="table-cell text-sm font-medium text-gray-800">{c.nombre}</td>
                    <td className="table-cell">
                      <span className={`badge ${c.tipo === 'HABER' ? 'badge-green' : c.tipo === 'DESCUENTO_OBRERO' ? 'badge-red' : 'badge-gray'}`}>{OP_LABEL[c.tipo]}</span>
                    </td>
                    <td className="table-cell text-xs text-gray-600">{c.calculo}</td>
                    <td className="table-cell text-xs">{c.gravado}</td>
                    <td className="table-cell">
                      {isOperator && (
                        <button onClick={() => openFromSistema(c)} className="p-1.5 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg" title="Usar como plantilla"><Copy size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card p-4 bg-blue-50/40 border-blue-100">
        <div className="flex items-start gap-2 text-xs text-gray-600">
          <Calculator size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p>
            Los conceptos <b>comunes</b> están disponibles para todas las empresas; los <b>propios</b> solo en la empresa
            donde se crearon. Con el ojito podés <b>ocultar</b> un concepto en esta empresa sin afectar a las demás.
            Los conceptos <b>activos</b> se aplican automáticamente en cada liquidación, en su orden. Los aportes legales
            núcleo (BPS, FONASA, FRL, IRPF) los calcula siempre el motor.
          </p>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-gray-900">{editing ? 'Editar Concepto' : 'Nuevo Concepto'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-700"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit((d) => { setFormError(''); mutation.mutate(d); })} className="p-6 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0" />{formError}
                </div>
              )}
              <div>
                <label className="form-label">Alcance</label>
                <select {...register('alcance')} className="form-input" disabled={!isAdmin}>
                  <option value="PROPIA">Propio de esta empresa</option>
                  <option value="COMUN">Común (todas las empresas)</option>
                </select>
                {!isAdmin && <p className="text-xs text-gray-400 mt-1">Solo un administrador de plataforma puede crear conceptos comunes.</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Código *</label>
                  <input {...register('codigo', { required: 'Requerido' })} className="form-input" placeholder="PRES" />
                  {errors.codigo && <p className="form-error">{errors.codigo.message}</p>}
                </div>
                <div>
                  <label className="form-label">Orden</label>
                  <input {...register('orden', { valueAsNumber: true })} type="number" className="form-input" />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Nombre *</label>
                  <input {...register('nombre', { required: 'Requerido' })} className="form-input" placeholder="Presentismo" />
                  {errors.nombre && <p className="form-error">{errors.nombre.message}</p>}
                </div>
                <div>
                  <label className="form-label">Tipo de operación</label>
                  <select {...register('tipoOperacion')} className="form-input">
                    <option value="HABER">Haber</option>
                    <option value="DESCUENTO_OBRERO">Descuento</option>
                    <option value="APORTE_PATRONAL">Aporte patronal</option>
                    <option value="INFORMATIVO">Informativo</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Tipo de cálculo</label>
                  <select {...register('tipoCalculo')} className="form-input">
                    <option value="VALOR_FIJO">Valor fijo</option>
                    <option value="PORCENTAJE">Porcentaje sobre base</option>
                    <option value="CANTIDAD_VALOR">Cantidad × valor</option>
                    <option value="PORCENTAJE_CIENMIL">Porcentaje fino (4 decimales, ej. Fondo Social 0,5809% = 5809)</option>
                  </select>
                </div>
                {(tipoCalculo === 'PORCENTAJE' || tipoCalculo === 'PORCENTAJE_CIENMIL') ? (
                  <>
                    <div>
                      <label className="form-label">Base</label>
                      <select {...register('baseCalculo')} className="form-input">
                        <option value="NOMINAL">Sueldo nominal</option>
                        <option value="SUELDO_BASICO">Sueldo básico del mes</option>
                        <option value="HABERES_GRAVADOS">Haberes gravados</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">{tipoCalculo === 'PORCENTAJE_CIENMIL' ? 'Tasa (% × 10.000: 0,5809% = 5809)' : 'Tasa (basis points, 500 = 5%)'}</label>
                      <input {...register('valorRate', { valueAsNumber: true })} type="number" className="form-input" />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="form-label">{tipoCalculo === 'CANTIDAD_VALOR' ? 'Valor unitario ($)' : 'Monto fijo ($)'}</label>
                    <input {...register('valorFijoPesos', { valueAsNumber: true })} type="number" step="0.01" className="form-input" />
                  </div>
                )}
                <div className="flex items-center gap-2 pt-6">
                  <input {...register('gravado')} type="checkbox" id="gravado" className="rounded" />
                  <label htmlFor="gravado" className="text-sm text-gray-700">Gravado (suma a base de aportes)</label>
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input {...register('activo')} type="checkbox" id="activo" className="rounded" />
                  <label htmlFor="activo" className="text-sm text-gray-700">Activo (se aplica en liquidaciones)</label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={mutation.isPending} className="btn-primary">
                  {mutation.isPending ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear concepto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
