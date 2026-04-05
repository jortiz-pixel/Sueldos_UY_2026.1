import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Calendar, User, DollarSign, FileText } from 'lucide-react';
import { employeesApi } from '../services/api';
import { formatPesos, MESES } from '../types';

function Field({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-gray-800">{String(value)}</p>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeesApi.get(id!),
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

  if (isLoading) return <div className="text-center py-12 text-gray-400">Cargando...</div>;
  if (!employee) return <div className="text-center py-12 text-gray-400">Empleado no encontrado</div>;

  const antiguedad = employee.antiguedadAnios ?? 0;

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Back */}
      <div className="flex items-center gap-3">
        <Link to="/employees" className="btn-secondary btn-sm">
          <ArrowLeft size={14} />
          Volver
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{employee.apellido}, {employee.nombre}</h1>
          <p className="text-gray-500 text-sm">CI: {employee.ci} · {employee.cargo || 'Sin cargo'}</p>
        </div>
        <div className="ml-auto">
          {employee.active
            ? <span className="badge-green badge">Activo</span>
            : <span className="badge-red badge">Inactivo</span>
          }
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Datos personales */}
        <div className="card p-5 lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
            <User size={16} />
            Datos Personales y Laborales
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nombre completo" value={`${employee.nombre} ${employee.apellido}`} />
            <Field label="Cédula de Identidad" value={employee.ci} />
            <Field label="Estado civil" value={employee.estadoCivil} />
            <Field label="Email" value={employee.email} />
            <Field label="Teléfono" value={employee.telefono} />
            <Field label="Domicilio" value={employee.domicilio} />
            <Field label="Fecha de ingreso" value={new Date(employee.fechaIngreso).toLocaleDateString('es-UY')} />
            <Field label="Antigüedad" value={`${antiguedad} año(s)`} />
            <Field label="Cargo" value={employee.cargo} />
            <Field label="Categoría" value={employee.categoria} />
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
              <DollarSign size={16} />
              Situación Salarial
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tipo de salario" value={employee.salaryType === 'MENSUAL' ? 'Mensual' : 'Jornalero'} />
              <Field label="Salario nominal" value={formatPesos(employee.salarioNominal)} />
              {employee.jornal && <Field label="Jornal diario" value={formatPesos(employee.jornal)} />}
              <Field label="Método IRPF" value={employee.irpfMetodo} />
              <Field label="FONASA con familia" value={employee.fonasaFamilia ? 'Sí (+2%)' : 'No (solo 3%)'} />
              <Field label="Cónyuge a cargo" value={employee.conyugeACargo ? 'Sí' : 'No'} />
              <Field label="Hijos a cargo" value={employee.hijosACargo} />
              <Field label="Hijos con discapacidad" value={employee.hijosDiscapacitados} />
            </div>
          </div>
        </div>

        {/* Vacaciones */}
        <div className="space-y-4">
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
                (liquidations as any[]).slice(0, 12).map((liq: any) => (
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
    </div>
  );
}
