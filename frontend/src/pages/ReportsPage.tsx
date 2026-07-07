import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, BarChart2, FileText, Shield, Wallet, Users2, TrendingUp, TrendingDown, Landmark, BookOpen, AlertCircle } from 'lucide-react';
import { reportsApi, PagosBancoReport, AsientoReport } from '../services/api';
import { useCompany } from '../hooks/useCompany';
import { formatPesos, MESES, NominaItem } from '../types';

export default function ReportsPage() {
  const { activeCompanyId: companyId } = useCompany();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activeReport, setActiveReport] = useState<'pagos' | 'costo' | 'nomina' | 'bps' | 'irpf' | 'banco' | 'asiento'>('pagos');

  const { data: pagos, isLoading: pagosLoading } = useQuery({
    queryKey: ['pagos-mes', companyId, year, month],
    queryFn: () => reportsApi.pagosMes({ companyId, year, month }),
    enabled: !!companyId && activeReport === 'pagos',
  });

  const { data: costo, isLoading: costoLoading } = useQuery({
    queryKey: ['costo-personal', companyId, year, month],
    queryFn: () => reportsApi.costoPersonal({ companyId, year, month }),
    enabled: !!companyId && activeReport === 'costo',
  });

  const { data: nomina, isLoading: nominaLoading } = useQuery({
    queryKey: ['nomina-report', companyId, year, month],
    queryFn: () => reportsApi.nominaMensual({ companyId, year, month }),
    enabled: !!companyId && activeReport === 'nomina',
  });

  const { data: bps, isLoading: bpsLoading } = useQuery({
    queryKey: ['bps-report', companyId, year, month],
    queryFn: () => reportsApi.bpsNomina({ companyId, year, month }),
    enabled: !!companyId && activeReport === 'bps',
  });

  const { data: irpf, isLoading: irpfLoading } = useQuery({
    queryKey: ['irpf-report', companyId, year],
    queryFn: () => reportsApi.irpfSummary({ companyId, year }),
    enabled: !!companyId && activeReport === 'irpf',
  });

  const { data: banco, isLoading: bancoLoading } = useQuery({
    queryKey: ['pagos-banco', companyId, year, month],
    queryFn: () => reportsApi.pagosBanco({ companyId, year, month }),
    enabled: !!companyId && activeReport === 'banco',
    retry: false,
  });

  const { data: asiento, isLoading: asientoLoading } = useQuery({
    queryKey: ['asiento', companyId, year, month],
    queryFn: () => reportsApi.asiento({ companyId, year, month }),
    enabled: !!companyId && activeReport === 'asiento',
    retry: false,
  });

  const summary = nomina?.summary as Record<string, string> | undefined;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reportes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Nómina, BPS e IRPF</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value))}
            className="form-input text-sm"
          >
            {MESES.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="form-input text-sm"
          >
            {[2023, 2024, 2025, 2026].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <a
            href={reportsApi.nominaExcelUrl(companyId, year, month)}
            className="btn-secondary btn-sm"
          >
            <Download size={14} />
            Excel
          </a>
        </div>
      </div>

      {/* Report tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {[
          { key: 'pagos', label: 'Pagos del mes', icon: Wallet },
          { key: 'costo', label: 'Costo de personal', icon: Users2 },
          { key: 'nomina', label: 'Nómina Mensual', icon: FileText },
          { key: 'bps', label: 'BPS (C1)', icon: Shield },
          { key: 'irpf', label: 'IRPF Anual', icon: BarChart2 },
          { key: 'banco', label: 'Pagos al banco', icon: Landmark },
          { key: 'asiento', label: 'Asiento contable', icon: BookOpen },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveReport(key as typeof activeReport)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeReport === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Pagos del mes */}
      {activeReport === 'pagos' && (
        <PagosDelMes data={pagos} loading={pagosLoading} year={year} month={month} />
      )}

      {/* Planilla de pagos al banco */}
      {activeReport === 'banco' && (
        <PagosBanco data={banco} loading={bancoLoading} companyId={companyId} year={year} month={month} />
      )}

      {/* Asiento contable */}
      {activeReport === 'asiento' && (
        <AsientoContable data={asiento} loading={asientoLoading} companyId={companyId} year={year} month={month} />
      )}

      {/* Costo de personal */}
      {activeReport === 'costo' && (
        <CostoPersonal data={costo} loading={costoLoading} year={year} month={month} />
      )}

      {/* Nomina report */}
      {activeReport === 'nomina' && (
        <div className="space-y-4">
          {/* Summary bar */}
          {summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[
                { label: 'Empleados', value: summary.empleados },
                { label: 'Total Haberes', value: formatPesos(summary.totalHaberes) },
                { label: 'Total Descuentos', value: formatPesos(summary.totalDescuentos) },
                { label: 'Líquido a Pagar', value: formatPesos(summary.totalLiquidoPercibir) },
              ].map(({ label, value }) => (
                <div key={label} className="card p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-base font-bold text-gray-900 mt-1">{value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">
                Nómina — {MESES[month]} {year}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="table-header">
                    <th className="px-4 py-3 text-left">Empleado</th>
                    <th className="px-4 py-3 text-right">Haberes</th>
                    <th className="px-4 py-3 text-right">BPS Jub.</th>
                    <th className="px-4 py-3 text-right">FONASA</th>
                    <th className="px-4 py-3 text-right">IRPF</th>
                    <th className="px-4 py-3 text-right">Descuentos</th>
                    <th className="px-4 py-3 text-right">Líquido</th>
                    <th className="px-4 py-3 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {nominaLoading ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
                  ) : !nomina?.nomina?.length ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Sin datos para este período</td></tr>
                  ) : nomina.nomina.map((item: NominaItem) => {
                    const bpsJub = item.descuentos.find((d) => d.concepto === 'BPS_JUBILATORIO')?.amount ?? '0';
                    const fonasa = (
                      BigInt(item.descuentos.find((d) => d.concepto === 'FONASA')?.amount ?? '0')
                      + BigInt(item.descuentos.find((d) => d.concepto === 'FONASA_ADICIONAL')?.amount ?? '0')
                    ).toString();
                    const irpfItem = item.descuentos.find((d) => d.concepto === 'IRPF')?.amount ?? '0';
                    return (
                      <tr key={item.liquidacion.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-sm">
                          <div className="font-medium text-gray-800">
                            {item.empleado?.apellido}, {item.empleado?.nombre}
                          </div>
                          <div className="text-xs text-gray-400">{item.empleado?.ci}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatPesos(item.liquidacion.totalHaberes)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatPesos(bpsJub)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatPesos(fonasa)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatPesos(irpfItem)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-red-600">({formatPesos(item.liquidacion.totalDescuentos)})</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-bold text-green-700">{formatPesos(item.liquidacion.liquidoPercibir)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`badge text-xs ${item.liquidacion.status === 'CONFIRMADO' ? 'badge-green' : 'badge-yellow'}`}>
                            {item.liquidacion.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* BPS report */}
      {activeReport === 'bps' && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">
              Declaración BPS (C1) — {MESES[month]} {year}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Datos para la nómina mensual del BPS</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="px-3 py-3 text-left">CI</th>
                  <th className="px-3 py-3 text-left">Empleado</th>
                  <th className="px-3 py-3 text-right">Salario</th>
                  <th className="px-3 py-3 text-right">Jub. Obrero</th>
                  <th className="px-3 py-3 text-right">FONASA Ob.</th>
                  <th className="px-3 py-3 text-right">IVS Patr.</th>
                  <th className="px-3 py-3 text-right">FONASA Patr.</th>
                  <th className="px-3 py-3 text-right">Total Ob.</th>
                  <th className="px-3 py-3 text-right">Total Patr.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {bpsLoading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
                ) : !(bps as any)?.bpsData?.length ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">Sin datos</td></tr>
                ) : (bps as any).bpsData.map((row: any) => (
                  <tr key={row.ci} className="hover:bg-gray-50 text-xs">
                    <td className="px-3 py-2.5 font-mono">{row.ci}</td>
                    <td className="px-3 py-2.5">{row.nombre}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatPesos(row.salarioNominal)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatPesos(row.jubilatorioObrero)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatPesos(row.fonasaObrero)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatPesos(row.ivsPatronal)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatPesos(row.fonasaPatronal)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold">{formatPesos(row.totalObrero)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold">{formatPesos(row.totalPatronal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* IRPF report */}
      {activeReport === 'irpf' && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Retenciones IRPF — {year}</h2>
            {irpf && <p className="text-xs text-gray-500 mt-0.5">Total retenido: {(irpf as any).totalRetenidoPesos?.toLocaleString('es-UY', { style: 'currency', currency: 'UYU' })}</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="px-4 py-3 text-left">CI</th>
                  <th className="px-4 py-3 text-left">Empleado</th>
                  <th className="px-4 py-3 text-right">Total Anual IRPF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {irpfLoading ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
                ) : !(irpf as any)?.summary?.length ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-400">Sin retenciones registradas</td></tr>
                ) : (irpf as any).summary.map((row: any) => (
                  <tr key={row.ci} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs font-mono">{row.ci}</td>
                    <td className="px-4 py-2.5 text-sm">{row.nombre}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-medium">
                      {row.totalAnualPesos?.toLocaleString('es-UY', { style: 'currency', currency: 'UYU' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Reporte: Pagos del mes ─────────────────────────────────────────
function Delta({ actual, anterior }: { actual: string; anterior: string }) {
  const a = Number(actual); const b = Number(anterior);
  if (!b) return null;
  const pct = ((a - b) / b) * 100;
  if (Math.abs(pct) < 0.05) return <span className="text-xs text-ink-subtle">= mes ant.</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${up ? 'text-warn' : 'text-ok'}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {pct > 0 ? '+' : ''}{pct.toFixed(1)}% vs mes ant.
    </span>
  );
}

function PagosDelMes({ data, loading, year, month }: {
  data: import('../services/api').PagosMesReport | undefined;
  loading: boolean; year: number; month: number;
}) {
  if (loading) return <div className="card p-10 text-center text-ink-subtle">Calculando…</div>;
  if (!data || !data.liquidacionesConfirmadas) {
    return <div className="card p-10 text-center text-ink-subtle">Sin liquidaciones confirmadas en {MESES[month]} {year}. Los pagos se calculan sobre liquidaciones confirmadas.</div>;
  }
  const { actual, anterior } = data;
  const destinos = [
    { destino: 'Empleados (líquidos a cobrar)', actual: actual.liquidos, anterior: anterior.liquidos, detalle: `${actual.empleados} persona(s)` },
    { destino: 'BPS — aportes obreros retenidos', actual: actual.bps.obrero.total, anterior: anterior.bps.obrero.total, detalle: `Jubilatorio ${formatPesos(actual.bps.obrero.jubilatorio)} · FONASA ${formatPesos(actual.bps.obrero.fonasa)} · FRL ${formatPesos(actual.bps.obrero.frl)}` },
    { destino: 'BPS — aportes patronales', actual: actual.bps.patronal.total, anterior: anterior.bps.patronal.total, detalle: `Jubilatorio ${formatPesos(actual.bps.patronal.jubilatorio)} · FONASA ${formatPesos(actual.bps.patronal.fonasa)} · FRL ${formatPesos(actual.bps.patronal.frl)}` },
    { destino: 'DGI — IRPF retenido', actual: actual.irpf, anterior: anterior.irpf, detalle: '' },
    { destino: 'BSE — seguro de accidentes', actual: actual.bse, anterior: anterior.bse, detalle: '' },
  ];
  return (
    <div className="space-y-4">
      {/* Total destacado */}
      <div className="card p-5 flex flex-wrap items-end justify-between gap-3 border-l-4 border-l-brand-600">
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-subtle font-semibold">Total a desembolsar — {MESES[month]} {year}</p>
          <p className="text-3xl font-bold text-ink figure mt-1">{formatPesos(actual.totalDesembolso)}</p>
        </div>
        <div className="text-right">
          <Delta actual={actual.totalDesembolso} anterior={anterior.totalDesembolso} />
          <p className="text-xs text-ink-subtle mt-1">{MESES[anterior.month]} {anterior.year}: {formatPesos(anterior.totalDesembolso)}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">Destino</th>
                <th className="px-4 py-3 text-right">{MESES[month]} {year}</th>
                <th className="px-4 py-3 text-right">{MESES[anterior.month]} {anterior.year}</th>
                <th className="px-4 py-3 text-right">Variación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {destinos.map((d) => (
                <tr key={d.destino} className="hover:bg-canvas/60">
                  <td className="table-cell">
                    <p className="text-sm font-medium text-ink">{d.destino}</p>
                    {d.detalle && <p className="text-[11px] text-ink-subtle">{d.detalle}</p>}
                  </td>
                  <td className="table-cell text-right figure text-sm font-semibold">{formatPesos(d.actual)}</td>
                  <td className="table-cell text-right figure text-xs text-ink-subtle">{formatPesos(d.anterior)}</td>
                  <td className="table-cell text-right"><Delta actual={d.actual} anterior={d.anterior} /></td>
                </tr>
              ))}
              <tr className="bg-brand-50/60">
                <td className="table-cell font-bold text-ink">Total desembolso del mes</td>
                <td className="table-cell text-right figure font-bold text-brand-700">{formatPesos(actual.totalDesembolso)}</td>
                <td className="table-cell text-right figure text-xs text-ink-subtle">{formatPesos(anterior.totalDesembolso)}</td>
                <td className="table-cell text-right"><Delta actual={actual.totalDesembolso} anterior={anterior.totalDesembolso} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        {Number(actual.otrasRetenciones) > 0 && (
          <p className="px-4 py-2.5 text-xs text-ink-subtle border-t border-hairline">
            Además se retuvieron {formatPesos(actual.otrasRetenciones)} por otros conceptos (adelantos, retenciones judiciales, etc.) que no son pagos a organismos.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Reporte: Costo de personal ─────────────────────────────────────
function CostoPersonal({ data, loading, year, month }: {
  data: import('../services/api').CostoPersonalReport | undefined;
  loading: boolean; year: number; month: number;
}) {
  if (loading) return <div className="card p-10 text-center text-ink-subtle">Calculando…</div>;
  if (!data?.period || !data.filas.length) {
    return <div className="card p-10 text-center text-ink-subtle">Sin liquidaciones confirmadas en {MESES[month]} {year}.</div>;
  }
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-hairline">
        <h2 className="text-sm font-semibold text-ink">Costo de personal — {MESES[month]} {year}</h2>
        <p className="text-xs text-ink-subtle mt-0.5">
          Haberes + aportes patronales + provisiones (aguinaldo 8,33% del gravado, patronal s/aguinaldo 0,76%, salario vacacional 4,45%)
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-3 text-left">Empleado</th>
              <th className="px-4 py-3 text-right">Haberes</th>
              <th className="px-4 py-3 text-right">Líquido</th>
              <th className="px-4 py-3 text-right">Ap. patronales</th>
              <th className="px-4 py-3 text-right">Prov. aguinaldo</th>
              <th className="px-4 py-3 text-right">Prov. sal. vacacional</th>
              <th className="px-4 py-3 text-right">Costo total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline/60">
            {data.filas.map((f) => (
              <tr key={f.empleado?.id ?? f.haberes} className="hover:bg-canvas/60">
                <td className="table-cell">
                  <p className="text-sm font-medium text-ink">{f.empleado?.apellido}, {f.empleado?.nombre}</p>
                  <p className="text-[11px] text-ink-subtle">{f.empleado?.cargo || f.empleado?.ci}</p>
                </td>
                <td className="table-cell text-right figure text-xs">{formatPesos(f.haberes)}</td>
                <td className="table-cell text-right figure text-xs">{formatPesos(f.liquido)}</td>
                <td className="table-cell text-right figure text-xs">{formatPesos(f.patronales)}</td>
                <td className="table-cell text-right figure text-xs">{formatPesos((BigInt(f.provisiones.aguinaldo) + BigInt(f.provisiones.patronalAguinaldo)).toString())}</td>
                <td className="table-cell text-right figure text-xs">{formatPesos(f.provisiones.salarioVacacional)}</td>
                <td className="table-cell text-right figure text-sm font-bold text-brand-700">{formatPesos(f.costoTotal)}</td>
              </tr>
            ))}
            {data.totales && (
              <tr className="bg-brand-50/60 font-bold">
                <td className="table-cell text-ink">Total ({data.filas.length} personas)</td>
                <td className="table-cell text-right figure text-xs">{formatPesos(data.totales.haberes)}</td>
                <td className="table-cell text-right figure text-xs">{formatPesos(data.totales.liquido)}</td>
                <td className="table-cell text-right figure text-xs">{formatPesos(data.totales.patronales)}</td>
                <td className="table-cell text-right figure text-xs" colSpan={2}>{formatPesos(data.totales.provisiones)}</td>
                <td className="table-cell text-right figure text-sm text-brand-700">{formatPesos(data.totales.costoTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Descarga un blob como archivo.
function descargarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Planilla de pagos al banco ─────────────────────────────────────────
function PagosBanco({ data, loading, companyId, year, month }: {
  data?: PagosBancoReport; loading: boolean; companyId: string; year: number; month: number;
}) {
  const mm = String(month).padStart(2, '0');
  const bajar = async (formato: 'xlsx' | 'brou' | 'csv') => {
    try {
      const blob = await reportsApi.pagosBancoArchivo(companyId, year, month, formato);
      const ext = formato === 'xlsx' ? 'xlsx' : formato === 'brou' ? 'txt' : 'csv';
      descargarBlob(blob, `pagos_${formato}_${mm}${year}.${ext}`);
    } catch {
      alert('No se pudo generar el archivo. ¿El período tiene liquidaciones confirmadas?');
    }
  };
  if (loading) return <div className="text-center py-12 text-gray-400">Cargando...</div>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => bajar('xlsx')} className="btn-primary btn-sm"><Download size={14} /> Excel (planilla genérica)</button>
        <button onClick={() => bajar('brou')} className="btn-secondary btn-sm"><Download size={14} /> TXT multipago BROU</button>
        <button onClick={() => bajar('csv')} className="btn-secondary btn-sm"><Download size={14} /> CSV genérico</button>
        <span className="text-xs text-gray-400">Si tu banco exige un layout exacto, mandanos su plantilla y la replicamos (como la nómina BPS).</span>
      </div>
      {data?.avisos?.map((a, i) => (
        <div key={i} className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          <AlertCircle size={15} className="flex-shrink-0" /> {a}
        </div>
      ))}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left">Persona</th>
                <th className="px-4 py-3 text-left">CI</th>
                <th className="px-4 py-3 text-left">Banco</th>
                <th className="px-4 py-3 text-left">Sucursal</th>
                <th className="px-4 py-3 text-left">Cuenta</th>
                <th className="px-4 py-3 text-left">Moneda</th>
                <th className="px-4 py-3 text-right">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {!data?.filas?.length ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">Sin liquidaciones confirmadas en el período</td></tr>
              ) : data.filas.map((f) => (
                <tr key={f.employeeId} className={`hover:bg-gray-50 ${f.sinCuenta ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-4 py-2.5 text-sm text-gray-800">{f.nombre}</td>
                  <td className="px-4 py-2.5 text-xs font-mono">{f.ci}</td>
                  <td className="px-4 py-2.5 text-xs">{f.banco || <span className="text-amber-600">sin banco</span>}</td>
                  <td className="px-4 py-2.5 text-xs">{f.sucursal || '—'}</td>
                  <td className="px-4 py-2.5 text-xs font-mono">{f.cuenta || <span className="text-amber-600">sin cuenta</span>}</td>
                  <td className="px-4 py-2.5 text-xs">{f.moneda}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">{f.liquidoPesos.toLocaleString('es-UY')}</td>
                </tr>
              ))}
              {!!data?.filas?.length && (
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-2.5 text-sm" colSpan={6}>TOTAL a acreditar ({data.filas.length} personas · {data.confirmadas} liquidaciones)</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">{data.totalPesos.toLocaleString('es-UY')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-gray-400">Importes = líquido a cobrar del período (liquidaciones confirmadas: mensualidad + aguinaldo + licencia + final), redondeados al peso como el recibo.</p>
    </div>
  );
}

// ── Asiento contable del mes ───────────────────────────────────────────
function AsientoContable({ data, loading, companyId, year, month }: {
  data?: AsientoReport; loading: boolean; companyId: string; year: number; month: number;
}) {
  const bajar = async (formato: 'xlsx' | 'txt' = 'xlsx') => {
    try {
      const blob = formato === 'txt'
        ? await reportsApi.asientoTxt(companyId, year, month)
        : await reportsApi.asientoExcel(companyId, year, month);
      descargarBlob(blob, `asiento_sueldos_${String(month).padStart(2, '0')}${year}.${formato}`);
    } catch {
      alert('No se pudo generar el asiento. ¿El período tiene liquidaciones confirmadas?');
    }
  };
  if (loading) return <div className="text-center py-12 text-gray-400">Cargando...</div>;
  const p = (v?: string) => (v && v !== '0' ? formatPesos(v) : '');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => bajar('xlsx')} className="btn-primary btn-sm"><Download size={14} /> Exportar a Excel</button>
        <button onClick={() => bajar('txt')} className="btn-secondary btn-sm"><Download size={14} /> TXT (sistema contable)</button>
        {data && !data.balanceado && (
          <span className="text-sm text-red-600 font-medium">⚠ El asiento no balancea — revisá las liquidaciones del período.</span>
        )}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-3 text-left">Cuenta</th>
              <th className="px-4 py-3 text-right">Debe</th>
              <th className="px-4 py-3 text-right">Haber</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {!data?.lineas?.length ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-400">Sin liquidaciones confirmadas en el período</td></tr>
            ) : (
              <>
                {data.lineas.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className={`px-4 py-2.5 text-sm ${l.haber !== '0' ? 'pl-10 text-gray-600' : 'text-gray-800'}`}>{l.cuenta}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm">{p(l.debe)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm">{p(l.haber)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-4 py-2.5 text-sm">TOTALES {data.balanceado ? '✓ balanceado' : ''}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">{formatPesos(data.totalDebe)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm">{formatPesos(data.totalHaber)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Devengamiento del período sobre liquidaciones confirmadas: al Debe "Sueldos y jornales" (incluye aguinaldo, licencias y
        salario vacacional; las faltas ya restan), la IPD y las cargas patronales — abiertos por la cuenta de sueldos del contrato
        (centro de costos) si está definida; al Haber las remuneraciones a pagar (líquidos), BPS obrero y patronal, IRPF, BSE, los
        adelantos ya entregados y otras retenciones.
      </p>
    </div>
  );
}
