import { useState, ChangeEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';
import { importApi, ImportResult } from '../services/api';
import { useCompany } from '../hooks/useCompany';

const CAMPOS_REQUERIDOS = ['ci', 'nombre', 'apellido', 'fechaIngreso', 'salarioNominal'];
const CAMPO_LABEL: Record<string, string> = {
  ci: 'Cédula', nombre: 'Nombre', apellido: 'Apellido', fechaNacimiento: 'Fecha nac.',
  email: 'Email', telefono: 'Teléfono', fechaIngreso: 'Fecha ingreso', salarioNominal: 'Salario', cargo: 'Cargo',
};

export default function ImportPage() {
  const { activeCompanyId, companies } = useCompany();
  const empresa = companies.find((c) => c.companyId === activeCompanyId);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState('');

  const previewMutation = useMutation({
    mutationFn: (f: File) => importApi.personas(activeCompanyId, f, false),
    onSuccess: (r) => { setResult(r); setCommitted(false); setError(''); },
    onError: (e: unknown) => setError(msg(e)),
  });

  const commitMutation = useMutation({
    mutationFn: (f: File) => importApi.personas(activeCompanyId, f, true),
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
        <p className="text-gray-500 text-sm">Cargá un Excel o CSV para dar de alta varias personas y su primer contrato en <b>{empresa?.nombreFantasia || empresa?.razonSocial || 'la empresa activa'}</b>.</p>
      </div>

      {/* Instrucciones */}
      <div className="card p-4 text-sm text-gray-600 bg-blue-50/40 border-blue-100">
        <p className="font-medium text-gray-700 mb-1">Columnas reconocidas (por encabezado):</p>
        <p><b>Requeridas:</b> Cédula, Nombre, Apellido, Fecha de ingreso, Salario.</p>
        <p><b>Opcionales:</b> Fecha de nacimiento, Email, Teléfono, Cargo.</p>
        <p className="text-xs text-gray-400 mt-1">Fechas en formato DD/MM/AAAA o AAAA-MM-DD. El salario en pesos. Las cédulas se validan por dígito verificador.</p>
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
          disabled={!file || !activeCompanyId || previewMutation.isPending}
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
    </div>
  );
}

function msg(e: unknown): string {
  const err = e as { response?: { data?: { error?: string } } };
  return err.response?.data?.error || 'Error al procesar el archivo';
}
