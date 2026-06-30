import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, BarChart2, FileText, Shield } from 'lucide-react';
import { reportsApi } from '../services/api';
import { useCompany } from '../hooks/useCompany';
import { formatPesos, MESES, NominaItem } from '../types';

export default function ReportsPage() {
  const { activeCompanyId: companyId } = useCompany();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activeReport, setActiveReport] = useState<'nomina' | 'bps' | 'irpf'>('nomina');

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
          { key: 'nomina', label: 'Nómina Mensual', icon: FileText },
          { key: 'bps', label: 'BPS (C1)', icon: Shield },
          { key: 'irpf', label: 'IRPF Anual', icon: BarChart2 },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveReport(key as 'nomina' | 'bps' | 'irpf')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeReport === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

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
                    const fonasa = item.descuentos.find((d) => d.concepto === 'FONASA')?.amount ?? '0';
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
