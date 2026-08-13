import { useState, ChangeEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight, Download, Landmark, FlaskConical } from 'lucide-react';
import { importApi, ImportResult, nominaApi, NominaImportPlan, demoApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';

async function descargarPlantilla() {
  const blob = await importApi.plantilla();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla_personas.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CAMPOS_REQUERIDOS = ['ci', 'nombre', 'apellido', 'fechaIngreso', 'salarioNominal'];
const CAMPO_LABEL: Record<string, string> = {
  ci: 'Cédula', nombre: 'Nombre', apellido: 'Apellido', fechaNacimiento: 'Fecha nac.',
  email: 'Email', telefono: 'Teléfono', fechaIngreso: 'Fecha ingreso', salarioNominal: 'Salario', cargo: 'Cargo',
};

export default function ImportPage() {
  const { activeCompanyId, companies } = useCompany();
  const [targetCompanyId, setTargetCompanyId] = useState('');
  const companyId = targetCompanyId || activeCompanyId;
  const empresa = companies.find((c) => c.companyId === companyId);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState('');

  const previewMutation = useMutation({
    mutationFn: (f: File) => importApi.personas(companyId, f, false),
    onSuccess: (r) => { setResult(r); setCommitted(false); setError(''); },
    onError: (e: unknown) => setError(msg(e)),
  });

  const commitMutation = useMutation({
    mutationFn: (f: File) => importApi.personas(companyId, f, true),
    onSuccess: (r) => { setResult(r); setCommitted(true); setError(''); },
    onError: (e: unknown) => setError(msg(e)),
  });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setResult(null); setCommitted(false); setError('');
  };

  const mapeo = result?.mapeo ?? {};
  const faltantes = CAMPOS_REQUERIDOS.filter((c) => !mapeo[c]);

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Importar personas</h1>
        <p className="text-gray-500 text-sm">Cargá un Excel o CSV para dar de alta varias personas y su primer contrato.</p>
      </div>

      {/* Empresa destino (explícita) */}
      <div className="card p-4">
        <label className="form-label">Importar a la empresa</label>
        <select
          value={companyId}
          onChange={(e) => { setTargetCompanyId(e.target.value); setResult(null); setCommitted(false); setError(''); }}
          className="form-input w-full md:w-96"
        >
          {companies.map((c) => (
            <option key={c.companyId} value={c.companyId}>{c.nombreFantasia || c.razonSocial}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">Las personas se crean en <b>{empresa?.nombreFantasia || empresa?.razonSocial || '—'}</b>. La misma cédula puede existir en otra empresa: solo se valida que no esté repetida en esta.</p>
      </div>

      {/* Instrucciones */}
      <div className="card p-4 text-sm text-gray-600 bg-blue-50/40 border-blue-100">
        <p className="font-medium text-gray-700 mb-1">Columnas reconocidas (por encabezado):</p>
        <p><b>Requeridas:</b> Cédula, Nombre, Apellido, Fecha de ingreso, Salario.</p>
        <p><b>Opcionales:</b> Fecha de nacimiento, Email, Teléfono, Cargo.</p>
        <p className="text-xs text-gray-400 mt-1">Fechas en formato DD/MM/AAAA o AAAA-MM-DD. El salario en pesos. Las cédulas se validan por dígito verificador.</p>
        <button type="button" onClick={descargarPlantilla} className="btn-secondary btn-sm mt-3">
          <Download size={14} /> Descargar plantilla de ejemplo
        </button>
      </div>

      {/* Paso 1: archivo */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <label className="btn-secondary cursor-pointer">
            <FileSpreadsheet size={16} /> Elegir archivo
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          </label>
          <span className="text-sm text-gray-600">{file ? file.name : 'Ningún archivo seleccionado'}</span>
        </div>
        <button
          onClick={() => file && previewMutation.mutate(file)}
          disabled={!file || !companyId || previewMutation.isPending}
          className="btn-primary"
        >
          <Upload size={16} /> {previewMutation.isPending ? 'Analizando…' : 'Previsualizar'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Paso 2: resultado */}
      {result && (
        <div className="card p-5 space-y-4">
          {/* Columnas detectadas */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Columnas detectadas</p>
            <div className="flex flex-wrap gap-2">
              {Object.keys(CAMPO_LABEL).map((c) => (
                <span key={c} className={`px-2 py-1 rounded-full text-xs font-medium ${mapeo[c] ? 'bg-green-50 text-green-700' : CAMPOS_REQUERIDOS.includes(c) ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                  {CAMPO_LABEL[c]}{mapeo[c] ? ` ← ${mapeo[c]}` : CAMPOS_REQUERIDOS.includes(c) ? ' (falta)' : ''}
                </span>
              ))}
            </div>
            {faltantes.length > 0 && (
              <p className="text-xs text-red-600 mt-2">Faltan columnas requeridas: {faltantes.map((f) => CAMPO_LABEL[f]).join(', ')}. Revisá los encabezados del archivo.</p>
            )}
          </div>

          {/* Resumen */}
          <div className="flex gap-4 text-sm">
            <span className="text-gray-600">Total: <b>{result.resumen.total}</b></span>
            <span className="text-green-700">Válidas: <b>{result.resumen.validas}</b></span>
            <span className="text-red-600">Con errores: <b>{result.resumen.conErrores}</b></span>
            {committed && <span className="text-blue-700">Creadas: <b>{result.resumen.creadas ?? 0}</b></span>}
          </div>

          {/* Tabla */}
          <div className="border border-gray-100 rounded-lg overflow-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Fila</th>
                  <th className="px-3 py-2 text-left">Cédula</th>
                  <th className="px-3 py-2 text-left">Nombre</th>
                  <th className="px-3 py-2 text-left">Ingreso</th>
                  <th className="px-3 py-2 text-right">Salario</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {result.filas.map((r) => (
                  <tr key={r.fila} className={r.errores.length ? 'bg-red-50/40' : ''}>
                    <td className="px-3 py-1.5 text-gray-400">{r.fila}</td>
                    <td className="px-3 py-1.5">{r.datos.ci}</td>
                    <td className="px-3 py-1.5">{r.datos.nombre} {r.datos.apellido}</td>
                    <td className="px-3 py-1.5">{r.datos.fechaIngreso || '—'}</td>
                    <td className="px-3 py-1.5 text-right">{r.datos.salarioNominal?.toLocaleString('es-UY') || '—'}</td>
                    <td className="px-3 py-1.5">
                      {r.errores.length === 0
                        ? <span className="inline-flex items-center gap-1 text-green-700 text-xs"><CheckCircle size={13} /> OK</span>
                        : <span className="text-red-600 text-xs">{r.errores.join('; ')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Confirmar */}
          {!committed && result.resumen.validas > 0 && (
            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              <p className="text-sm text-gray-500">Se importarán las <b>{result.resumen.validas}</b> filas válidas (las que tienen error se omiten).</p>
              <button
                onClick={() => file && commitMutation.mutate(file)}
                disabled={commitMutation.isPending || faltantes.length > 0}
                className="btn-primary"
              >
                {commitMutation.isPending ? 'Importando…' : <>Importar {result.resumen.validas} personas <ArrowRight size={16} /></>}
              </button>
            </div>
          )}

          {committed && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
              <CheckCircle size={16} /> Importación completada: se crearon {result.resumen.creadas ?? 0} personas.
            </div>
          )}
        </div>
      )}

      {/* ── Importar desde nómina BPS (migración desde GNS u otro software) ── */}
      <ImportarDesdeNomina />

      {/* ── Datos de prueba en la empresa Demo (solo ADMIN) ── */}
      <DatosDemo />
    </div>
  );
}

// Genera el plantel de prueba en la empresa Demo: 10 personas (mensuales y
// jornaleras, con distintas cargas FONASA), liquidaciones Ene–Jun 2026 con
// faltas/horas extra/licencia, aguinaldos y 3 egresos a mitad de junio.
function DatosDemo() {
  const { isAdmin } = useAuth();
  const [resumen, setResumen] = useState('');
  const seedMutation = useMutation({
    mutationFn: () => demoApi.seed(),
    onSuccess: (r) => {
      setResumen(
        `${r.empresa}: ${r.personasCreadas} personas creadas (${r.personasExistentes} ya existían) · `
        + `${r.liquidacionesGeneradas} liquidaciones · ${r.aguinaldos} aguinaldos · ${r.finales} finales`
        + (r.errores.length ? ` · ${r.errores.length} avisos: ${r.errores.slice(0, 3).join(' | ')}` : ''),
      );
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setResumen(msg || 'No se pudieron generar los datos de prueba.');
    },
  });
  if (!isAdmin) return null;
  return (
    <div className="card p-5 space-y-3 border-t-4 border-t-amber-400">
      <div>
        <h2 className="text-lg font-bold text-ink flex items-center gap-2">
          <FlaskConical size={18} className="text-amber-500" /> Datos de prueba (empresa Demo)
        </h2>
        <p className="text-sm text-ink-subtle mt-1">
          Genera 10 personas con contratos y sus liquidaciones de Ene–Jun 2026: mensuales y jornaleros,
          faltas, horas extra, licencia con salario vacacional, aguinaldos y 3 egresos a mitad de junio
          (voluntario, despido y término de contrato). Usa el mismo motor de cálculo que producción.
        </p>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} className="btn-primary">
          <FlaskConical size={16} /> {seedMutation.isPending ? 'Generando…' : 'Generar datos de prueba'}
        </button>
        {resumen && <span className="text-sm text-ink-subtle">{resumen}</span>}
      </div>
    </div>
  );
}

// Importa empresa + personas + contratos desde un archivo de nómina ATYR (.txt).
function ImportarDesdeNomina() {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<NominaImportPlan | null>(null);
  const [error, setError] = useState('');
  // Generar automáticamente las liquidaciones del mes a partir de la nómina.
  const [generarLiqs, setGenerarLiqs] = useState(true);

  const previewMutation = useMutation({
    mutationFn: (f: File) => nominaApi.importar(f, false),
    onSuccess: (r) => { setPlan(r); setError(''); },
    onError: (e: unknown) => setError(msg(e)),
  });
  const commitMutation = useMutation({
    mutationFn: ({ f, gen }: { f: File; gen: boolean }) => nominaApi.importar(f, true, gen),
    onSuccess: (r) => { setPlan(r); setError(''); },
    onError: (e: unknown) => setError(msg(e)),
  });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setPlan(null); setError('');
  };

  const ACCION: Record<string, string> = { crear: 'Se crea', actualizar: 'Se completan datos', existente: 'Ya existe' };

  return (
    <div className="card p-5 space-y-4 border-t-4 border-t-brand-600">
      <div>
        <h2 className="text-lg font-bold text-ink flex items-center gap-2">
          <Landmark size={18} className="text-brand-600" /> Importar desde nómina BPS
        </h2>
        <p className="text-sm text-ink-subtle mt-1">
          Subí un archivo de nómina ATYR (el .txt que genera GNS u otro software) y se crean la empresa,
          las personas y sus contratos con todos los códigos BPS (vínculo funcional, seguro de salud, horas semanales).
          Opcionalmente genera también las liquidaciones del mes con los días e importes de la nómina.
          Ideal para migrar un cliente en un paso.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="btn-secondary cursor-pointer">
          <FileSpreadsheet size={16} /> Elegir archivo de nómina
          <input type="file" accept=".txt,.bps" className="hidden" onChange={onFile} />
        </label>
        <span className="text-sm text-ink-muted">{file ? file.name : 'Ningún archivo seleccionado'}</span>
        <button
          onClick={() => file && previewMutation.mutate(file)}
          disabled={!file || previewMutation.isPending}
          className="btn-primary"
        >
          <Upload size={16} /> {previewMutation.isPending ? 'Analizando…' : 'Previsualizar'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-bad-bg border border-bad/30 rounded-lg text-sm text-bad">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {plan && (
        <div className="space-y-4">
          {plan.errores.length > 0 && (
            <div className="p-3 bg-bad-bg border border-bad/30 rounded-lg text-sm text-bad">
              <ul className="list-disc pl-4">{plan.errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          {plan.advertencias.length > 0 && (
            <div className="p-3 bg-warn-bg border border-warn/40 rounded-lg text-sm text-ink-muted">
              <ul className="list-disc pl-4">{plan.advertencias.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}

          {plan.empresa && (
            <div className="p-3 bg-canvas/70 rounded-lg text-sm">
              <p className="font-semibold text-ink">
                {plan.empresa.razonSocial} <span className="font-normal text-ink-subtle">· RUT {plan.empresa.rut} · BPS {plan.empresa.numeroBps}</span>
              </p>
              <p className="text-ink-muted">
                {ACCION[plan.empresa.accion]}{plan.mesCargo ? ` · nómina de ${String(plan.mesCargo.month).padStart(2, '0')}/${plan.mesCargo.year}` : ''}
              </p>
            </div>
          )}

          {plan.personas.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="table-header">
                    <th className="px-3 py-2 text-left">CI</th>
                    <th className="px-3 py-2 text-left">Persona</th>
                    <th className="px-3 py-2 text-left">Ficha</th>
                    <th className="px-3 py-2 text-left">Contrato</th>
                    <th className="px-3 py-2 text-left">Detalles</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline/60">
                  {plan.personas.map((p) => (
                    <tr key={p.ci} className={p.omitida ? 'opacity-60' : ''}>
                      <td className="px-3 py-2 font-mono text-xs">{p.ci}</td>
                      <td className="px-3 py-2 text-sm">{p.nombre}</td>
                      <td className="px-3 py-2 text-xs">
                        {p.omitida
                          ? <span className="badge-yellow">Omitida (baja)</span>
                          : <span className={p.accion === 'crear' ? 'badge-green' : 'badge-gray'}>{ACCION[p.accion]}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.omitida
                          ? <span className="text-ink-subtle">—</span>
                          : <span className={p.contrato === 'crear' ? 'badge-green' : 'badge-gray'}>{p.contrato === 'crear' ? 'Se crea' : 'Ya existe'}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-subtle">{p.detalles || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {plan.dryRun ? (
            plan.errores.length === 0 && (
              <div className="space-y-3">
                <label className="flex items-start gap-2 text-sm text-ink cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={generarLiqs}
                    onChange={(e) => setGenerarLiqs(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Generar automáticamente las liquidaciones del mes
                    {plan.mesCargo ? ` (${String(plan.mesCargo.month).padStart(2, '0')}/${plan.mesCargo.year})` : ''} a partir de la nómina.
                    <span className="block text-xs text-ink-subtle">
                      Se crean los recibos mensuales (borrador) con los días e importes de la nómina; después podés revisarlos y confirmarlos.
                    </span>
                  </span>
                </label>
                <button
                  onClick={() => file && commitMutation.mutate({ f: file, gen: generarLiqs })}
                  disabled={commitMutation.isPending}
                  className="btn-primary"
                >
                  <ArrowRight size={16} /> {commitMutation.isPending ? 'Importando…' : 'Confirmar importación'}
                </button>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 p-3 bg-ok-bg border border-ok/30 rounded-lg text-sm text-ink">
              <CheckCircle size={16} className="text-ok" />
              <span>
                Importación realizada.
                {plan.liquidacionesGeneradas > 0
                  ? ` Se generaron ${plan.liquidacionesGeneradas} liquidación(es) del mes (en borrador) — revisalas y confirmalas en Liquidaciones.`
                  : ' Revisá la empresa en el selector superior y su checklist en Personas.'}
                {plan.liquidacionesExistentes > 0
                  ? ` ${plan.liquidacionesExistentes} ya existían para el período y no se modificaron.`
                  : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function msg(e: unknown): string {
  const err = e as { response?: { data?: { error?: string } } };
  return err.response?.data?.error || 'Error al procesar el archivo';
}
