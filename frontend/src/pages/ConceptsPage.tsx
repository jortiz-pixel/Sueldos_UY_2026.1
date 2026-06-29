import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Calculator, Pencil, Trash2, X, AlertCircle } from 'lucide-react';
import { conceptsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import { Concepto, ItemType, formatPesos } from '../types';

interface ConceptoForm {
  codigo: string;
  nombre: string;
  orden: number;
  tipoOperacion: ItemType;
  tipoCalculo: 'VALOR_FIJO' | 'PORCENTAJE' | 'CANTIDAD_VALOR';
  baseCalculo: string;
  valorRate: number;
  valorFijoPesos: number;
  gravado: boolean;
  activo: boolean;
}

const emptyForm: ConceptoForm = {
  codigo: '', nombre: '', orden: 100, tipoOperacion: 'HABER',
  tipoCalculo: 'VALOR_FIJO', baseCalculo: 'NOMINAL', valorRate: 0,
  valorFijoPesos: 0, gravado: true, activo: true,
};

const OP_LABEL: Record<string, string> = {
  HABER: 'Haber', DESCUENTO_OBRERO: 'Descuento', APORTE_PATRONAL: 'Aporte patronal', INFORMATIVO: 'Informativo',
};

// Conceptos núcleo (legales) que calcula el motor. Informativos / no editables.
const CONCEPTOS_SISTEMA: { nombre: string; tipo: string; calculo: string; gravado: string }[] = [
  { nombre: 'Sueldo básico', tipo: 'HABER', calculo: 'Nominal del mes (prorrateado por días)', gravado: 'Sí' },
  { nombre: 'Jornal', tipo: 'HABER', calculo: 'Valor jornal × días trabajados', gravado: 'Sí' },
  { nombre: 'Horas extra diurnas', tipo: 'HABER', calculo: 'Valor hora × 2 (+100%)', gravado: 'Sí' },
  { nombre: 'Horas extra / recargo nocturno', tipo: 'HABER', calculo: 'Valor hora + 20% nocturno', gravado: 'Sí' },
  { nombre: 'Feriado pago', tipo: 'HABER', calculo: 'Valor jornal', gravado: 'Sí' },
  { nombre: 'Aguinaldo', tipo: 'HABER', calculo: '1/12 de los haberes del semestre (confirmados)', gravado: 'Sí' },
  { nombre: 'Salario de licencia', tipo: 'HABER', calculo: 'Promedio 12 meses / 30 × días', gravado: 'Sí' },
  { nombre: 'Salario vacacional', tipo: 'HABER', calculo: 'Jornal líquido × días', gravado: 'No (exento CESS)' },
  { nombre: 'BPS Jubilatorio', tipo: 'DESCUENTO_OBRERO', calculo: '15% sobre el gravado', gravado: '—' },
  { nombre: 'FONASA', tipo: 'DESCUENTO_OBRERO', calculo: '3%–8% según ingreso y cargas', gravado: '—' },
  { nombre: 'FRL', tipo: 'DESCUENTO_OBRERO', calculo: '0,10% sobre el gravado', gravado: '—' },
  { nombre: 'IRPF (Categoría II)', tipo: 'DESCUENTO_OBRERO', calculo: 'Escala anual proyectada − deducciones', gravado: '—' },
  { nombre: 'BPS IVS Patronal', tipo: 'APORTE_PATRONAL', calculo: '7,5% sobre el gravado', gravado: '—' },
  { nombre: 'FONASA Patronal', tipo: 'APORTE_PATRONAL', calculo: '5% sobre el gravado', gravado: '—' },
  { nombre: 'FRL Patronal', tipo: 'APORTE_PATRONAL', calculo: '0,10% sobre el gravado', gravado: '—' },
  { nombre: 'FGCL Patronal', tipo: 'APORTE_PATRONAL', calculo: '0,025% sobre el gravado', gravado: '—' },
];

export default function ConceptsPage() {
  const { isOperator } = useAuth();
  const { activeCompanyId: companyId } = useCompany();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Concepto | null>(null);
  const [formError, setFormError] = useState('');

  const { data: conceptos, isLoading } = useQuery({
    queryKey: ['concepts', companyId],
    queryFn: () => conceptsApi.list(companyId),
    enabled: !!companyId,
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ConceptoForm>({ defaultValues: emptyForm });
  const tipoCalculo = watch('tipoCalculo');

  const openCreate = () => { setEditing(null); setFormError(''); reset(emptyForm); setModalOpen(true); };
  const openEdit = (c: Concepto) => {
    setEditing(c);
    setFormError('');
    reset({
      codigo: c.codigo, nombre: c.nombre, orden: c.orden,
      tipoOperacion: c.tipoOperacion, tipoCalculo: c.tipoCalculo,
      baseCalculo: c.baseCalculo ?? 'NOMINAL', valorRate: c.valorRate ?? 0,
      valorFijoPesos: c.valorFijo ? Number(c.valorFijo) / 100 : 0,
      gravado: c.gravado, activo: c.activo,
    });
    setModalOpen(true);
  };

  const mutation = useMutation({
    mutationFn: (data: ConceptoForm) => {
      const payload = {
        companyId,
        codigo: data.codigo,
        nombre: data.nombre,
        orden: Number(data.orden),
        tipoOperacion: data.tipoOperacion,
        tipoCalculo: data.tipoCalculo,
        baseCalculo: data.tipoCalculo === 'PORCENTAJE' ? data.baseCalculo : null,
        valorRate: data.tipoCalculo === 'PORCENTAJE' ? Number(data.valorRate) : null,
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => conceptsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['concepts', companyId] }),
  });

  const resumenCalculo = (c: Concepto) => {
    if (c.tipoCalculo === 'PORCENTAJE') return `${(c.valorRate ?? 0) / 100}% sobre ${c.baseCalculo}`;
    if (c.tipoCalculo === 'VALOR_FIJO') return `${c.valorFijo ? formatPesos(c.valorFijo) : '$0'} fijo`;
    return `${c.valorFijo ? formatPesos(c.valorFijo) : '$0'} × cantidad`;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conceptos</h1>
          <p className="text-gray-500 text-sm mt-0.5">Motor de conceptos parametrizables · {conceptos?.length ?? '—'} definidos</p>
        </div>
        {isOperator && (
          <button onClick={openCreate} className="btn-primary" disabled={!companyId}>
            <Plus size={16} />
            Nuevo Concepto
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">Orden</th>
                <th className="px-4 py-3 text-left">Código</th>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Cálculo</th>
                <th className="px-4 py-3 text-left">Gravado</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : !conceptos?.length ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Sin conceptos definidos</td></tr>
              ) : conceptos.map((c: Concepto) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="table-cell font-mono text-xs">{c.orden}</td>
                  <td className="table-cell font-mono text-xs font-bold">{c.codigo}</td>
                  <td className="table-cell text-sm">{c.nombre}</td>
                  <td className="table-cell">
                    <span className={`badge ${c.tipoOperacion === 'HABER' ? 'badge-green' : c.tipoOperacion === 'DESCUENTO_OBRERO' ? 'badge-red' : 'badge-gray'}`}>
                      {OP_LABEL[c.tipoOperacion]}
                    </span>
                  </td>
                  <td className="table-cell text-xs text-gray-600">{resumenCalculo(c)}</td>
                  <td className="table-cell text-xs">{c.gravado ? 'Sí' : 'No'}</td>
                  <td className="table-cell">
                    <button
                      onClick={() => isOperator && toggleActivo.mutate(c)}
                      className={`badge ${c.activo ? 'badge-green' : 'badge-gray'} ${isOperator ? 'cursor-pointer' : ''}`}
                      title={isOperator ? 'Click para activar/desactivar' : ''}
                    >
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="table-cell">
                    {isOperator && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(c)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Editar"><Pencil size={15} /></button>
                        <button onClick={() => { if (confirm(`¿Eliminar el concepto ${c.codigo}?`)) deleteMutation.mutate(c.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Eliminar"><Trash2 size={15} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <Calculator size={15} className="text-[#003DA5]" /> Conceptos del sistema (núcleo legal)
        </h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="px-4 py-3 text-left">Concepto</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Cálculo</th>
                  <th className="px-4 py-3 text-left">Gravado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {CONCEPTOS_SISTEMA.map((c) => (
                  <tr key={c.nombre} className="hover:bg-gray-50">
                    <td className="table-cell text-sm font-medium text-gray-800">{c.nombre}</td>
                    <td className="table-cell">
                      <span className={`badge ${c.tipo === 'HABER' ? 'badge-green' : c.tipo === 'DESCUENTO_OBRERO' ? 'badge-red' : 'badge-gray'}`}>{OP_LABEL[c.tipo]}</span>
                    </td>
                    <td className="table-cell text-xs text-gray-600">{c.calculo}</td>
                    <td className="table-cell text-xs">{c.gravado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1">Calculados automáticamente por el motor según la normativa vigente. No se editan desde acá.</p>
      </div>

      <div className="card p-4 bg-blue-50/40 border-blue-100">
        <div className="flex items-start gap-2 text-xs text-gray-600">
          <Calculator size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p>
            Los conceptos <b>activos</b> se aplican automáticamente en cada liquidación mensual, en su orden. Un haber
            <b> gravado</b> suma a la base de aportes (BPS/FONASA/IRPF); uno no gravado no. Los aportes legales núcleo
            (BPS, FONASA, FRL, IRPF) se calculan siempre por el motor y no dependen de estos conceptos.
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
                  </select>
                </div>
                {tipoCalculo === 'PORCENTAJE' ? (
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
                      <label className="form-label">Tasa (basis points, 500 = 5%)</label>
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
