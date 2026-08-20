import { useState, ChangeEvent } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Download, FileText, Landmark, FileDiff, ShieldCheck, Upload, Scale, HardHat } from 'lucide-react';
import { liquidationApi, nominaApi, companiesApi, ComparacionNomina, FocerPreview } from '../services/api';
import { useCompany } from '../hooks/useCompany';
import { MESES } from '../types';

// FOCER se declara solo en el Grupo 9 · Subgrupo 1 (industria de la construcción).
function esEmpresaFocer(co?: { grupoActividadNum?: number | null; subgrupo?: string | null } | null): boolean {
  if (!co || co.grupoActividadNum !== 9) return false;
  const sub = (co.subgrupo ?? '').trim();
  if (!sub) return true;
  const m = /(\d{1,2})/.exec(sub);
  return m ? Number(m[1]) === 1 : true;
}

// Página "Nómina BPS": vista previa y descarga del archivo de declaración
// nominada (formato ATYR v3.0) del período seleccionado.
export default function NominaPage() {
  const { activeCompanyId: companyId } = useCompany();
  const [periodKey, setPeriodKey] = useState(''); // "year-month"
  const [modo, setModo] = useState<'nomina' | 'rectificativa' | 'verificar' | 'focer'>('nomina');
  const [descargando, setDescargando] = useState(false);
  const [verifFile, setVerifFile] = useState<File | null>(null);

  const { data: periods } = useQuery({
    queryKey: ['periods', companyId],
    queryFn: () => liquidationApi.listPeriods({ companyId }),
    enabled: !!companyId,
  });

  const { data: company } = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => companiesApi.get(companyId),
    enabled: !!companyId,
  });
  const companyEsFocer = esEmpresaFocer(company);

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

  const { data: focer, isLoading: focerLoading, error: focerError } = useQuery({
    queryKey: ['focer-preview', companyId, year, month],
    queryFn: () => nominaApi.focerPreview(companyId, year, month),
    enabled: !!companyId && !!periodKey && modo === 'focer',
  });

  const verificarMutation = useMutation({
    mutationFn: (file: File) => nominaApi.verificar(companyId, year, month, file),
  });
  const onVerifFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setVerifFile(f);
    verificarMutation.reset();
  };

  const descargar = async () => {
    const filename = modo === 'nomina' ? preview?.filename : modo === 'focer' ? focer?.filename : rect?.filename;
    if (!filename) return;
    setDescargando(true);
    try {
      const blob = modo === 'nomina'
        ? await nominaApi.archivo(companyId, year, month)
        : modo === 'focer'
        ? await nominaApi.focerArchivo(companyId, year, month)
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
    : modo === 'focer'
    ? (!focer || focer.errores.length > 0)
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
          {modo !== 'verificar' && (
            <button onClick={descargar} disabled={bloqueada || descargando} className="btn-primary">
              <Download size={16} />
              {descargando ? 'Generando…' : 'Descargar archivo'}
            </button>
          )}
        </div>
      </div>

      {/* Tipo de declaración */}
      <div className="flex gap-1 bg-canvas p-1 rounded-lg w-fit">
        {([
          { key: 'nomina', label: 'Nómina (N)', icon: Landmark },
          { key: 'rectificativa', label: 'Rectificativa (R)', icon: FileDiff },
          { key: 'verificar', label: 'Verificación', icon: ShieldCheck },
          ...(companyEsFocer ? [{ key: 'focer', label: 'FOCER', icon: HardHat }] as const : []),
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
      ) : modo === 'verificar' ? (
        <VerificacionPanel
          file={verifFile}
          onFile={onVerifFile}
          onVerificar={() => verifFile && verificarMutation.mutate(verifFile)}
          loading={verificarMutation.isPending}
          error={(verificarMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error}
          resultado={verificarMutation.data ?? null}
        />
      ) : modo === 'focer' ? (
        focerLoading ? (
          <div className="card p-10 text-center text-ink-subtle">Calculando FOCER…</div>
        ) : focerError ? (
          <div className="card p-4 flex items-center gap-2 text-sm text-bad">
            <AlertCircle size={16} />
            {(focerError as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Error al calcular el FOCER.'}
          </div>
        ) : focer && (
          <FocerPanel focer={focer} />
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

// ── Panel de VERIFICACIÓN / CONCILIACIÓN ────────────────────────────
const fmt = (s: string) => Number(s).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function VerificacionPanel({ file, onFile, onVerificar, loading, error, resultado }: {
  file: File | null;
  onFile: (e: ChangeEvent<HTMLInputElement>) => void;
  onVerificar: () => void;
  loading: boolean;
  error?: string;
  resultado: ComparacionNomina | null;
}) {
  const ESTADO: Record<string, { label: string; badge: string }> = {
    ok: { label: 'Coincide', badge: 'badge-green' },
    diferencia: { label: 'Diferencia', badge: 'badge-red' },
    solo_archivo: { label: 'Solo en el archivo', badge: 'badge-yellow' },
    solo_liquidacion: { label: 'Solo en liquidaciones', badge: 'badge-yellow' },
  };

  return (
    <div className="space-y-4">
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck size={16} className="text-brand-600" /> Verificar la nómina procesada contra las liquidaciones del mes
        </div>
        <p className="text-sm text-ink-subtle">
          Subí el archivo de nómina ya procesado (el .bps/.txt que presentás en BPS) y el sistema lo compara,
          persona por persona y concepto por concepto, con lo que surge de las liquidaciones confirmadas del período.
          No modifica nada.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="btn-secondary cursor-pointer">
            <Upload size={16} /> Elegir archivo de nómina
            <input type="file" accept=".txt,.bps" className="hidden" onChange={onFile} />
          </label>
          <span className="text-sm text-ink-muted">{file ? file.name : 'Ningún archivo seleccionado'}</span>
          <button onClick={onVerificar} disabled={!file || loading} className="btn-primary">
            <Scale size={16} /> {loading ? 'Comparando…' : 'Verificar'}
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-2 p-3 bg-bad-bg border border-bad/30 rounded-lg text-sm text-bad">
            <AlertCircle size={16} /> {error}
          </div>
        )}
      </div>

      {resultado && (
        <>
          {resultado.errores.length > 0 && (
            <div className="card p-4 border-bad/30 bg-bad-bg/40 text-sm text-ink-muted">
              <ul className="list-disc pl-4 space-y-0.5">{resultado.errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          {resultado.advertencias.length > 0 && (
            <div className="card p-4 border-warn/40 bg-warn-bg/40 text-sm text-ink-muted">
              <ul className="list-disc pl-4 space-y-0.5">{resultado.advertencias.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}

          {/* Resumen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Coinciden', val: resultado.resumen.coinciden, cls: 'text-ok' },
              { label: 'Con diferencias', val: resultado.resumen.conDiferencias, cls: 'text-bad' },
              { label: 'Solo en el archivo', val: resultado.resumen.soloArchivo, cls: 'text-warn' },
              { label: 'Solo en liquidaciones', val: resultado.resumen.soloLiquidacion, cls: 'text-warn' },
            ].map((c) => (
              <div key={c.label} className="card p-4 text-center">
                <p className={`figure text-2xl font-bold ${c.cls}`}>{c.val}</p>
                <p className="text-xs text-ink-subtle mt-1">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Aportes del mes (referencia para la factura BPS) */}
          <div className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink mb-3">
              <Landmark size={16} className="text-brand-600" /> Aportes del mes (lo que BPS debería facturar)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Dato label="Jubilatorio obrero" val={resultado.aportes.obreroJubilatorio} />
              <Dato label="FONASA obrero" val={resultado.aportes.obreroFonasa} />
              <Dato label="FRL obrero" val={resultado.aportes.obreroFrl} />
              <Dato label="IRPF" val={resultado.aportes.irpf} />
              <Dato label="Total obrero" val={resultado.aportes.totalObrero} />
              <Dato label="Patronales" val={resultado.aportes.patronal} />
              <Dato label="TOTAL BPS (obrero + patronal)" val={resultado.aportes.totalBps} fuerte />
            </div>
            <p className="text-[11px] text-ink-subtle mt-2">
              Compará estos totales con tu factura de BPS. (El IRPF se retiene y vierte a DGI, no va en la factura BPS.)
            </p>
          </div>

          {/* Detalle por persona */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-hairline text-sm font-semibold text-ink">Detalle por persona</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-header">
                    <th className="px-4 py-2 text-left">Persona</th>
                    <th className="px-4 py-2 text-left">Estado</th>
                    <th className="px-4 py-2 text-left">Diferencias</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline/60">
                  {resultado.personas.map((p) => (
                    <tr key={p.ci} className={p.estado === 'diferencia' ? 'bg-bad-bg/20' : ''}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-ink">{p.nombre}</p>
                        <p className="text-xs text-ink-subtle font-mono">{p.ci}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={ESTADO[p.estado].badge}>{ESTADO[p.estado].label}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {p.estado === 'ok' && p.diferencias.length === 0 && <span className="text-ink-subtle text-xs">—</span>}
                        {p.estado === 'ok' && p.diferencias.length > 0 && (
                          <span className="text-xs text-ink-subtle">Solo redondeo (±$1)</span>
                        )}
                        {p.estado === 'solo_archivo' && <span className="text-xs text-ink-subtle">Está en el archivo pero no tiene liquidación confirmada.</span>}
                        {p.estado === 'solo_liquidacion' && <span className="text-xs text-ink-subtle">Tiene liquidación pero no figura en el archivo.</span>}
                        {p.diferencias.length > 0 && p.estado === 'diferencia' && (
                          <ul className="space-y-0.5">
                            {p.diferencias.map((d, i) => (
                              <li key={i} className={`text-xs ${d.redondeo ? 'text-ink-subtle' : 'text-bad'}`}>
                                <b>{d.campo}:</b> archivo {d.campo.startsWith('Días') || d.campo.startsWith('Seguro') ? d.archivo : `$${fmt(d.archivo)}`} · sistema {d.campo.startsWith('Días') || d.campo.startsWith('Seguro') ? d.sistema : `$${fmt(d.sistema)}`}
                                {d.delta && ` (Δ ${d.campo.startsWith('Días') ? d.delta : `$${fmt(d.delta)}`})`}
                                {d.redondeo && ' — redondeo'}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Dato({ label, val, fuerte }: { label: string; val: string; fuerte?: boolean }) {
  return (
    <div className={`p-3 rounded-lg ${fuerte ? 'bg-brand-50 col-span-2 md:col-span-1' : 'bg-canvas/70'}`}>
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className={`figure font-semibold ${fuerte ? 'text-brand-700' : 'text-ink'}`}>$ {fmt(val)}</p>
    </div>
  );
}

// ── Panel FOCER (Fondo de Cesantía y Retiro de la construcción) ─────
function FocerPanel({ focer }: { focer: FocerPreview }) {
  return (
    <div className="space-y-4">
      {focer.errores.length > 0 && (
        <div className="card p-4 border-bad/30 bg-bad-bg/40">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-bad shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-ink mb-1 text-sm">Corregí esto antes de generar el archivo FOCER:</p>
              <ul className="text-sm text-ink-muted list-disc pl-4 space-y-0.5">
                {focer.errores.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
      {focer.advertencias.length > 0 && (
        <div className="card p-4 border-warn/40 bg-warn-bg/40">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
            <ul className="text-sm text-ink-muted list-disc pl-4 space-y-0.5">
              {focer.advertencias.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="card p-4 flex items-center gap-4 flex-wrap text-sm">
        <div className="flex items-center gap-2">
          <HardHat size={16} className="text-brand-600" />
          <span className="font-mono text-xs">{focer.filename}</span>
        </div>
        <div className="ml-auto flex items-center gap-5">
          <span><span className="text-ink-subtle">Total gravado: </span><span className="figure font-semibold text-ink">$ {fmt(focer.totalGravado)}</span></span>
          <span><span className="text-ink-subtle">Total FOCER (5%): </span><span className="figure font-semibold text-brand-700">$ {fmt(focer.totalFocer)}</span></span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-hairline text-sm font-semibold text-ink">Detalle por trabajador</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-2 text-left">Trabajador</th>
                <th className="px-4 py-2 text-right">Jornales</th>
                <th className="px-4 py-2 text-right">Gravado jornales</th>
                <th className="px-4 py-2 text-right">Resto gravado</th>
                <th className="px-4 py-2 text-right">Total gravado</th>
                <th className="px-4 py-2 text-right">FOCER 5%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {focer.empleados.map((e) => (
                <tr key={e.ci}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-ink">{e.nombre}</p>
                    <p className="text-xs text-ink-subtle font-mono">{e.ci}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right figure">{e.jornales ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right figure text-ink-muted">{fmt(e.gravadoJornales)}</td>
                  <td className="px-4 py-2.5 text-right figure text-ink-muted">{fmt(e.restoGravado)}</td>
                  <td className="px-4 py-2.5 text-right figure text-ink">{fmt(e.totalGravado)}</td>
                  <td className="px-4 py-2.5 text-right figure font-semibold text-brand-700">{fmt(e.focer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {focer.lineas.length > 0 && (
        <details className="card p-4">
          <summary className="text-sm font-medium text-ink-muted cursor-pointer">Ver contenido del archivo ({focer.lineas.length} líneas)</summary>
          <pre className="mt-3 p-3 bg-navy text-white/90 rounded-lg text-[11px] leading-relaxed overflow-x-auto">{focer.lineas.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
