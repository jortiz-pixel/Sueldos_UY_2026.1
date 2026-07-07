import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Circle, AlertTriangle, ChevronLeft, ChevronRight,
  CalendarPlus, Users, FileText, Landmark, Wallet, Lock, FileDiff, ArrowRight,
} from 'lucide-react';
import { nominaApi, liquidationApi, reportsApi } from '../services/api';
import { useCompany } from '../hooks/useCompany';
import { useAuth } from '../hooks/useAuth';
import { MESES, formatPesos } from '../types';

type EstadoPaso = 'ok' | 'pendiente' | 'atencion' | 'bloqueado';

// Descarga el asiento contable del mes en TXT (para el sistema contable).
async function descargarAsientoTxt(companyId: string, year: number, month: number) {
  const blob = await reportsApi.asientoTxt(companyId, year, month);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asiento_sueldos_${String(month).padStart(2, '0')}${year}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ESTADO_STYLE: Record<EstadoPaso, { icon: typeof CheckCircle2; cls: string; linea: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-ok', linea: 'bg-ok/40' },
  atencion: { icon: AlertTriangle, cls: 'text-warn', linea: 'bg-warn/40' },
  pendiente: { icon: Circle, cls: 'text-ink-subtle/60', linea: 'bg-hairline' },
  bloqueado: { icon: Circle, cls: 'text-ink-subtle/30', linea: 'bg-hairline' },
};

export default function CentroMesPage() {
  const { activeCompanyId: companyId, companies } = useCompany();
  const { isOperator } = useAuth();
  const queryClient = useQueryClient();
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth() + 1);
  const [trabajando, setTrabajando] = useState('');

  const empresa = companies.find((c) => c.companyId === companyId);

  const { data: cm, isLoading } = useQuery({
    queryKey: ['centro-mes', companyId, year, month],
    queryFn: () => nominaApi.centroMes(companyId, year, month),
    enabled: !!companyId,
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['centro-mes'] });
    queryClient.invalidateQueries({ queryKey: ['periods'] });
    queryClient.invalidateQueries({ queryKey: ['nomina-declaraciones'] });
  };

  const accion = useMutation({
    mutationFn: async ({ tipo }: { tipo: string }) => {
      setTrabajando(tipo);
      if (tipo === 'crear-periodo') {
        return liquidationApi.createPeriod({ companyId, year, month });
      }
      if (tipo === 'generar' && cm?.period) {
        return liquidationApi.generateBatch({ companyId, periodId: cm.period.id, year, month });
      }
      if (tipo === 'confirmar' && cm?.period) {
        return liquidationApi.confirmBatch(cm.period.id);
      }
      if (tipo === 'cerrar' && cm?.period) {
        if (!confirm('Cerrar el período impide seguir modificándolo. ¿Confirmar el cierre del mes?')) return null;
        return liquidationApi.cerrarPeriodo(cm.period.id);
      }
      if (tipo === 'asiento-txt') {
        await descargarAsientoTxt(companyId, year, month).catch(() => alert('No se pudo generar el asiento. ¿El período tiene liquidaciones confirmadas?'));
        return null;
      }
      return null;
    },
    onSuccess: (data, vars) => {
      setTrabajando('');
      refrescar();
      // Al cerrar el mes se descarga el asiento contable en TXT.
      if (vars.tipo === 'cerrar' && data) {
        descargarAsientoTxt(companyId, year, month).catch(() => { /* sin confirmadas: nada para descargar */ });
      }
    },
    onError: (err: unknown) => {
      setTrabajando('');
      const m = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(m || 'No se pudo completar la acción.');
      refrescar();
    },
  });

  const mover = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  // ── Derivar el estado de cada paso ─────────────────────────────
  const pasos = cm ? (() => {
    const sinPeriodo = !cm.period;
    const liq = cm.liquidaciones;
    const cerrado = cm.period?.status === 'CERRADO';

    const pasoPeriodo: EstadoPaso = cm.period ? 'ok' : 'atencion';
    const pasoDatos: EstadoPaso = cm.datos.ok ? 'ok' : 'atencion';
    const pasoGenerar: EstadoPaso = sinPeriodo ? 'bloqueado'
      : liq.generadas >= liq.roster && liq.roster > 0 ? 'ok'
      : 'atencion';
    const pasoConfirmar: EstadoPaso = sinPeriodo || liq.generadas === 0 ? 'bloqueado'
      : liq.borradores === 0 ? 'ok' : 'atencion';
    const pasoNomina: EstadoPaso = liq.confirmadas === 0 ? 'bloqueado'
      : !cm.declaracion.declarada ? 'atencion'
      : cm.declaracion.cambiosPosteriores ? 'atencion'
      : 'ok';
    const pasoCierre: EstadoPaso = cerrado ? 'ok'
      : liq.borradores === 0 && liq.confirmadas > 0 && cm.declaracion.declarada ? 'atencion'
      : 'bloqueado';

    return [
      {
        key: 'periodo', titulo: 'Período de liquidación', icon: CalendarPlus, estado: pasoPeriodo,
        detalle: cm.period
          ? `Período ${MESES[month]} ${year} creado (${cm.period.status.toLowerCase()}).`
          : `Todavía no existe el período ${MESES[month]} ${year}.`,
        accion: !cm.period && isOperator
          ? { label: 'Crear período', tipo: 'crear-periodo' }
          : null,
        link: null,
      },
      {
        key: 'datos', titulo: 'Datos BPS completos', icon: Users, estado: pasoDatos,
        detalle: cm.datos.ok
          ? `Las ${cm.datos.totalPersonas} persona(s) del mes tienen los datos completos.`
          : [
              cm.datos.faltantesEmpresa.length ? `Empresa: falta ${cm.datos.faltantesEmpresa.join(', ')}.` : '',
              cm.datos.personasIncompletas ? `${cm.datos.personasIncompletas} persona(s) con datos incompletos.` : '',
            ].filter(Boolean).join(' '),
        accion: null,
        link: cm.datos.ok ? null : { label: 'Completar en Personas', to: '/employees' },
      },
      {
        key: 'generar', titulo: 'Generar liquidaciones', icon: FileText, estado: pasoGenerar,
        detalle: sinPeriodo
          ? 'Creá el período primero.'
          : `${liq.generadas} de ${liq.roster} persona(s) con liquidación generada.`,
        accion: !sinPeriodo && !cerrado && liq.generadas < liq.roster && isOperator
          ? { label: `Generar faltantes (${liq.roster - liq.generadas})`, tipo: 'generar' }
          : null,
        link: { label: 'Ver liquidaciones', to: '/liquidation' },
      },
      {
        key: 'confirmar', titulo: 'Revisar y confirmar', icon: CheckCircle2, estado: pasoConfirmar,
        detalle: sinPeriodo || liq.generadas === 0
          ? 'Generá las liquidaciones primero.'
          : liq.borradores === 0
            ? `Las ${liq.confirmadas} liquidación(es) están confirmadas. Recibos disponibles.`
            : `${liq.borradores} liquidación(es) en borrador por confirmar.`,
        accion: liq.borradores > 0 && !cerrado && isOperator
          ? { label: `Confirmar todas (${liq.borradores})`, tipo: 'confirmar' }
          : null,
        link: liq.confirmadas > 0 ? { label: 'Recibos en Liquidaciones', to: '/liquidation' } : null,
      },
      {
        key: 'nomina', titulo: 'Declarar nómina BPS', icon: Landmark, estado: pasoNomina,
        detalle: liq.confirmadas === 0
          ? 'Confirmá las liquidaciones primero.'
          : !cm.declaracion.declarada
            ? 'La nómina del mes todavía no fue generada/declarada.'
            : cm.declaracion.cambiosPosteriores
              ? `Nómina declarada el ${new Date(cm.declaracion.declarada).toLocaleDateString('es-UY')}, pero hay cambios posteriores: correspondería una rectificativa.`
              : `Nómina declarada el ${new Date(cm.declaracion.declarada).toLocaleDateString('es-UY')}${cm.declaracion.rectificativas ? ` · ${cm.declaracion.rectificativas} rectificativa(s)` : ''}.`,
        accion: null,
        link: liq.confirmadas === 0 ? null
          : cm.declaracion.cambiosPosteriores
            ? { label: 'Generar rectificativa', to: '/nomina', icon: FileDiff }
            : { label: cm.declaracion.declarada ? 'Ver en Nómina BPS' : 'Generar nómina', to: '/nomina' },
      },
      {
        key: 'pagos', titulo: 'Pagos del mes', icon: Wallet,
        estado: (liq.confirmadas > 0 ? 'ok' : 'bloqueado') as EstadoPaso,
        detalle: liq.confirmadas > 0
          ? `Líquidos a pagar: ${formatPesos(cm.pagos.liquidos)} (${liq.confirmadas} liquidación(es)).`
          : 'Se calcula al confirmar liquidaciones.',
        accion: null,
        link: liq.confirmadas > 0 ? { label: 'Ver pagos y aportes', to: '/reports' } : null,
      },
      {
        key: 'cierre', titulo: 'Cierre del mes', icon: Lock, estado: pasoCierre,
        detalle: cerrado
          ? 'Período cerrado. El mes quedó bloqueado contra modificaciones.'
          : pasoCierre === 'atencion'
            ? 'Todo listo: podés cerrar el mes para bloquear modificaciones.'
            : 'Se habilita al confirmar todo y declarar la nómina.',
        accion: pasoCierre === 'atencion' && isOperator
          ? { label: 'Cerrar período', tipo: 'cerrar' }
          : cerrado
            ? { label: 'Descargar asiento (TXT)', tipo: 'asiento-txt' }
            : null,
        link: null,
      },
    ];
  })() : [];

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink font-brand">Centro del mes</h1>
          <p className="text-ink-subtle text-sm mt-0.5">
            El ciclo mensual de {empresa?.nombreFantasia || empresa?.razonSocial || 'la empresa'}, paso a paso
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => mover(-1)} className="btn-tertiary btn-sm" aria-label="Mes anterior"><ChevronLeft size={16} /></button>
          <span className="text-sm font-semibold text-ink w-36 text-center">{MESES[month]} {year}</span>
          <button onClick={() => mover(1)} className="btn-tertiary btn-sm" aria-label="Mes siguiente"><ChevronRight size={16} /></button>
        </div>
      </div>

      {isLoading || !cm ? (
        <div className="card p-10 text-center text-ink-subtle">Cargando el estado del mes…</div>
      ) : (
        <div className="card p-5">
          <ol className="space-y-0">
            {pasos.map((p, i) => {
              const st = ESTADO_STYLE[p.estado];
              const StIcon = st.icon;
              return (
                <li key={p.key} className="relative flex gap-4 pb-6 last:pb-0">
                  {/* Línea vertical */}
                  {i < pasos.length - 1 && (
                    <span className={`absolute left-[13px] top-8 bottom-0 w-0.5 ${st.linea}`} aria-hidden />
                  )}
                  <StIcon size={28} className={`${st.cls} shrink-0 relative z-10 bg-white rounded-full`} strokeWidth={p.estado === 'ok' ? 2.2 : 1.8} />
                  <div className={`flex-1 min-w-0 ${p.estado === 'bloqueado' ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p.icon size={15} className="text-ink-subtle" />
                      <h3 className="text-sm font-semibold text-ink">{p.titulo}</h3>
                    </div>
                    <p className="text-sm text-ink-muted mt-0.5">{p.detalle}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {p.accion && (
                        <button
                          onClick={() => accion.mutate({ tipo: p.accion!.tipo })}
                          disabled={!!trabajando}
                          className="btn-primary btn-sm"
                        >
                          {trabajando === p.accion.tipo ? 'Procesando…' : p.accion.label}
                        </button>
                      )}
                      {p.link && (
                        <Link to={p.link.to} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                          {p.link.label} <ArrowRight size={12} />
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
