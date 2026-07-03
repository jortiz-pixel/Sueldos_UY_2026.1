import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Download, FileText, Landmark, FileDiff } from 'lucide-react';
import { liquidationApi, nominaApi } from '../services/api';
import { useCompany } from '../hooks/useCompany';
import { MESES } from '../types';

// Página "Nómina BPS": vista previa y descarga del archivo de declaración
// nominada (formato ATYR v3.0) del período seleccionado.
export default function NominaPage() {
  const { activeCompanyId: companyId } = useCompany();
  const [periodKey, setPeriodKey] = useState(''); // "year-month"
  const [modo, setModo] = useState<'nomina' | 'rectificativa'>('nomina');
  const [descargando, setDescargando] = useState(false);

  const { data: periods } = useQuery({
    queryKey: ['periods', companyId],
    queryFn: () => liquidationApi.listPeriods({ companyId }),
    enabled: !!companyId,
  });

  const [yearStr, monthStr] = periodKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  const { data: preview, isLoading, error } = useQuery({
    queryKey: ['nomina-preview', companyId, year, month],
    queryFn: () => nominaApi.preview(companyId, year, month),
    enabled: !!companyId && !!periodKey && modo === 'nomina',
  });

  const { data: rect, isLoading: rectLoading, error: rectError } = useQuery({
    queryKey: ['rect-preview', companyId, year, month],
    queryFn: () => nominaApi.rectPreview(companyId, year, month),
    enabled: !!companyId && !!periodKey && modo === 'rectificativa',
  });

  const descargar = async () => {
    const filename = modo === 'nomina' ? preview?.filename : rect?.filename;
    if (!filename) return;
    setDescargando(true);
    try {
      const blob = modo === 'nomina'
        ? await nominaApi.archivo(companyId, year, month)
        : await nominaApi.rectArchivo(companyId, year, month);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || 'No se pudo generar el archivo.');
    } finally {
      setDescargando(false);
    }
  };

  const bloqueada = modo === 'nomina'
    ? (!preview || preview.errores.length > 0)
    : (!rect || rect.errores.length > 0 || rect.diferencias.length === 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink font-brand">Nómina BPS</h1>
          <p className="text-ink-subtle text-sm mt-0.5">
            Declaración nominada — formato ATYR v3.0 (archivo para presentar en BPS)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            className="form-input w-auto"
          >
            <option value="">— Elegir período —</option>
            {periods?.map((p) => (
              <option key={p.id} value={`${p.year}-${p.month}`}>
                {MESES[p.month]} {p.year} · {p.status}
              </option>
            ))}
          </select>
          <button onClick={descargar} disabled={bloqueada || descargando} className="btn-primary">
            <Download size={16} />
            {descargando ? 'Generando…' : 'Descargar archivo'}
          </button>
        </div>
      </div>

      {/* Tipo de declaración */}
      <div className="flex gap-1 bg-canvas p-1 rounded-lg w-fit">
        {([
          { key: 'nomina', label: 'Nómina (N)', icon: Landmark },
          { key: 'rectificativa', label: 'Rectificativa (R)', icon: FileDiff },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setModo(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              modo === key ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {!periodKey ? (
        <div className="card p-10 text-center text-ink-subtle">
          <Landmark size={32} className="mx-auto mb-3 text-ink-subtle/50" />
          Elegí un período para previsualizar.
        </div>
      ) : modo === 'rectificativa' ? (
        rectLoading ? (
          <div className="card p-10 text-center text-ink-subtle">Comparando contra lo declarado…</div>
        ) : rectError ? (
          <div className="card p-4 flex items-center gap-2 text-sm text-bad">
            <AlertCircle size={16} />
            {(rectError as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error al calcular la rectificativa.'}
          </div>
        ) : rect && (
          <>
            {rect.errores.length > 0 && (
              <div className="card p-4 border-bad/30 bg-bad-bg/40">
                <div className="flex items-start gap-3">
                  <AlertCircle size={18} className="text-bad shrink-0 mt-0.5" />
                  <ul className="text-sm text-ink-muted list-disc pl-4 space-y-0.5">
                    {rect.errores.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              </div>
            )}
            {rect.declaradaAt && (
              <div className="card p-3 text-sm text-ink-muted flex items-center gap-2 flex-wrap">
                <FileText size={15} className="text-brand-600" />
                Nómina declarada el {new Date(rect.declaradaAt).toLocaleString('es-UY')}
                {rect.rectificativasPrevias > 0 && ` · ${rect.rectificativasPrevias} rectificativa(s) ya emitida(s)`}
                {rect.diferencias.length > 0 && (
                  <span className="ml-auto">
                    <span className="text-ink-subtle">Monto de la rectificativa: </span>
                    <span className="figure font-semibold text-ink">$ {Number(rect.montoTotal).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span>
                  </span>
                )}
              </div>
            )}
            {rect.advertencias.length > 0 && (
              <div className="card p-4 border-warn/40 bg-warn-bg/40">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
                  <ul className="text-sm text-ink-muted list-disc pl-4 space-y-0.5">
                    {rect.advertencias.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {rect.diferencias.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-hairline">
                  <h2 className="text-sm font-semibold text-ink">Diferencias contra lo declarado</h2>
                  <p className="text-xs text-ink-subtle mt-0.5">Cada diferencia se declara con el concepto prefijado: 1X suma · 2X resta</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="table-header">
                        <th className="px-4 py-3 text-left">Persona</th>
                        <th className="px-4 py-3 text-right">Concepto</th>
                        <th className="px-4 py-3 text-right">Declarado</th>
                        <th className="px-4 py-3 text-right">Actual</th>
                        <th className="px-4 py-3 text-right">Diferencia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline/60">
                      {rect.diferencias.flatMap((d) =>
                        d.conceptos.map((c, i) => (
                          <tr key={`${d.doc}-${c.codigo}`} className="hover:bg-canvas/60">
                            <td className="table-cell text-sm">
                              {i === 0 ? (
                                <>
                                  {d.nombre}
                                  {d.omitida && <span className="badge-yellow ml-2 text-[10px]">Omitida en la N</span>}
                                </>
                              ) : ''}
                            </td>
                            <td className="table-cell text-right"><span className="badge-blue">{c.codigo}</span></td>
                            <td className="table-cell text-right figure text-xs text-ink-subtle">$ {Number(c.declarado).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</td>
                            <td className="table-cell text-right figure text-xs">$ {Number(c.actual).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</td>
                            <td className={`table-cell text-right figure text-sm font-semibold ${Number(c.delta) >= 0 ? 'text-ok' : 'text-bad'}`}>
                              {Number(c.delta) >= 0 ? '+' : ''}{Number(c.delta).toLocaleString('es-UY', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {rect.lineas.length > 0 && (
              <details className="card p-4">
                <summary className="text-sm font-medium text-ink-muted cursor-pointer">Ver contenido del archivo ({rect.lineas.length} líneas)</summary>
                <pre className="mt-3 p-3 bg-navy text-white/90 rounded-lg text-[11px] leading-relaxed overflow-x-auto">{rect.lineas.join('\n')}</pre>
              </details>
            )}
          </>
        )
      ) : isLoading ? (
        <div className="card p-10 text-center text-ink-subtle">Generando vista previa…</div>
      ) : error ? (
        <div className="card p-4 flex items-center gap-2 text-sm text-bad">
          <AlertCircle size={16} />
          {(error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error al generar la vista previa.'}
        </div>
      ) : preview && (
        <>
          {preview.errores.length > 0 && (
            <div className="card p-4 border-bad/30 bg-bad-bg/40">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="text-bad shrink-0 mt-0.5" />
                <div className="text-sm text-ink-muted">
                  <p className="font-semibold text-ink mb-1">Corregí esto antes de generar el archivo:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {preview.errores.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}
          {preview.advertencias.length > 0 && (
            <div className="card p-4 border-warn/40 bg-warn-bg/40">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
                <ul className="text-sm text-ink-muted list-disc pl-4 space-y-0.5">
                  {preview.advertencias.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* Resumen tipo "Declaración al Sistema de Recaudación Nominada" */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-hairline flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <FileText size={16} className="text-brand-600" />
                <span className="font-mono text-xs">{preview.filename}</span>
              </div>
              <p className="text-sm">
                <span className="text-ink-subtle">Total monto imponible: </span>
                <span className="figure font-semibold text-ink">$ {Number(preview.montoTotal).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="table-header">
                    <th className="px-4 py-3 text-left">Documento</th>
                    <th className="px-4 py-3 text-left">Apellido y nombre</th>
                    <th className="px-4 py-3 text-right">DT</th>
                    <th className="px-4 py-3 text-right">VF</th>
                    <th className="px-4 py-3 text-right">SS</th>
                    <th className="px-4 py-3 text-left">Conceptos (cód. BPS)</th>
                    <th className="px-4 py-3 text-left">Egreso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline/60">
                  {preview.personas.map((p) => (
                    <tr key={p.ci} className="hover:bg-canvas/60">
                      <td className="table-cell font-mono text-xs">{p.ci}</td>
                      <td className="table-cell text-sm">{p.nombre}</td>
                      <td className="table-cell text-right figure text-xs">{p.diasTrabajados}</td>
                      <td className="table-cell text-right figure text-xs">{p.vinculoFuncional ?? '—'}</td>
                      <td className="table-cell text-right figure text-xs">{p.seguroSalud ?? '—'}</td>
                      <td className="table-cell text-xs">
                        {p.conceptos.map((c) => (
                          <span key={c.codigo} className="inline-flex items-center gap-1 mr-3">
                            <span className="badge-blue">{c.codigo}</span>
                            <span className="figure">$ {Number(c.monto).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span>
                          </span>
                        ))}
                      </td>
                      <td className="table-cell text-xs">
                        {p.egreso ? `Causal ${p.egreso.causal} · ${p.egreso.fecha.replace(/(\d{2})(\d{2})(\d{4})/, '$1/$2/$3')}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Contenido del archivo (solo si no hay errores) */}
          {preview.lineas.length > 0 && (
            <details className="card p-4">
              <summary className="text-sm font-medium text-ink-muted cursor-pointer">Ver contenido del archivo ({preview.lineas.length} líneas)</summary>
              <pre className="mt-3 p-3 bg-navy text-white/90 rounded-lg text-[11px] leading-relaxed overflow-x-auto">{preview.lineas.join('\n')}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
