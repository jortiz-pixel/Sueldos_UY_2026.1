import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { Eye, Plus, X, AlertCircle, Pencil, Printer, Trash2, Undo2 } from 'lucide-react';
import { contractsApi, catalogsApi, companiesApi, construccionApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import { formatPesos, SalaryType, Contrato } from '../types';
import { CATEGORIAS_CONSTRUCCION, esEmpresaConstruccion } from '../constants/conceptos';

type ContratoRow = Contrato & { employee: { id: string; ci: string; nombre: string; apellido: string } };

interface ContractForm {
  personId: string;
  vigenciaDesde: string;
  fechaIngreso: string;
  fechaFin?: string;
  tipoContrato?: string;
  cargo?: string;
  categoria?: string;
  nivel?: string;
  salaryType: SalaryType;
  salarioNominalPesos: number;
  jornalPesos?: number;
  sucursal?: string;
  cuentaSueldos?: string;
  // Historia Laboral BPS
  vinculoFuncional?: string;
  fictoCategoria?: string;
  seguroSalud?: string;
  computosEspeciales?: string;
  exoneracionAporte?: string;
  horasSemanales?: number;
  observacion?: string;
}

// Abre el contrato de trabajo A PRUEBA (90 días, rescindible sin IPD) en una
// pestaña nueva, listo para imprimir.
async function imprimirContratoPrueba(employeeId: string, contractId: string) {
  try {
    const blob = await contractsApi.documento(employeeId, contractId, true);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    alert('No se pudo generar el contrato a prueba.');
  }
}

export default function ContractsPage() {
  const { isOperator } = useAuth();
  const { activeCompanyId: companyId, companies } = useCompany();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<{ employeeId: string; contractId: string; persona: string } | null>(null);
  const [formError, setFormError] = useState('');
  // Baja / egreso (dentro del modal de edición): fecha + causal (Tabla 9) + motivo.
  const [bajaFecha, setBajaFecha] = useState('');
  const [bajaCausal, setBajaCausal] = useState('');
  const [bajaMotivo, setBajaMotivo] = useState('');

  const empresaNombre = companies.find((c) => c.companyId === companyId)?.razonSocial ?? '';

  const { data: contratos, isLoading } = useQuery({
    queryKey: ['contracts-company', companyId],
    queryFn: () => contractsApi.listByCompany(companyId),
    enabled: !!companyId,
  });

  const { data: persons } = useQuery({ queryKey: ['persons-picker'], queryFn: () => contractsApi.persons() });
  // Detalle de la empresa activa (para saber si es de CONSTRUCCIÓN).
  const { data: empresaDetalle } = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => companiesApi.get(companyId),
    enabled: !!companyId,
  });
  const esConstruccion = esEmpresaConstruccion(empresaDetalle);
  const { data: vinculos } = useQuery({ queryKey: ['cat-vinculos'], queryFn: () => catalogsApi.vinculosFuncionales(), staleTime: Infinity });
  const { data: segurosSalud } = useQuery({ queryKey: ['cat-seguros-salud'], queryFn: () => catalogsApi.segurosSalud(), staleTime: Infinity });
  const { data: computos } = useQuery({ queryKey: ['cat-computos'], queryFn: () => catalogsApi.computosEspeciales(), staleTime: Infinity });
  const { data: exoneraciones } = useQuery({ queryKey: ['cat-exoneraciones'], queryFn: () => catalogsApi.exoneracionesAporte(), staleTime: Infinity });
  const { data: causales } = useQuery({ queryKey: ['cat-causales-egreso'], queryFn: () => catalogsApi.causalesEgreso(), staleTime: Infinity });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<ContractForm>({
    defaultValues: { personId: '', vigenciaDesde: '', fechaIngreso: '', salaryType: 'MENSUAL', salarioNominalPesos: 0 },
  });
  const salaryType = watch('salaryType');
  const categoriaActual = watch('categoria') ?? '';
  const recuadroEmpresa = empresaDetalle?.tipoAporte === 4 ? 'INCLUIDOS' : 'NO_INCLUIDOS';

  // Jornales del laudo: al ELEGIR una categoría se autocompleta el valor hora
  // vigente según el recuadro de la empresa (CT → incluidos en la ley; IC →
  // no incluidos). No pisa el jornal al abrir un contrato existente.
  const { data: jornalesLaudo } = useQuery({
    queryKey: ['jornales-construccion'],
    queryFn: () => construccionApi.jornales(),
    enabled: esConstruccion,
    staleTime: 5 * 60 * 1000,
  });
  const prevCategoria = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevCategoria.current;
    prevCategoria.current = categoriaActual;
    if (prev === undefined || prev === categoriaActual || !esConstruccion || !categoriaActual) return;
    const j = jornalesLaudo?.jornales.find((x) => x.categoria === categoriaActual && x.recuadro === recuadroEmpresa);
    if (!j || j.valorHora === '0') return;
    const hora = Number(j.valorHora) / 100;
    setValue('jornalPesos', hora);
    // Nominal mensual ficto para BPS: 25 jornadas de 8 horas.
    setValue('salarioNominalPesos', Math.round(hora * 200 * 100) / 100);
    setValue('salaryType', 'JORNALERO');
  }, [categoriaActual, esConstruccion, recuadroEmpresa, jornalesLaudo, setValue]);

  const resetBaja = () => { setBajaFecha(''); setBajaCausal(''); setBajaMotivo(''); };

  const openNew = () => {
    setEditing(null);
    setFormError('');
    resetBaja();
    const hoy = new Date().toISOString().slice(0, 10);
    reset({ personId: '', vigenciaDesde: hoy, fechaIngreso: hoy, fechaFin: '', salaryType: 'MENSUAL', salarioNominalPesos: 0, cargo: '', categoria: '', nivel: '', tipoContrato: '', sucursal: '', cuentaSueldos: '', observacion: '', vinculoFuncional: '12', fictoCategoria: '', seguroSalud: '', computosEspeciales: '99', exoneracionAporte: '9', horasSemanales: 44 });
    setModalOpen(true);
  };

  const openEdit = (c: ContratoRow) => {
    setEditing({ employeeId: c.employee.id, contractId: c.id, persona: `${c.employee.apellido}, ${c.employee.nombre}` });
    setFormError('');
    resetBaja();
    reset({
      personId: c.employee.id,
      vigenciaDesde: c.vigenciaDesde ? c.vigenciaDesde.slice(0, 10) : '',
      fechaIngreso: c.fechaIngreso ? c.fechaIngreso.slice(0, 10) : '',
      fechaFin: c.fechaFin ? c.fechaFin.slice(0, 10) : '',
      tipoContrato: c.tipoContrato ?? '',
      cargo: c.cargo ?? '', categoria: c.categoria ?? '', nivel: c.nivel ?? '',
      salaryType: c.salaryType,
      salarioNominalPesos: Number(c.salarioNominal) / 100,
      jornalPesos: c.jornal ? Number(c.jornal) / 100 : undefined,
      sucursal: c.sucursal ?? '', cuentaSueldos: c.cuentaSueldos ?? '', observacion: c.observacion ?? '',
      vinculoFuncional: c.vinculoFuncional != null ? String(c.vinculoFuncional) : '12',
      fictoCategoria: (c as unknown as { fictoCategoria?: number | null }).fictoCategoria != null ? String((c as unknown as { fictoCategoria?: number | null }).fictoCategoria) : '',
      seguroSalud: c.seguroSalud != null ? String(c.seguroSalud) : '',
      computosEspeciales: c.computosEspeciales != null ? String(c.computosEspeciales) : '99',
      exoneracionAporte: c.exoneracionAporte != null ? String(c.exoneracionAporte) : '9',
      horasSemanales: c.horasSemanales ?? 44,
    });
    setModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (data: ContractForm) => {
      const payload = {
        companyId,
        vigenciaDesde: data.vigenciaDesde,
        fechaIngreso: data.fechaIngreso,
        fechaFin: data.fechaFin || null, // null = quitar la fecha de egreso (cancelar baja)
        tipoContrato: data.tipoContrato || undefined,
        cargo: data.cargo || undefined,
        categoria: data.categoria || undefined,
        nivel: data.nivel || undefined,
        salaryType: data.salaryType,
        salarioNominal: String(Math.round(Number(data.salarioNominalPesos) * 100)),
        jornal: data.jornalPesos ? String(Math.round(Number(data.jornalPesos) * 100)) : undefined,
        sucursal: data.sucursal || undefined,
        cuentaSueldos: data.cuentaSueldos || undefined,
        vinculoFuncional: data.vinculoFuncional ? Number(data.vinculoFuncional) : undefined,
        fictoCategoria: data.fictoCategoria ? Number(data.fictoCategoria) : null,
        seguroSalud: data.seguroSalud ? Number(data.seguroSalud) : undefined,
        computosEspeciales: data.computosEspeciales ? Number(data.computosEspeciales) : undefined,
        exoneracionAporte: data.exoneracionAporte ? Number(data.exoneracionAporte) : undefined,
        horasSemanales: data.horasSemanales ? Number(data.horasSemanales) : undefined,
        observacion: data.observacion || undefined,
      };
      return editing
        ? contractsApi.update(editing.employeeId, editing.contractId, payload)
        : contractsApi.create(data.personId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts-company', companyId] });
      queryClient.invalidateQueries({ queryKey: ['nomina-checklist'] });
      setModalOpen(false);
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(message || 'Error al guardar el contrato.');
    },
  });

  // Dar de baja el contrato: cierra el contrato a la fecha de egreso con la
  // causal (Tabla 9) y GENERA AUTOMÁTICAMENTE la liquidación final por egreso.
  const bajaMutation = useMutation({
    mutationFn: () => contractsApi.baja(
      editing!.employeeId, editing!.contractId, bajaFecha,
      bajaMotivo || undefined, bajaCausal ? Number(bajaCausal) : undefined,
    ),
    onSuccess: (res: { liquidacionFinalId?: string | null; aviso?: string; desvinculadaTotal?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['contracts-company', companyId] });
      queryClient.invalidateQueries({ queryKey: ['nomina-checklist'] });
      queryClient.invalidateQueries({ queryKey: ['liquidations'] });
      setModalOpen(false);
      if (res?.aviso) {
        alert(res.aviso);
      } else if (res?.liquidacionFinalId) {
        alert('Baja registrada. Se generó la liquidación final por egreso (en borrador). La encontrás en Liquidaciones.');
      } else {
        alert('Baja registrada.');
      }
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(message || 'No se pudo dar de baja el contrato.');
    },
  });

  const darDeBaja = () => {
    if (!editing || !bajaFecha) return;
    const causalTxt = bajaCausal ? causales?.find((c) => String(c.codigo) === bajaCausal)?.nombre : undefined;
    const msg = `¿Dar de baja el contrato de ${editing.persona} con egreso el ${bajaFecha}`
      + (causalTxt ? ` (causal: ${causalTxt})` : '')
      + '? Se cerrará el contrato y se generará automáticamente la liquidación final por egreso.';
    if (confirm(msg)) { setFormError(''); bajaMutation.mutate(); }
  };

  const deleteMutation = useMutation({
    mutationFn: (c: ContratoRow) => contractsApi.remove(c.employee.id, c.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts-company', companyId] });
      queryClient.invalidateQueries({ queryKey: ['nomina-checklist'] });
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(message || 'No se pudo eliminar el contrato.');
    },
  });

  const reactivarMutation = useMutation({
    mutationFn: (c: ContratoRow) => contractsApi.reactivar(c.employee.id, c.id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['contracts-company', companyId] });
      queryClient.invalidateQueries({ queryKey: ['nomina-checklist'] });
      const n = res?.finalesEliminadas ?? 0;
      if (n > 0) alert(`Baja cancelada. Se eliminó ${n} liquidación final en borrador.`);
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(message || 'No se pudo cancelar la baja.');
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
                <th className="px-4 py-3 text-left">BPS (VF · SS · hs)</th>
                <th className="px-4 py-3 text-left">Vigencia</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : !contratos?.length ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Sin contratos en esta empresa</td></tr>
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
                  <td className="table-cell text-xs">
                    {c.vinculoFuncional != null || c.seguroSalud != null || c.horasSemanales != null ? (
                      <span className="figure" title={`Vínculo funcional ${c.vinculoFuncional ?? '—'} · Seguro de salud ${c.seguroSalud ?? '—'} · ${c.horasSemanales ?? '—'} hs/semana`}>
                        {c.vinculoFuncional ?? '—'} · {c.seguroSalud ?? '—'} · {c.horasSemanales ?? '—'}
                      </span>
                    ) : (
                      <span className="badge-yellow">Sin datos BPS</span>
                    )}
                  </td>
                  <td className="table-cell text-xs">{fmt(c.vigenciaDesde)} — {c.vigenciaHasta ? fmt(c.vigenciaHasta) : (c.fechaFin ? fmt(c.fechaFin) : 'Vigente')}</td>
                  <td className="table-cell">
                    {!c.vigenciaHasta && c.activo && (!c.fechaFin || new Date(c.fechaFin) >= new Date())
                      ? <span className="badge-green badge">Vigente</span>
                      : <span className="badge-gray badge">Histórico</span>}
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-1">
                      {isOperator && (
                        <button onClick={() => openEdit(c as ContratoRow)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg inline-flex" title="Editar contrato"><Pencil size={15} /></button>
                      )}
                      <button
                        onClick={() => imprimirContratoPrueba(c.employee.id, c.id)}
                        className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg inline-flex"
                        title="Imprimir contrato a prueba (90 días — rescindible sin IPD)"
                      >
                        <Printer size={15} />
                      </button>
                      <Link to={`/employees/${c.employee.id}`} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg inline-flex" title="Ver persona"><Eye size={15} /></Link>
                      {isOperator && (c.vigenciaHasta || c.fechaFin) && (
                        <button
                          onClick={() => {
                            if (confirm(`¿Cancelar la baja del contrato N° ${c.numero} de ${c.employee.apellido}, ${c.employee.nombre}? Se quitará la fecha de egreso, el contrato volverá a estar vigente y se eliminará la liquidación final en borrador (si la hubiera).`)) {
                              reactivarMutation.mutate(c as ContratoRow);
                            }
                          }}
                          disabled={reactivarMutation.isPending}
                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg inline-flex"
                          title="Cancelar baja / reactivar contrato"
                        >
                          <Undo2 size={15} />
                        </button>
                      )}
                      {isOperator && (
                        <button
                          onClick={() => {
                            if (confirm(`¿Eliminar el contrato N° ${c.numero} de ${c.employee.apellido}, ${c.employee.nombre}? Esta acción no se puede deshacer.`)) {
                              deleteMutation.mutate(c as ContratoRow);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg inline-flex"
                          title="Eliminar contrato (solo si no tiene liquidaciones)"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
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
              <h2 className="text-lg font-bold text-gray-900">{editing ? `Editar Contrato — ${editing.persona}` : `Nuevo Contrato — ${empresaNombre}`}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-700"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit((d) => { setFormError(''); saveMutation.mutate(d); })} className="p-6 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0" />{formError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {!editing && (
                  <div className="col-span-2">
                    <label className="form-label">Persona *</label>
                    <select {...register('personId', { required: 'Requerido' })} className="form-input">
                      <option value="">— Seleccionar persona —</option>
                      {persons?.map((p) => <option key={p.id} value={p.id}>{p.apellido}, {p.nombre} (CI {p.ci})</option>)}
                    </select>
                    {errors.personId && <p className="form-error">{errors.personId.message}</p>}
                  </div>
                )}
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
                  <label className="form-label">Fin de contrato</label>
                  <input {...register('fechaFin')} type="date" className="form-input" />
                  <p className="text-xs text-gray-400 mt-1">Dejá vacío si está vigente sin fecha de fin.</p>
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
                  <label className="form-label">Categoría{esConstruccion ? ' (laudo construcción)' : ''}</label>
                  {esConstruccion ? (
                    <select {...register('categoria')} className="form-input">
                      <option value="">— Seleccionar categoría —</option>
                      {categoriaActual && !CATEGORIAS_CONSTRUCCION.includes(categoriaActual) && (
                        <option value={categoriaActual}>{categoriaActual} (actual)</option>
                      )}
                      {CATEGORIAS_CONSTRUCCION.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <input {...register('categoria')} className="form-input" />
                  )}
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
                <div>
                  <label className="form-label">Cuenta de sueldos (centro de costos)</label>
                  <input {...register('cuentaSueldos')} className="form-input" placeholder="Producción, Administración, Sucursal Centro…" />
                  <p className="text-xs text-gray-400 mt-1">Separa el gasto en el asiento contable por unidad de negocio.</p>
                </div>
                <div className="col-span-2 pt-2 mt-1 border-t border-hairline">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-3">Historia Laboral — BPS</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">Vínculo funcional (Tabla 3)</label>
                      <select {...register('vinculoFuncional')} className="form-input">
                        {vinculos?.map((v) => <option key={v.codigo} value={v.codigo}>{v.codigo} — {v.nombre}</option>)}
                      </select>
                    </div>
                    {watch('vinculoFuncional') === '1' && (
                      <div>
                        <label className="form-label">Categoría de aporte del titular (sueldo ficto)</label>
                        <select {...register('fictoCategoria')} className="form-input">
                          <option value="">— Usar el sueldo del contrato —</option>
                          {[
                            [1, 11], [2, 15], [3, 20], [4, 25], [5, 30],
                            [6, 36], [7, 42], [8, 48], [9, 54], [10, 60],
                          ].map(([cat, bfc]) => (
                            <option key={cat} value={cat}>{cat}.ª — {bfc} BFC (${(bfc * 1847.96).toLocaleString('es-UY', { maximumFractionDigits: 0 })})</option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-400 mt-1">El titular unipersonal aporta sobre el ficto: 22,5% jubilatorio + FRL + cuota fija FONASA según seguro de salud.</p>
                      </div>
                    )}
                    <div>
                      <label className="form-label">Seguro de salud (Tabla 8)</label>
                      <select {...register('seguroSalud')} className="form-input">
                        <option value="">— Según hijos/cónyuge a cargo —</option>
                        {segurosSalud?.map((v) => <option key={v.codigo} value={v.codigo}>{v.codigo} — {v.nombre}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Horas semanales</label>
                      <select {...register('horasSemanales', { valueAsNumber: true })} className="form-input">
                        {[5, 10, 15, 20, 24, 25, 30, 36, 40, 44, 48].map((h) => <option key={h} value={h}>{h}</option>)}
                        <option value={99}>99 — No aplica</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Cómputos especiales (Tabla 12)</label>
                      <select {...register('computosEspeciales')} className="form-input">
                        {computos?.map((v) => <option key={v.codigo} value={v.codigo}>{v.codigo} — {v.nombre}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="form-label">Exoneración de aportes (Tabla 10)</label>
                      <select {...register('exoneracionAporte')} className="form-input">
                        {exoneraciones?.map((v) => <option key={v.codigo} value={v.codigo}>{v.codigo} — {v.nombre}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="form-label">Observación</label>
                  <input {...register('observacion')} className="form-input" />
                </div>
                {editing && (
                  <div className="col-span-2 pt-3 mt-1 border-t border-red-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-red-600 mb-1">Dar de baja (egreso)</p>
                    <p className="text-xs text-gray-500 mb-3">Cierra el contrato a la fecha de egreso con la causal BPS y genera automáticamente la liquidación final por egreso (en borrador).</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="form-label">Fecha de egreso</label>
                        <input type="date" value={bajaFecha} onChange={(e) => setBajaFecha(e.target.value)} className="form-input" />
                      </div>
                      <div>
                        <label className="form-label">Causal de egreso (Tabla 9 BPS)</label>
                        <select value={bajaCausal} onChange={(e) => setBajaCausal(e.target.value)} className="form-input">
                          <option value="">— Seleccionar causal —</option>
                          {causales?.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="form-label">Motivo (opcional)</label>
                        <input value={bajaMotivo} onChange={(e) => setBajaMotivo(e.target.value)} className="form-input" placeholder="Detalle interno de la baja" />
                      </div>
                      <div className="col-span-2">
                        <button
                          type="button"
                          disabled={!bajaFecha || bajaMutation.isPending}
                          onClick={darDeBaja}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                        >
                          {bajaMutation.isPending ? 'Procesando…' : 'Dar de baja y generar liquidación final'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
                  {saveMutation.isPending ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear contrato'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
