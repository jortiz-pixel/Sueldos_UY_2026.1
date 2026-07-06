import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { auditApi, AuditRow } from '../services/api';

// Etiquetas legibles para cada acción registrada.
const ACCIONES: Record<string, { label: string; tone: string }> = {
  LOGIN: { label: 'Ingreso', tone: 'bg-emerald-50 text-emerald-700' },
  LOGIN_FAILED: { label: 'Ingreso fallido', tone: 'bg-red-50 text-red-700' },
  LOGOUT: { label: 'Cierre de sesión', tone: 'bg-gray-100 text-gray-600' },
  PASSWORD_CHANGE: { label: 'Cambio de contraseña', tone: 'bg-amber-50 text-amber-700' },
  COMPANY_CREATE: { label: 'Empresa creada', tone: 'bg-blue-50 text-blue-700' },
  COMPANY_UPDATE: { label: 'Empresa modificada', tone: 'bg-blue-50 text-blue-700' },
  COMPANY_VISIBILITY: { label: 'Empresa oculta/visible', tone: 'bg-blue-50 text-blue-700' },
  COMPANY_DELETE: { label: 'Empresa eliminada', tone: 'bg-red-50 text-red-700' },
  USER_CREATE: { label: 'Usuario creado', tone: 'bg-blue-50 text-blue-700' },
  ACCESS_GRANT: { label: 'Acceso otorgado', tone: 'bg-emerald-50 text-emerald-700' },
  ACCESS_UPDATE: { label: 'Acceso modificado', tone: 'bg-amber-50 text-amber-700' },
  ACCESS_REVOKE: { label: 'Acceso revocado', tone: 'bg-red-50 text-red-700' },
  CONTRACT_BAJA: { label: 'Baja de contrato', tone: 'bg-amber-50 text-amber-700' },
  CONTRACT_REACTIVATE: { label: 'Baja cancelada', tone: 'bg-emerald-50 text-emerald-700' },
  CONTRACT_DELETE: { label: 'Contrato eliminado', tone: 'bg-red-50 text-red-700' },
  EMPLOYEE_DELETE: { label: 'Persona eliminada', tone: 'bg-red-50 text-red-700' },
  LIQUIDATION_DELETE: { label: 'Liquidación eliminada', tone: 'bg-red-50 text-red-700' },
  LIQUIDATION_CANCEL: { label: 'Liquidación anulada', tone: 'bg-amber-50 text-amber-700' },
  PARAMETER_CHANGE: { label: 'Parámetro cambiado', tone: 'bg-amber-50 text-amber-700' },
};

function accionInfo(a: string) {
  return ACCIONES[a] ?? { label: a, tone: 'bg-gray-100 text-gray-600' };
}

function resumenDatos(r: AuditRow): string {
  const d = (r.newData ?? r.oldData) as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return '';
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
    .slice(0, 160);
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, entity],
    queryFn: () => auditApi.list({ page, limit: 50, entity: entity || undefined }),
  });

  const rows = data?.data ?? [];
  const pag = data?.pagination;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck size={22} className="text-brand-600" /> Auditoría de accesos
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Registro de ingresos y acciones sensibles del sistema{pag ? ` · ${pag.total} eventos` : ''}</p>
        </div>
        <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="form-input w-52">
          <option value="">Todas las categorías</option>
          <option value="auth">Accesos (login)</option>
          <option value="company">Empresas</option>
          <option value="membership">Accesos compartidos</option>
          <option value="contract">Contratos</option>
          <option value="employee">Personas</option>
          <option value="liquidation">Liquidaciones</option>
          <option value="parameter">Parámetros</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">Fecha y hora</th>
                <th className="px-4 py-3 text-left">Acción</th>
                <th className="px-4 py-3 text-left">Usuario</th>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-left">Detalle</th>
                <th className="px-4 py-3 text-left">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin eventos registrados</td></tr>
              ) : rows.map((r) => {
                const info = accionInfo(r.action);
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{new Date(r.createdAt).toLocaleString('es-UY')}</td>
                    <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded font-medium ${info.tone}`}>{info.label}</span></td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="text-gray-800">{r.usuario ?? '—'}</div>
                      <div className="text-gray-400">{r.usuarioEmail ?? ''}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{r.empresa ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[320px] truncate" title={resumenDatos(r)}>{resumenDatos(r)}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-gray-400">{r.ipAddress ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pag && pag.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm">
            <span className="text-gray-500">Página {pag.page} de {pag.totalPages}</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-secondary btn-sm disabled:opacity-40"><ChevronLeft size={15} /></button>
              <button disabled={page >= pag.totalPages} onClick={() => setPage((p) => p + 1)} className="btn-secondary btn-sm disabled:opacity-40"><ChevronRight size={15} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
