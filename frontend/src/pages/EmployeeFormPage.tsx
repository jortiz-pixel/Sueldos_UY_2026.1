import { useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { employeesApi, companiesApi, catalogsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import AttachmentsPanel from '../components/AttachmentsPanel';
import PersonPhoto from '../components/PersonPhoto';
import { SalaryType, EstadoCivil, formatCedula, validarCedula } from '../types';

interface EmployeeForm {
  ci: string;
  employeeNumber?: number | string;
  nombre: string;
  nombre2?: string;
  apellido: string;
  apellido2?: string;
  fechaNacimiento?: string;
  sexo?: '' | 'M' | 'F';
  nacionalidad?: number | string;
  estadoCivil: EstadoCivil;
  email?: string;
  telefono?: string;
  domicilio?: string;
  conyugeACargo: boolean;
  hijosACargo: number;
  hijosDiscapacitados: number;
  irpfMetodo: 'PROYECCION' | 'SIMPLIFICADO';
  fonasaFamilia: boolean;
  observaciones?: string;
  // Contrato (solo alta)
  companyId: string;
  fechaIngreso: string;
  cargo?: string;
  categoria?: string;
  nivel?: string;
  salaryType: SalaryType;
  salarioNominalPesos: number;
  jornalPesos?: number;
  // Historia Laboral BPS (primer contrato)
  vinculoFuncional?: string;
  seguroSalud?: string;
  horasSemanales?: number;
}

const emptyForm: EmployeeForm = {
  ci: '', nombre: '', nombre2: '', apellido: '', apellido2: '', fechaNacimiento: '', sexo: '', nacionalidad: 1, estadoCivil: 'SOLTERO',
  email: '', telefono: '', domicilio: '',
  conyugeACargo: false, hijosACargo: 0, hijosDiscapacitados: 0,
  irpfMetodo: 'PROYECCION', fonasaFamilia: false, observaciones: '',
  companyId: '', fechaIngreso: '', cargo: '', categoria: '', nivel: '',
  salaryType: 'MENSUAL', salarioNominalPesos: 0, jornalPesos: 0,
  vinculoFuncional: '12', seguroSalud: '', horasSemanales: 44,
};

export default function EmployeeFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id && id !== 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeCompanyId } = useCompany();

  const { data: companies } = useQuery({ queryKey: ['companies'], queryFn: () => companiesApi.list() });
  const { data: vinculos } = useQuery({ queryKey: ['cat-vinculos'], queryFn: () => catalogsApi.vinculosFuncionales(), staleTime: Infinity });
  const { data: segurosSalud } = useQuery({ queryKey: ['cat-seguros-salud'], queryFn: () => catalogsApi.segurosSalud(), staleTime: Infinity });

  const { data: employee } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeesApi.get(id!),
    enabled: isEdit,
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<EmployeeForm>({ defaultValues: emptyForm });
  const salaryType = watch('salaryType');
  const ciValue = watch('ci');

  useEffect(() => {
    if (!isEdit && companies && companies.length > 0) {
      reset((prev) => ({ ...prev, companyId: user?.companyId ?? companies[0].id }));
    }
  }, [companies, isEdit, user, reset]);

  useEffect(() => {
    if (employee) {
      reset({
        ...emptyForm,
        ci: employee.ci, employeeNumber: employee.employeeNumber ?? '', nombre: employee.nombre, apellido: employee.apellido,
        nombre2: employee.nombre2 ?? '', apellido2: employee.apellido2 ?? '',
        fechaNacimiento: employee.fechaNacimiento ? employee.fechaNacimiento.slice(0, 10) : '',
        sexo: employee.sexo ?? '', nacionalidad: employee.nacionalidad ?? 1,
        estadoCivil: employee.estadoCivil,
        email: employee.email ?? '', telefono: employee.telefono ?? '', domicilio: employee.domicilio ?? '',
        conyugeACargo: employee.conyugeACargo, hijosACargo: employee.hijosACargo,
        hijosDiscapacitados: employee.hijosDiscapacitados,
        irpfMetodo: employee.irpfMetodo, fonasaFamilia: employee.fonasaFamilia,
        observaciones: employee.observaciones ?? '',
      });
    }
  }, [employee, reset]);

  const mutation = useMutation({
    mutationFn: (data: EmployeeForm) => {
      const persona = {
        ci: data.ci,
        employeeNumber: data.employeeNumber !== '' && data.employeeNumber != null ? Number(data.employeeNumber) : undefined,
        nombre: data.nombre, apellido: data.apellido,
        nombre2: data.nombre2 || null, apellido2: data.apellido2 || null,
        fechaNacimiento: data.fechaNacimiento ? new Date(data.fechaNacimiento).toISOString() : undefined,
        sexo: data.sexo || null,
        nacionalidad: data.nacionalidad ? Number(data.nacionalidad) : undefined,
        estadoCivil: data.estadoCivil,
        email: data.email || undefined, telefono: data.telefono || undefined, domicilio: data.domicilio || undefined,
        conyugeACargo: data.conyugeACargo, hijosACargo: Number(data.hijosACargo),
        hijosDiscapacitados: Number(data.hijosDiscapacitados),
        irpfMetodo: data.irpfMetodo, fonasaFamilia: data.fonasaFamilia,
        observaciones: data.observaciones || undefined,
      };
      if (isEdit) {
        return employeesApi.update(id!, persona);
      }
      return employeesApi.create({
        ...persona,
        contrato: {
          companyId: data.companyId,
          fechaIngreso: new Date(data.fechaIngreso).toISOString(),
          cargo: data.cargo || undefined,
          categoria: data.categoria || undefined,
          nivel: data.nivel || undefined,
          salaryType: data.salaryType,
          salarioNominal: String(Math.round(Number(data.salarioNominalPesos) * 100)),
          jornal: data.salaryType === 'JORNALERO' && data.jornalPesos
            ? String(Math.round(Number(data.jornalPesos) * 100)) : undefined,
          vinculoFuncional: data.vinculoFuncional ? Number(data.vinculoFuncional) : undefined,
          seguroSalud: data.seguroSalud ? Number(data.seguroSalud) : undefined,
          horasSemanales: data.horasSemanales ? Number(data.horasSemanales) : undefined,
        },
      });
    },
    onSuccess: (emp) => {
      // Invalidar también la ficha individual: con staleTime global de 5 min,
      // si solo se invalida la lista, la ficha muestra datos viejos y parece
      // que la edición no se guardó.
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['employee'] });
      queryClient.invalidateQueries({ queryKey: ['nomina-checklist'] });
      navigate(`/employees/${(emp as { id: string }).id}`);
    },
  });

  const errorMsg = (mutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error;

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/employees" className="btn-secondary btn-sm"><ArrowLeft size={14} />Volver</Link>
        <h1 className="text-xl font-bold text-gray-900">{isEdit ? 'Editar Persona' : 'Nueva Persona + Contrato'}</h1>
      </div>

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="card p-6 space-y-6">
        {mutation.isError && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle size={16} className="flex-shrink-0" />
            {errorMsg || 'Error al guardar. Verifique los datos.'}
          </div>
        )}

        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Datos personales</h3>
          <div className="flex flex-col md:flex-row gap-6">
            <div className="grid grid-cols-2 gap-4 flex-1">
            <div>
              <label className="form-label">Legajo / N° de empleado</label>
              <input
                {...register('employeeNumber')}
                type="number"
                min="1"
                className="form-input"
                placeholder="Automático"
              />
              <p className="text-xs text-gray-400 mt-1">Único por empresa. Vacío = se asigna solo.</p>
            </div>
            <div>
              <label className="form-label">Cédula de Identidad *</label>
              <input
                {...register('ci', {
                  required: 'Requerido',
                  validate: (v) => validarCedula(v) || 'Cédula inválida — verificá el dígito verificador',
                })}
                className="form-input"
                placeholder="41318048"
              />
              {errors.ci
                ? <p className="form-error">{errors.ci.message}</p>
                : (ciValue && validarCedula(ciValue) && <p className="text-xs text-green-600 mt-1">{formatCedula(ciValue)}</p>)}
            </div>
            <div>
              <label className="form-label">Primer nombre *</label>
              <input {...register('nombre', { required: 'Requerido' })} className="form-input" />
              {errors.nombre && <p className="form-error">{errors.nombre.message}</p>}
            </div>
            <div>
              <label className="form-label">Segundo nombre</label>
              <input {...register('nombre2')} className="form-input" placeholder="(BPS)" />
            </div>
            <div>
              <label className="form-label">Primer apellido *</label>
              <input {...register('apellido', { required: 'Requerido' })} className="form-input" />
              {errors.apellido && <p className="form-error">{errors.apellido.message}</p>}
            </div>
            <div>
              <label className="form-label">Segundo apellido</label>
              <input {...register('apellido2')} className="form-input" placeholder="(BPS)" />
            </div>
            <div>
              <label className="form-label">Fecha de nacimiento</label>
              <input {...register('fechaNacimiento')} type="date" className="form-input" />
            </div>
            <div>
              <label className="form-label">Sexo</label>
              <select {...register('sexo')} className="form-input">
                <option value="">— Seleccionar —</option>
                <option value="M">Masculino</option>
                <option value="F">Femenino</option>
              </select>
            </div>
            <div>
              <label className="form-label">Nacionalidad (BPS)</label>
              <select {...register('nacionalidad')} className="form-input">
                <option value={1}>1 — Uruguayo/a (ciudadano natural)</option>
                <option value={2}>2 — Ciudadano/a legal</option>
                <option value={3}>3 — Extranjero/a</option>
              </select>
            </div>
            <div>
              <label className="form-label">Estado civil</label>
              <select {...register('estadoCivil')} className="form-input">
                <option value="SOLTERO">Soltero/a</option>
                <option value="CASADO">Casado/a</option>
                <option value="CONCUBINATO">Concubinato</option>
                <option value="DIVORCIADO">Divorciado/a</option>
                <option value="VIUDO">Viudo/a</option>
              </select>
            </div>
            <div>
              <label className="form-label">Email</label>
              <input {...register('email')} type="email" className="form-input" />
            </div>
            <div>
              <label className="form-label">Teléfono</label>
              <input {...register('telefono')} className="form-input" />
            </div>
            <div className="col-span-2">
              <label className="form-label">Domicilio</label>
              <input {...register('domicilio')} className="form-input" />
            </div>
            </div>
            {isEdit && id && (
              <div className="w-full md:w-44 shrink-0">
                <PersonPhoto companyId={activeCompanyId} ownerId={id} />
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Cargas e IRPF</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Hijos a cargo</label>
              <input {...register('hijosACargo', { valueAsNumber: true })} type="number" min="0" className="form-input" />
            </div>
            <div>
              <label className="form-label">Hijos con discapacidad</label>
              <input {...register('hijosDiscapacitados', { valueAsNumber: true })} type="number" min="0" className="form-input" />
            </div>
            <div>
              <label className="form-label">Método IRPF</label>
              <select {...register('irpfMetodo')} className="form-input">
                <option value="PROYECCION">Proyección anual</option>
                <option value="SIMPLIFICADO">Simplificado</option>
              </select>
            </div>
            <div className="flex flex-col gap-2 pt-6">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input {...register('conyugeACargo')} type="checkbox" className="rounded" />
                Cónyuge a cargo (FONASA +2%)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input {...register('fonasaFamilia')} type="checkbox" className="rounded" />
                Hijos en FONASA (+1.5%)
              </label>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Observaciones</h3>
          <textarea {...register('observaciones')} rows={3} className="form-input" placeholder="Notas libres sobre la persona..." />
        </section>

        {isEdit ? (
          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
            Los datos laborales (empresa, sueldo, cargo) se editan desde los <b>Contratos</b> en la ficha de la persona.
          </p>
        ) : (
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Primer contrato (vínculo con la empresa)</h3>
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
                <label className="form-label">Fecha de ingreso *</label>
                <input {...register('fechaIngreso', { required: 'Requerido' })} type="date" className="form-input" />
                {errors.fechaIngreso && <p className="form-error">{errors.fechaIngreso.message}</p>}
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
                <label className="form-label">Vínculo funcional (BPS Tabla 3)</label>
                <select {...register('vinculoFuncional')} className="form-input">
                  {vinculos?.map((v) => <option key={v.codigo} value={v.codigo}>{v.codigo} — {v.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Seguro de salud (BPS Tabla 8)</label>
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
                <label className="form-label">Sueldo nominal mensual ($) *</label>
                <input {...register('salarioNominalPesos', { valueAsNumber: true, required: true, min: 0 })} type="number" step="0.01" className="form-input" />
              </div>
              {salaryType === 'JORNALERO' && (
                <div>
                  <label className="form-label">Jornal diario ($)</label>
                  <input {...register('jornalPesos', { valueAsNumber: true, min: 0 })} type="number" step="0.01" className="form-input" />
                </div>
              )}
            </div>
          </section>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Link to="/employees" className="btn-secondary">Cancelar</Link>
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear persona y contrato'}
          </button>
        </div>
      </form>

      {isEdit && id && (
        <div className="mt-5">
          <AttachmentsPanel companyId={activeCompanyId} ownerType="PERSONA" ownerId={id} hidePhoto />
        </div>
      )}
    </div>
  );
}
