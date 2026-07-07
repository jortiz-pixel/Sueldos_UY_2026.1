import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Calendar, User, DollarSign, FileText, Briefcase, Plus, X, AlertCircle, UserMinus, Pencil, FileDown, Printer } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { employeesApi, contractsApi, companiesApi, catalogsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import AttachmentsPanel from '../components/AttachmentsPanel';
import { formatPesos, MESES, Contrato, SalaryType } from '../types';
import { CATEGORIAS_CONSTRUCCION, TIPO_APORTE_CONSTRUCCION } from '../constants/conceptos';

function Field({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-800">{String(value)}</p>
    </div>
  );
}

interface ContractForm {
  companyId: string;
  vigenciaDesde: string;
  fechaIngreso: string;
  tipoContrato?: string;
  cargo?: string;
  sector?: string;
  categoria?: string;
  nivel?: string;
  salaryType: SalaryType;
  salarioNominalPesos: number;
  jornalPesos?: number;
  horasDia?: number;
  regimenHorario?: string;
  sucursal?: string;
  cuentaSueldos?: string;
  // Historia Laboral BPS
  vinculoFuncional?: string;
  seguroSalud?: string;
  computosEspeciales?: string;
  exoneracionAporte?: string;
  horasSemanales?: number;
  observacion?: string;
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isOperator } = useAuth();
  const { activeCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contrato | null>(null);
  const [formError, setFormError] = useState('');
  // Modal de baja: contrato a dar de baja + fecha de egreso + causal (Tabla 9) + motivo.
  const [bajaContract, setBajaContract] = useState<Contrato | null>(null);
  const [bajaFecha, setBajaFecha] = useState('');
  const [bajaCausal, setBajaCausal] = useState('');
  const [bajaMotivo, setBajaMotivo] = useState('');

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeesApi.get(id!),
    enabled: !!id,
  });

  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() });
  const { data: vinculos } = useQuery({ queryKey: ['cat-vinculos'], queryFn: () => catalogsApi.vinculosFuncionales(), staleTime: Infinity });
  const { data: segurosSalud } = useQuery({ queryKey: ['cat-seguros-salud'], queryFn: () => catalogsApi.segurosSalud(), staleTime: Infinity });
  const { data: computos } = useQuery({ queryKey: ['cat-computos'], queryFn: () => catalogsApi.computosEspeciales(), staleTime: Infinity });
  const { data: exoneraciones } = useQuery({ queryKey: ['cat-exoneraciones'], queryFn: () => catalogsApi.exoneracionesAporte(), staleTime: Infinity });
  const { data: causales } = useQuery({ queryKey: ['cat-causales-egreso'], queryFn: () => catalogsApi.causalesEgreso(), staleTime: Infinity });

  const { data: contratos } = useQuery({
    queryKey: ['employee-contracts', id],
    queryFn: () => contractsApi.list(id!),
    enabled: !!id,
  });

  const { data: liquidations } = useQuery({
    queryKey: ['employee-liquidations', id],
    queryFn: () => employeesApi.liquidations(id!),
    enabled: !!id,
  });

  const { data: vacation } = useQuery({
    queryKey: ['employee-vacation', id],
    queryFn: () => employeesApi.vacation(id!),
    enabled: !!id,
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<ContractForm>({
    defaultValues: { companyId: '', vigenciaDesde: '', fechaIngreso: '', salaryType: 'MENSUAL', salarioNominalPesos: 0 },
  });
  const salaryType = watch('salaryType');
  // Empresa elegida en el form: si es de CONSTRUCCIÓN se sugieren las categorías del laudo.
  const formCompanyId = watch('companyId');
  const esConstruccion = companies?.find((co) => co.id === formCompanyId)?.tipoAporte === TIPO_APORTE_CONSTRUCCION;
  const categoriaActual = watch('categoria') ?? '';

  const createMutation = useMutation({
    mutationFn: (data: ContractForm) => {
      const payload = {
        companyId: data.companyId,
        vigenciaDesde: data.vigenciaDesde,
        fechaIngreso: data.fechaIngreso,
        tipoContrato: data.tipoContrato || undefined,
        cargo: data.cargo || undefined,
        sector: data.sector || undefined,
        categoria: data.categoria || undefined,
        nivel: data.nivel || undefined,
        salaryType: data.salaryType,
        salarioNominal: String(Math.round(Number(data.salarioNominalPesos) * 100)),
        jornal: data.jornalPesos ? String(Math.round(Number(data.jornalPesos) * 100)) : undefined,
        horasDia: data.horasDia ? Number(data.horasDia) : undefined,
        regimenHorario: data.regimenHorario || undefined,
        sucursal: data.sucursal || undefined,
        cuentaSueldos: data.cuentaSueldos || undefined,
        vinculoFuncional: data.vinculoFuncional ? Number(data.vinculoFuncional) : undefined,
        seguroSalud: data.seguroSalud ? Number(data.seguroSalud) : undefined,
        computosEspeciales: data.computosEspeciales ? Number(data.computosEspeciales) : undefined,
        exoneracionAporte: data.exoneracionAporte ? Number(data.exoneracionAporte) : undefined,
        horasSemanales: data.horasSemanales ? Number(data.horasSemanales) : undefined,
        observacion: data.observacion || undefined,
      };
      return editingContract
        ? contractsApi.update(id!, editingContract.id, payload)
        : contractsApi.create(id!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-contracts', id] });
      queryClient.invalidateQueries({ queryKey: ['employee', id] });
      queryClient.invalidateQueries({ queryKey: ['nomina-checklist'] });
      setModalOpen(false);
      setEditingContract(null);
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setFormError(message || 'Error al guardar el contrato.');
    },
  });

  const bajaMutation = useMutation({
    mutationFn: ({ contractId, fechaEgreso, motivo, causalEgresoCod }: { contractId: string; fechaEgreso: string; motivo?: string; causalEgresoCod?: number }) =>
      contractsApi.baja(id!, contractId, fechaEgreso, motivo, causalEgresoCod),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employee-contracts', id] });
      queryClient.invalidateQueries({ queryKey: ['employee', id] });
      queryClient.invalidateQueries({ queryKey: ['employee-liquidations', id] });
      if (data?.aviso) {
        alert(data.aviso);
      } else if (data?.liquidacionFinalId) {
        alert(
          'Baja registrada. Se generó la liquidación final (egreso) en estado BORRADOR — revisala en Liquidaciones.'
          + (data.desvinculadaTotal ? '\nLa persona quedó inactiva (sin contratos vigentes en ninguna empresa).' : ''),
        );
      }
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(message || 'No se pudo dar de baja el contrato');
    },
  });

  const imprimirContratoPrueba = async (c: Contrato) => {
    try {
      const blob = await contractsApi.documento(id!, c.id, true);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      alert('No se pudo generar el contrato a prueba.');
    }
  };

  const descargarContrato = async (c: Contrato) => {
    try {
      const blob = await contractsApi.documento(id!, c.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Contrato - ${employee?.nombre ?? ''} ${employee?.apellido ?? ''}.pdf`.replace(/\s+/g, ' ');
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('No se pudo generar el contrato en PDF.');
    }
  };

  const openEditContract = (c: Contrato) => {
    setEditingContract(c);
    setFormError('');
    reset({
      companyId: c.companyId ?? '',
      vigenciaDesde: c.vigenciaDesde ? c.vigenciaDesde.slice(0, 10) : '',
      fechaIngreso: c.fechaIngreso ? c.fechaIngreso.slice(0, 10) : '',
      tipoContrato: c.tipoContrato ?? '',
      cargo: c.cargo ?? '',
      sector: c.sector ?? '',
      categoria: c.categoria ?? '',
      nivel: c.nivel ?? '',
      salaryType: c.salaryType,
      salarioNominalPesos: Number(c.salarioNominal) / 100,
      jornalPesos: c.jornal ? Number(c.jornal) / 100 : undefined,
      horasDia: c.horasDia ?? undefined,
      regimenHorario: c.regimenHorario ?? '',
      sucursal: c.sucursal ?? '',
      cuentaSueldos: c.cuentaSueldos ?? '',
      vinculoFuncional: c.vinculoFuncional != null ? String(c.vinculoFuncional) : '12',
      seguroSalud: c.seguroSalud != null ? String(c.seguroSalud) : '',
      computosEspeciales: c.computosEspeciales != null ? String(c.computosEspeciales) : '99',
      exoneracionAporte: c.exoneracionAporte != null ? String(c.exoneracionAporte) : '9',
      horasSemanales: c.horasSemanales ?? 44,
      observacion: c.observacion ?? '',
    });
    setModalOpen(true);
  };

  const handleBaja = (c: Contrato) => {
    setBajaContract(c);
    setBajaFecha(new Date().toISOString().slice(0, 10));
    setBajaCausal('');
    setBajaMotivo('');
  };

  const confirmarBaja = () => {
    if (!bajaContract) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bajaFecha)) { alert('Indicá la fecha de egreso.'); return; }
    if (!bajaCausal) { alert('Seleccioná la causal de egreso.'); return; }
    bajaMutation.mutate(
      {
        contractId: bajaContract.id,
        fechaEgreso: bajaFecha,
        causalEgresoCod: Number(bajaCausal),
        motivo: bajaMotivo.trim() || undefined,
      },
      { onSuccess: () => setBajaContract(null) },
    );
  };

  const openNew = () => {
    setEditingContract(null);
    setFormError('');
    const hoy = new Date().toISOString().slice(0, 10);
    reset({
      companyId: employee?.companyId ?? user?.companyId ?? companies?.[0]?.id ?? '',
      vigenciaDesde: hoy,
      fechaIngreso: employee?.fechaIngreso ? employee.fechaIngreso.slice(0, 10) : hoy,
      salaryType: employee?.salaryType ?? 'MENSUAL',
      cargo: employee?.cargo ?? '',
      categoria: employee?.categoria ?? '',
      nivel: employee?.nivel ?? '',
      salarioNominalPesos: employee ? Number(employee.salarioNominal) / 100 : 0,
      jornalPesos: employee?.jornal ? Number(employee.jornal) / 100 : undefined,
      vinculoFuncional: '12',
      seguroSalud: '',
      computosEspeciales: '99',
      exoneracionAporte: '9',
      horasSemanales: 44,
    });
    setModalOpen(true);
  };

  if (isLoading) return <div className="text-center py-12 text-gray-400">Cargando...</div>;
  if (!employee) return <div className="text-center py-12 text-gray-400">Empleado no encontrado</div>;

  const antiguedad = employee.antiguedadAnios ?? 0;
  const fmtFecha = (s?: string | null) => s ? new Date(s).toLocaleDateString('es-UY') : 'Vigente';
  const nombreEmpresa = (cid?: string | null) => companies?.find((c) => c.id === cid)?.razonSocial ?? '—';

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/employees" className="btn-secondary btn-sm">
          <ArrowLeft size={14} />
          Volver
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{employee.apellido}, {employee.nombre}</h1>
          <p className="text-gray-500 text-sm">CI: {employee.ci} · {employee.cargo || 'Sin cargo'}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link to={`/employees/${employee.id}/edit`} className="btn-secondary btn-sm">Editar persona</Link>
          {employee.active
            ? <span className="badge-green badge">Activo</span>
            : <span className="badge-red badge">Inactivo</span>
          }
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card p-5 lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
            <User size={16} />
            Datos Personales
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre completo" value={[employee.nombre, employee.nombre2, employee.apellido, employee.apellido2].filter(Boolean).join(' ')} />
            <Field label="Cédula de Identidad" value={employee.ci} />
            <Field label="Estado civil" value={employee.estadoCivil} />
            <Field label="Email" value={employee.email} />
            <Field label="Teléfono" value={employee.telefono} />
            <Field label="Domicilio" value={employee.domicilio} />
            <Field label="Fecha de ingreso" value={new Date(employee.fechaIngreso).toLocaleDateString('es-UY')} />
            <Field label="Antigüedad" value={`${antiguedad} año(s)`} />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
              <DollarSign size={16} />
              Situación Salarial (contrato vigente)
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tipo de salario" value={employee.salaryType === 'MENSUAL' ? 'Mensual' : 'Jornalero'} />
              <Field label="Salario nominal" value={formatPesos(employee.salarioNominal)} />
              {employee.jornal && <Field label="Jornal diario" value={formatPesos(employee.jornal)} />}
              <Field label="Método IRPF" value={employee.irpfMetodo} />
              <Field label="Cónyuge a cargo" value={employee.conyugeACargo ? 'Sí' : 'No'} />
              <Field label="Hijos a cargo" value={employee.hijosACargo} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <AttachmentsPanel companyId={activeCompanyId} ownerType="PERSONA" ownerId={employee.id} />

          <div className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-4">
              <Calendar size={16} />
              Licencia {employee.diasLicenciaCorresponden ?? 20} días
            </div>
            {Array.isArray(vacation) && vacation.length > 0 ? (
              vacation.slice(0, 3).map((acc: { year: number; diasCorresponden: number; diasTomados: number; diasPendientes: number }) => (
                <div key={acc.year} className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{acc.year}</span>
                    <span>{acc.diasTomados}/{acc.diasCorresponden} días tomados</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-blue-500 rounded-full h-2 transition-all"
                      style={{ width: `${(acc.diasTomados / acc.diasCorresponden) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 text-right">{acc.diasPendientes} pendientes</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-gray-400">Sin datos de licencia</p>
            )}
          </div>
        </div>
      </div>

      {/* Contratos */}
      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Briefcase size={16} />
            Contratos (vínculo con empresas)
          </div>
          {isOperator && (
            <button onClick={openNew} className="btn-primary btn-sm">
              <Plus size={14} />
              Nuevo Contrato
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">N°</th>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-left">Vigencia</th>
                <th className="px-4 py-3 text-left">Cargo</th>
                <th className="px-4 py-3 text-right">Salario / Jornal</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {!contratos?.length ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">Sin contratos</td></tr>
              ) : contratos.map((c: Contrato) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="table-cell font-mono text-xs">{c.numero}</td>
                  <td className="table-cell text-xs">{nombreEmpresa(c.companyId)}</td>
                  <td className="table-cell text-xs">
                    {fmtFecha(c.vigenciaDesde)} — {c.vigenciaHasta ? fmtFecha(c.vigenciaHasta) : 'Vigente'}
                  </td>
                  <td className="table-cell text-xs">
                    {c.cargo || '-'}
                    {c.vinculoFuncional != null && (
                      <span className="block text-[10px] text-ink-subtle">
                        BPS: VF {c.vinculoFuncional} · SS {c.seguroSalud ?? '—'} · {c.horasSemanales ?? '—'} hs/sem
                      </span>
                    )}
                  </td>
                  <td className="table-cell text-right font-mono text-xs">
                    {c.salaryType === 'MENSUAL' ? formatPesos(c.salarioNominal) : (c.jornal ? `${formatPesos(c.jornal)}/día` : formatPesos(c.salarioNominal))}
                  </td>
                  <td className="table-cell">
                    {!c.vigenciaHasta && c.activo
                      ? <span className="badge-green badge">Vigente</span>
                      : <span className="badge-gray badge">Histórico</span>}
                  </td>
                  <td className="table-cell text-right">
                    <button
                      onClick={() => descargarContrato(c)}
                      className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded-lg mr-1"
                      title="Generar el contrato de trabajo en PDF (para firmar)"
                    >
                      <FileDown size={13} /> Contrato PDF
                    </button>
                    <button
                      onClick={() => imprimirContratoPrueba(c)}
                      className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded-lg mr-1"
                      title="Imprimir contrato a prueba (90 días — rescindible sin IPD)"
                    >
                      <Printer size={13} /> A prueba
                    </button>
                    {isOperator && (
                      <button
                        onClick={() => openEditContract(c)}
                        className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded-lg mr-1"
                        title="Editar contrato (datos laborales e Historia Laboral BPS)"
                      >
                        <Pencil size={13} /> Editar
                      </button>
                    )}
                    {isOperator && !c.vigenciaHasta && c.activo && (
                      <button
                        onClick={() => handleBaja(c)}
                        className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg"
                        title="Dar de baja (cerrar el contrato con fecha de egreso)"
                      >
                        <UserMinus size={14} /> Dar de baja
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Liquidaciones recientes */}
      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <FileText size={16} />
            Liquidaciones Recientes
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">Período</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-right">Haberes</th>
                <th className="px-4 py-3 text-right">Descuentos</th>
                <th className="px-4 py-3 text-right">Líquido</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {!liquidations?.length ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">Sin liquidaciones</td></tr>
              ) : (
                liquidations.slice(0, 12).map((liq) => (
                  <tr key={liq.id} className="hover:bg-gray-50">
                    <td className="table-cell font-medium">{MESES[liq.month]} {liq.year}</td>
                    <td className="table-cell text-xs">{liq.type}</td>
                    <td className="table-cell">
                      <span className={`badge ${liq.status === 'CONFIRMADO' ? 'badge-green' : liq.status === 'BORRADOR' ? 'badge-yellow' : 'badge-red'}`}>
                        {liq.status}
                      </span>
                    </td>
                    <td className="table-cell text-right font-mono text-xs">{formatPesos(liq.totalHaberes)}</td>
                    <td className="table-cell text-right font-mono text-xs text-red-600">({formatPesos(liq.totalDescuentos)})</td>
                    <td className="table-cell text-right font-mono text-xs font-bold text-green-700">{formatPesos(liq.liquidoPercibir)}</td>
                    <td className="table-cell">
                      <Link to={`/liquidation/${liq.id}`} className="text-blue-600 hover:underline text-xs">Ver</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal nuevo contrato */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-gray-900">{editingContract ? `Editar contrato Nº ${editingContract.numero}` : 'Nuevo Contrato'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-700"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit((d) => { setFormError(''); createMutation.mutate(d); })} className="p-6 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  {formError}
                </div>
              )}
              <p className="text-xs text-gray-500">
                El contrato vincula a la persona con una empresa. Al crear uno nuevo en la misma empresa, el anterior queda como histórico.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="form-label">Empresa *</label>
                  <select {...register('companyId', { required: 'Requerido' })} className="form-input">
                    <option value="">— Seleccionar empresa —</option>
                    {companies?.map((co) => <option key={co.id} value={co.id}>{co.razonSocial}</option>)}
                  </select>
                  {errors.companyId && <p className="form-error">{errors.companyId.message}</p>}
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
                  <input {...register('cuentaSueldos')} className="form-input" placeholder="Producción, Administración…" />
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
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                  {createMutation.isPending ? 'Guardando...' : editingContract ? 'Guardar cambios' : 'Crear contrato'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de baja: fecha de egreso + causal (BPS Tabla 9) + motivo */}
      {bajaContract && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Dar de baja — {employee?.nombre} {employee?.apellido}</h2>
              <button onClick={() => setBajaContract(null)} className="p-1 text-gray-400 hover:text-gray-700"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                Cierra el contrato a la fecha de egreso y genera la liquidación final (egreso) en BORRADOR.
              </div>
              <div>
                <label className="form-label">Fecha de egreso *</label>
                <input type="date" value={bajaFecha} onChange={(e) => setBajaFecha(e.target.value)} className="form-input" />
              </div>
              <div>
                <label className="form-label">Causal de egreso (BPS Tabla 9) *</label>
                <select value={bajaCausal} onChange={(e) => setBajaCausal(e.target.value)} className="form-input">
                  <option value="">— Seleccionar causal —</option>
                  {causales?.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Motivo (opcional)</label>
                <input value={bajaMotivo} onChange={(e) => setBajaMotivo(e.target.value)} className="form-input" placeholder="Detalle interno" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button type="button" onClick={() => setBajaContract(null)} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={confirmarBaja} disabled={bajaMutation.isPending} className="btn-danger">
                {bajaMutation.isPending ? 'Procesando...' : 'Dar de baja'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
