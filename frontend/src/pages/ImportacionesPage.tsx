import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ship, Plus, Trash2, Save, X, Pencil, FileDown, Download, Calculator, Paperclip, Upload, FileSpreadsheet, CheckCircle, AlertCircle, Settings, Coins } from 'lucide-react';
import { importacionesApi } from '../services/api';
import { useCompany } from '../hooks/useCompany';
import {
  Importacion, ImportacionPayload, ImportacionEstado, ImportacionRegimen,
  TributoTipo, GastoConcepto, MESES, ImportacionExtraido, TipoDocImportacion, EstadoProcDoc,
  ImportacionConfigPayload, CotizacionTipo,
} from '../types';

function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ESTADO_LABEL: Record<ImportacionEstado, string> = {
  BORRADOR: 'Borrador', EN_TRAMITE: 'En trámite', NACIONALIZADA: 'Nacionalizada',
  CERRADA: 'Cerrada', ANULADA: 'Anulada',
};
const ESTADO_BADGE: Record<ImportacionEstado, string> = {
  BORRADOR: 'badge-gray', EN_TRAMITE: 'badge-yellow', NACIONALIZADA: 'badge-green',
  CERRADA: 'badge-green', ANULADA: 'badge-gray',
};
const REGIMEN_LABEL: Record<ImportacionRegimen, string> = {
  DEFINITIVA: 'Definitiva', ADMISION_TEMPORARIA: 'Admisión temporaria',
  DEPOSITO: 'Depósito', TRANSITO: 'Tránsito', ZONA_FRANCA: 'Zona franca',
};
const TRIBUTO_LABEL: Record<TributoTipo, string> = {
  ARANCEL_TEC: 'Arancel / TEC', TASA_SERVICIOS: 'Tasa de servicios', IMESI: 'IMESI',
  IVA_IMPORTACION: 'IVA importación', ANTICIPO_IVA: 'Anticipo IVA', ANTICIPO_IRAE: 'Anticipo IRAE',
  RECARGO: 'Recargo', OTRO: 'Otro',
};
const GASTO_LABEL: Record<GastoConcepto, string> = {
  HONORARIOS_DESPACHANTE: 'Honorarios despachante', DEPOSITO: 'Depósito', MOVILIZACION: 'Movilización',
  GASTOS_BANCARIOS: 'Gastos bancarios', FLETE_INTERNO: 'Flete interno', SEGURO_LOCAL: 'Seguro local', OTRO: 'Otro',
};
const RECUPERABLE: TributoTipo[] = ['IVA_IMPORTACION', 'ANTICIPO_IVA', 'ANTICIPO_IRAE'];

const fmt = (ctms: string) =>
  '$ ' + (Number(ctms) / 100).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const c2p = (ctms: string) => Number(ctms) / 100;

type ItemForm = { descripcion: string; ncm: string; cantidad: number; fobUnitario: number };
type TributoForm = { tipo: TributoTipo; tasa: number; monto: number };
type GastoForm = { concepto: GastoConcepto; descripcion: string; monto: number; gravadoIva: boolean; ivaGasto: number };

interface FormState {
  regimen: ImportacionRegimen;
  proveedorExterior: string;
  paisOrigen: string;
  incoterm: string;
  monedaOrigen: string;
  tipoCambio: number;
  facturaComercialNro: string;
  facturaComercialFecha: string;
  duaNumero: string;
  duaFecha: string;
  despachante: string;
  aduana: string;
  transporteDoc: string;
  certificadoOrigen: boolean;
  fechaEmbarque: string;
  fechaArribo: string;
  fechaNacionalizacion: string;
  fob: number;
  flete: number;
  seguro: number;
  notas: string;
  items: ItemForm[];
  tributos: TributoForm[];
  gastos: GastoForm[];
}

function formVacio(): FormState {
  return {
    regimen: 'DEFINITIVA', proveedorExterior: '', paisOrigen: '', incoterm: 'FOB',
    monedaOrigen: 'USD', tipoCambio: 1, facturaComercialNro: '', facturaComercialFecha: '',
    duaNumero: '', duaFecha: '', despachante: '', aduana: '', transporteDoc: '',
    certificadoOrigen: false, fechaEmbarque: '', fechaArribo: '', fechaNacionalizacion: '',
    fob: 0, flete: 0, seguro: 0, notas: '',
    items: [], tributos: [], gastos: [],
  };
}

function desdeImportacion(imp: Importacion): FormState {
  return {
    regimen: imp.regimen,
    proveedorExterior: imp.proveedorExterior ?? '',
    paisOrigen: imp.paisOrigen ?? '',
    incoterm: imp.incoterm ?? '',
    monedaOrigen: imp.monedaOrigen,
    tipoCambio: imp.tipoCambio,
    facturaComercialNro: imp.facturaComercialNro ?? '',
    facturaComercialFecha: imp.facturaComercialFecha ?? '',
    duaNumero: imp.duaNumero ?? '',
    duaFecha: imp.duaFecha ?? '',
    despachante: imp.despachante ?? '',
    aduana: imp.aduana ?? '',
    transporteDoc: imp.transporteDoc ?? '',
    certificadoOrigen: imp.certificadoOrigen,
    fechaEmbarque: imp.fechaEmbarque ?? '',
    fechaArribo: imp.fechaArribo ?? '',
    fechaNacionalizacion: imp.fechaNacionalizacion ?? '',
    fob: c2p(imp.fob), flete: c2p(imp.flete), seguro: c2p(imp.seguro), notas: imp.notas ?? '',
    items: imp.items.map((i) => ({ descripcion: i.descripcion, ncm: i.ncm ?? '', cantidad: i.cantidad, fobUnitario: c2p(i.fobUnitario) })),
    tributos: imp.tributos.map((t) => ({ tipo: t.tipo, tasa: t.tasa, monto: c2p(t.monto) })),
    gastos: imp.gastos.map((g) => ({ concepto: g.concepto, descripcion: g.descripcion ?? '', monto: c2p(g.monto), gravadoIva: g.gravadoIva, ivaGasto: c2p(g.ivaGasto) })),
  };
}

// Costeo en vivo (pesos) — réplica de la fórmula del backend para la vista previa.
function costeoVivo(f: FormState) {
  const cif = f.fob + f.flete + f.seguro;
  let noRec = 0, ivaImp = 0, anticipos = 0, totalTributos = 0;
  for (const t of f.tributos) {
    totalTributos += t.monto;
    if (RECUPERABLE.includes(t.tipo)) {
      if (t.tipo === 'IVA_IMPORTACION') ivaImp += t.monto; else anticipos += t.monto;
    } else noRec += t.monto;
  }
  let totalGastos = 0, ivaGastos = 0;
  for (const g of f.gastos) { totalGastos += g.monto; ivaGastos += g.ivaGasto; }
  return {
    cif, totalTributos, totalGastos,
    costoMercaderia: cif + noRec + totalGastos,
    creditoFiscalIva: ivaImp + ivaGastos,
    anticipos,
  };
}

function aPayload(companyId: string, f: FormState): ImportacionPayload {
  const nn = (s: string) => (s.trim() ? s.trim() : null);
  return {
    companyId,
    regimen: f.regimen,
    proveedorExterior: nn(f.proveedorExterior),
    paisOrigen: nn(f.paisOrigen),
    incoterm: nn(f.incoterm),
    monedaOrigen: f.monedaOrigen || 'USD',
    tipoCambio: f.tipoCambio || 1,
    facturaComercialNro: nn(f.facturaComercialNro),
    facturaComercialFecha: nn(f.facturaComercialFecha),
    duaNumero: nn(f.duaNumero),
    duaFecha: nn(f.duaFecha),
    despachante: nn(f.despachante),
    aduana: nn(f.aduana),
    transporteDoc: nn(f.transporteDoc),
    certificadoOrigen: f.certificadoOrigen,
    fechaEmbarque: nn(f.fechaEmbarque),
    fechaArribo: nn(f.fechaArribo),
    fechaNacionalizacion: nn(f.fechaNacionalizacion),
    fob: f.fob, flete: f.flete, seguro: f.seguro,
    notas: nn(f.notas),
    items: f.items.filter((i) => i.descripcion.trim()).map((i) => ({
      descripcion: i.descripcion.trim(), ncm: i.ncm.trim() || null, cantidad: i.cantidad, fobUnitario: i.fobUnitario,
    })),
    tributos: f.tributos.map((t) => ({ tipo: t.tipo, tasa: t.tasa, monto: t.monto })),
    gastos: f.gastos.map((g) => ({ concepto: g.concepto, descripcion: g.descripcion.trim() || null, monto: g.monto, gravadoIva: g.gravadoIva, ivaGasto: g.ivaGasto })),
  };
}

// FUSIONA los datos extraídos de un documento en el formulario SIN pisar lo que
// ya había con vacíos/ceros. Pensado para procesar VARIOS documentos de un
// expediente (factura + liquidación + SWIFT…) y que cada uno aporte lo suyo.
function fusionarExtraido(prev: FormState, d: NonNullable<ImportacionExtraido['datos']>): FormState {
  const txt = (nuevo: string | null | undefined, viejo: string) => (nuevo && nuevo.trim() ? nuevo : viejo);
  const num = (nuevo: number | undefined, viejo: number) => (nuevo && nuevo > 0 ? nuevo : viejo);
  // Tributos: unión por tipo (no duplica el mismo tipo).
  const tributos = [...prev.tributos];
  for (const t of d.tributos) if (t.monto > 0 && !tributos.some((x) => x.tipo === t.tipo)) tributos.push({ tipo: t.tipo, tasa: 0, monto: t.monto });
  // Gastos: agrega los que no estén (por concepto+monto).
  const gastos = [...prev.gastos];
  for (const g of d.gastos) if ((g.monto > 0 || g.ivaGasto > 0) && !gastos.some((x) => x.concepto === g.concepto && x.monto === g.monto)) gastos.push({ concepto: g.concepto, descripcion: '', monto: g.monto, gravadoIva: g.ivaGasto > 0, ivaGasto: g.ivaGasto });
  // Ítems: agrega por descripción.
  const items = [...prev.items];
  for (const it of d.items ?? []) if (it.descripcion.trim() && !items.some((x) => x.descripcion === it.descripcion)) items.push({ descripcion: it.descripcion, ncm: '', cantidad: it.cantidad ?? 1, fobUnitario: it.fobUnitario ?? 0 });
  // Notas: concatena sin repetir.
  const notas = d.notas && !prev.notas.includes(d.notas) ? [prev.notas, d.notas].filter(Boolean).join(' · ') : prev.notas;
  return {
    ...prev,
    regimen: prev.regimen,
    proveedorExterior: txt(d.proveedorExterior, prev.proveedorExterior),
    paisOrigen: txt(d.paisOrigen, prev.paisOrigen),
    incoterm: txt(d.incoterm, prev.incoterm),
    monedaOrigen: txt(d.monedaOrigen, prev.monedaOrigen),
    tipoCambio: d.tipoCambio && d.tipoCambio !== 1 ? d.tipoCambio : prev.tipoCambio,
    duaNumero: txt(d.duaNumero, prev.duaNumero),
    duaFecha: txt(d.duaFecha, prev.duaFecha),
    despachante: txt(d.despachante, prev.despachante),
    aduana: txt(d.aduana, prev.aduana),
    fechaNacionalizacion: txt(d.fechaNacionalizacion, prev.fechaNacionalizacion),
    fob: num(d.fob, prev.fob),
    flete: num(d.flete, prev.flete),
    seguro: num(d.seguro, prev.seguro),
    facturaComercialNro: txt(d.facturaComercialNro, prev.facturaComercialNro),
    facturaComercialFecha: txt(d.facturaComercialFecha, prev.facturaComercialFecha),
    transporteDoc: txt(d.transporteDoc, prev.transporteDoc),
    notas,
    tributos,
    gastos,
    items,
  };
}

export default function ImportacionesPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Importacion | null | 'nueva'>(null);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [mostrarCotizaciones, setMostrarCotizaciones] = useState(false);
  const [error, setError] = useState('');
  const [companyId, setCompanyId] = useState<string>(() => localStorage.getItem('importacionesCompanyId') || '');

  // Empresas: TODAS las del estudio (Sueldos + solo-Tareas), no solo las de Sueldos.
  const { data: clientes = [] } = useQuery({
    queryKey: ['importaciones-clientes'],
    queryFn: () => importacionesApi.clientes(),
  });

  // Empresa por defecto: la guardada; si no, la activa del selector de Sueldos; si no, la primera.
  useEffect(() => {
    if (!clientes.length) return;
    if (!clientes.some((c) => c.companyId === companyId)) {
      const fallback = clientes.some((c) => c.companyId === activeCompanyId) ? activeCompanyId : clientes[0].companyId;
      setCompanyId(fallback);
    }
  }, [clientes, companyId, activeCompanyId]);

  const elegirEmpresa = (id: string) => { setCompanyId(id); localStorage.setItem('importacionesCompanyId', id); };
  const empresa = clientes.find((c) => c.companyId === companyId);

  const { data: lista = [], isLoading } = useQuery({
    queryKey: ['importaciones', companyId],
    queryFn: () => importacionesApi.list(companyId),
    enabled: !!companyId,
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['importaciones', companyId] });

  const estadoMutation = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: ImportacionEstado }) => importacionesApi.estado(id, estado),
    onSuccess: invalidar,
  });
  const borrarMutation = useMutation({
    mutationFn: (id: string) => importacionesApi.remove(id),
    onSuccess: invalidar,
  });

  if (!companyId) {
    return <div className="card p-6 text-ink-subtle">No hay empresas disponibles para importaciones.</div>;
  }

  if (mostrarConfig) {
    return <ConfigEmpresa companyId={companyId} empresaNombre={empresa?.nombreFantasia || empresa?.razonSocial || ''} onClose={() => setMostrarConfig(false)} />;
  }

  if (mostrarCotizaciones) {
    return <CotizacionesView onClose={() => setMostrarCotizaciones(false)} />;
  }

  if (editando) {
    return (
      <FormImportacion
        companyId={companyId}
        inicial={editando === 'nueva' ? formVacio() : desdeImportacion(editando)}
        importacion={editando === 'nueva' ? null : editando}
        onClose={() => { setEditando(null); setError(''); }}
        onSaved={() => { invalidar(); setEditando(null); setError(''); }}
        onError={setError}
        error={error}
      />
    );
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Ship size={22} className="text-brand-600" /> Importaciones</h1>
          <p className="text-ink-subtle text-sm">Operaciones de comercio exterior. Costeo, crédito fiscal y seguimiento del trámite.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={() => setMostrarCotizaciones(true)}><Coins size={16} /> Cotizaciones</button>
          <button className="btn-secondary" onClick={() => setMostrarConfig(true)}><Settings size={16} /> Configuración</button>
          <button className="btn-primary" onClick={() => setEditando('nueva')}><Plus size={16} /> Nueva importación</button>
        </div>
      </div>

      {/* Selector de empresa: TODAS las del estudio (Sueldos + solo-Tareas). */}
      <div className="card p-4">
        <label className="form-label">Empresa</label>
        <select className="form-input w-full md:w-96" value={companyId} onChange={(e) => elegirEmpresa(e.target.value)}>
          {clientes.map((c) => (
            <option key={c.companyId} value={c.companyId}>
              {c.nombreFantasia || c.razonSocial}{c.soloTareas ? ' · (Tareas)' : ''}{!c.active ? ' · inactiva' : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink-subtle mt-1">Incluye las empresas de Sueldos y las creadas solo para Tareas. Trabajás sobre <b>{empresa?.nombreFantasia || empresa?.razonSocial || '—'}</b>.</p>
      </div>

      <CreditoFiscalPanel companyId={companyId} />

      <ImportadorPanel companyId={companyId} onImported={invalidar} />

      {isLoading ? (
        <div className="card p-6 text-ink-subtle">Cargando…</div>
      ) : lista.length === 0 ? (
        <div className="card p-6 text-ink-subtle">Todavía no hay importaciones registradas para esta empresa.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header">
              <tr>
                <th className="px-3 py-2 text-left">DUA</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-left">Régimen</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-right">Costo mercadería</th>
                <th className="px-3 py-2 text-right">Crédito fiscal IVA</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {lista.map((imp) => (
                <tr key={imp.id} className="hover:bg-canvas/50">
                  <td className="px-3 py-2 font-mono text-xs">{imp.duaNumero || '—'}</td>
                  <td className="px-3 py-2 text-xs">{imp.duaFecha || '—'}</td>
                  <td className="px-3 py-2">{imp.proveedorExterior || '—'}</td>
                  <td className="px-3 py-2 text-xs">{REGIMEN_LABEL[imp.regimen]}</td>
                  <td className="px-3 py-2">
                    <select
                      value={imp.estado}
                      onChange={(e) => estadoMutation.mutate({ id: imp.id, estado: e.target.value as ImportacionEstado })}
                      className={`text-xs rounded-full px-2 py-1 border-0 ${ESTADO_BADGE[imp.estado]}`}
                    >
                      {(Object.keys(ESTADO_LABEL) as ImportacionEstado[]).map((e) => (
                        <option key={e} value={e}>{ESTADO_LABEL[e]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right figure">{fmt(imp.costoMercaderia)}</td>
                  <td className="px-3 py-2 text-right figure">{fmt(imp.creditoFiscalIva)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      className="p-1.5 rounded hover:bg-canvas text-ink-subtle hover:text-ink"
                      title="Ficha de costeo (PDF)"
                      onClick={async () => { const b = await importacionesApi.costeoPdf(imp.id); descargarBlob(b, `costeo_${imp.duaNumero || imp.id}.pdf`); }}
                    ><FileDown size={15} /></button>
                    <button className="p-1.5 rounded hover:bg-canvas text-ink-subtle hover:text-ink" title="Editar" onClick={() => setEditando(imp)}><Pencil size={15} /></button>
                    <button
                      className="p-1.5 rounded hover:bg-bad-bg text-bad"
                      title="Eliminar"
                      onClick={() => { if (confirm('¿Eliminar esta importación? No se puede deshacer.')) borrarMutation.mutate(imp.id); }}
                    ><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FormImportacion({ companyId, inicial, importacion, onClose, onSaved, onError, error }: {
  companyId: string;
  inicial: FormState;
  importacion: Importacion | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (s: string) => void;
  error: string;
}) {
  const [f, setF] = useState<FormState>(inicial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const costeo = costeoVivo(f);
  const money = (n: number) => '$ ' + n.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Documentos a adjuntar al crear una importación nueva (se suben al guardar).
  const [pendientes, setPendientes] = useState<File[]>([]);
  const [avisoAuto, setAvisoAuto] = useState('');

  const guardar = useMutation({
    mutationFn: async () => {
      const payload = aPayload(companyId, f);
      const saved = importacion ? await importacionesApi.update(importacion.id, payload) : await importacionesApi.create(payload);
      // Subir al expediente los documentos cargados en el alta.
      if (!importacion && pendientes.length) {
        await importacionesApi.documentos.upload(saved.id, pendientes);
      }
      return saved;
    },
    onSuccess: onSaved,
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg || 'No se pudo guardar la importación.');
    },
  });

  const [autoLoading, setAutoLoading] = useState(false);
  const [textoLeido, setTextoLeido] = useState('');
  // Un solo botón: adjunta VARIOS documentos y extrae/fusiona la info de todos.
  async function onAdjuntarYExtraer(files: FileList | null) {
    if (!files || !files.length) return;
    const lista = Array.from(files);
    setAutoLoading(true); setAvisoAuto(''); setTextoLeido('');
    // Encolar los archivos para adjuntarlos al guardar (evita duplicados por nombre).
    setPendientes((p) => {
      const nombres = new Set(p.map((x) => x.name));
      return [...p, ...lista.filter((f) => !nombres.has(f.name))];
    });
    const leidos: string[] = [];
    const textos: string[] = [];
    for (const file of lista) {
      try {
        const r = await importacionesApi.extraer(file);
        if (r.datos) { setF((prev) => fusionarExtraido(prev, r.datos!)); leidos.push(`${file.name}: ${(r.encontrados ?? []).join(', ') || 'datos'}`); }
        else leidos.push(`${file.name}: ${r.aviso || 'sin datos legibles'}`);
        if (r.texto) textos.push(`──── ${file.name} ────\n${r.texto}`);
      } catch {
        leidos.push(`${file.name}: no se pudo leer`);
      }
    }
    setAvisoAuto(`Procesados ${lista.length} documento(s). ${leidos.join(' | ')}. Revisá y completá antes de guardar.`);
    setTextoLeido(textos.join('\n\n'));
    setAutoLoading(false);
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Ship size={22} className="text-brand-600" /> {importacion ? 'Editar importación' : 'Nueva importación'}</h1>
        <button className="btn-secondary" onClick={onClose}><X size={16} /> Cerrar</button>
      </div>

      {error && <div className="p-3 bg-bad-bg border border-bad/30 rounded-lg text-sm text-bad">{error}</div>}

      {/* Adjuntar documentos y autocompletar */}
      <div className="card p-5 space-y-3 border-t-4 border-t-brand-600">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle flex items-center gap-2"><Paperclip size={16} /> Documentos y autocompletado</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-primary cursor-pointer">
            <Paperclip size={16} /> {autoLoading ? 'Leyendo documentos…' : 'Adjuntar documentos y extraer datos'}
            <input type="file" multiple accept=".pdf,image/*,.xlsx,.xls,.csv" className="hidden" onChange={(e) => { onAdjuntarYExtraer(e.target.files); e.target.value = ''; }} />
          </label>
          <button type="button" className="btn-secondary btn-sm" onClick={async () => descargarBlob(await importacionesApi.plantilla(), 'plantilla_importaciones.xlsx')}>
            <Download size={14} /> Plantilla
          </button>
        </div>
        <p className="text-xs text-ink-subtle">
          Subí <b>todos los documentos juntos</b> (factura del proveedor, DUA, liquidación del despachante, comprobantes de pago/SWIFT, en PDF, imagen, Excel o CSV). El sistema lee cada uno y <b>fusiona</b> en el formulario los datos que identifica (proveedor, factura, FOB/flete/seguro, tributos, IVA, DUA, fecha, moneda, tipo de cambio…). <b>Revisá y completá</b> antes de guardar; todos los archivos quedan adjuntos al expediente.
        </p>
        {avisoAuto && <div className="text-sm text-ink bg-canvas/70 rounded-lg p-2">{avisoAuto}</div>}
        {textoLeido && (
          <details className="text-xs text-ink-subtle">
            <summary className="cursor-pointer select-none">Ver el texto leído del archivo</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap bg-canvas/70 rounded-lg p-2">{textoLeido}</pre>
          </details>
        )}
        {!importacion && pendientes.length > 0 && (
          <ul className="divide-y divide-hairline/60 text-sm">
            {pendientes.map((file, i) => (
              <li key={i} className="flex items-center justify-between py-1.5">
                <span className="inline-flex items-center gap-1 text-ink"><Paperclip size={13} /> {file.name}</span>
                <button type="button" className="text-bad hover:underline" onClick={() => setPendientes((p) => p.filter((_, idx) => idx !== i))}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        {!importacion && <p className="text-xs text-ink-subtle">Los documentos se adjuntan al guardar la importación.</p>}
      </div>

      {/* Operación comercial */}
      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Operación comercial</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Campo label="Proveedor del exterior"><input className="form-input" value={f.proveedorExterior} onChange={(e) => set('proveedorExterior', e.target.value)} /></Campo>
          <Campo label="País de origen"><input className="form-input" value={f.paisOrigen} onChange={(e) => set('paisOrigen', e.target.value)} /></Campo>
          <Campo label="Incoterm"><input className="form-input" value={f.incoterm} onChange={(e) => set('incoterm', e.target.value)} placeholder="FOB / CIF / …" /></Campo>
          <Campo label="Moneda"><input className="form-input" value={f.monedaOrigen} onChange={(e) => set('monedaOrigen', e.target.value)} /></Campo>
          <Campo label="Tipo de cambio (pesos por unidad)"><input type="number" step="0.0001" className="form-input" value={f.tipoCambio} onChange={(e) => set('tipoCambio', Number(e.target.value))} /></Campo>
          <Campo label="Régimen">
            <select className="form-input" value={f.regimen} onChange={(e) => set('regimen', e.target.value as ImportacionRegimen)}>
              {(Object.keys(REGIMEN_LABEL) as ImportacionRegimen[]).map((r) => <option key={r} value={r}>{REGIMEN_LABEL[r]}</option>)}
            </select>
          </Campo>
          <Campo label="Factura comercial N°"><input className="form-input" value={f.facturaComercialNro} onChange={(e) => set('facturaComercialNro', e.target.value)} /></Campo>
          <Campo label="Fecha factura"><input type="date" className="form-input" value={f.facturaComercialFecha} onChange={(e) => set('facturaComercialFecha', e.target.value)} /></Campo>
        </div>
      </div>

      {/* Aduana / trámite */}
      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Aduana y trámite</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Campo label="DUA N°"><input className="form-input" value={f.duaNumero} onChange={(e) => set('duaNumero', e.target.value)} /></Campo>
          <Campo label="Fecha DUA"><input type="date" className="form-input" value={f.duaFecha} onChange={(e) => set('duaFecha', e.target.value)} /></Campo>
          <Campo label="Despachante"><input className="form-input" value={f.despachante} onChange={(e) => set('despachante', e.target.value)} /></Campo>
          <Campo label="Aduana"><input className="form-input" value={f.aduana} onChange={(e) => set('aduana', e.target.value)} /></Campo>
          <Campo label="Transporte (BL/AWB/CRT)"><input className="form-input" value={f.transporteDoc} onChange={(e) => set('transporteDoc', e.target.value)} /></Campo>
          <Campo label="Fecha embarque"><input type="date" className="form-input" value={f.fechaEmbarque} onChange={(e) => set('fechaEmbarque', e.target.value)} /></Campo>
          <Campo label="Fecha arribo"><input type="date" className="form-input" value={f.fechaArribo} onChange={(e) => set('fechaArribo', e.target.value)} /></Campo>
          <Campo label="Fecha nacionalización"><input type="date" className="form-input" value={f.fechaNacionalizacion} onChange={(e) => set('fechaNacionalizacion', e.target.value)} /></Campo>
          <label className="flex items-center gap-2 text-sm text-ink mt-6">
            <input type="checkbox" checked={f.certificadoOrigen} onChange={(e) => set('certificadoOrigen', e.target.checked)} />
            Certificado de origen (Mercosur)
          </label>
        </div>
      </div>

      {/* CIF */}
      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Valor CIF (en pesos)</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Campo label="FOB (mercadería)"><input type="number" step="0.01" className="form-input" value={f.fob} onChange={(e) => set('fob', Number(e.target.value))} /></Campo>
          <Campo label="Flete internacional"><input type="number" step="0.01" className="form-input" value={f.flete} onChange={(e) => set('flete', Number(e.target.value))} /></Campo>
          <Campo label="Seguro"><input type="number" step="0.01" className="form-input" value={f.seguro} onChange={(e) => set('seguro', Number(e.target.value))} /></Campo>
          <Campo label="CIF (calculado)"><div className="form-input bg-canvas figure">{money(costeo.cif)}</div></Campo>
        </div>
      </div>

      {/* Tributos */}
      <LineasTributos tributos={f.tributos} onChange={(t) => set('tributos', t)} />

      {/* Gastos */}
      <LineasGastos gastos={f.gastos} onChange={(g) => set('gastos', g)} />

      {/* Ítems (opcional) */}
      <LineasItems items={f.items} onChange={(i) => set('items', i)} />

      {/* Resumen de costeo */}
      <div className="card p-5 bg-canvas/50">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle mb-3">Resumen del costeo</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-6 text-sm">
          <Resumen label="CIF" valor={money(costeo.cif)} />
          <Resumen label="Total tributos" valor={money(costeo.totalTributos)} />
          <Resumen label="Total gastos de plaza" valor={money(costeo.totalGastos)} />
          <Resumen label="Costo de la mercadería" valor={money(costeo.costoMercaderia)} fuerte />
          <Resumen label="Crédito fiscal IVA" valor={money(costeo.creditoFiscalIva)} />
          <Resumen label="Anticipos (pago a cuenta)" valor={money(costeo.anticipos)} />
        </div>
        <p className="text-xs text-ink-subtle mt-3">El IVA importación y los anticipos no integran el costo (son crédito fiscal / pagos a cuenta).</p>
      </div>

      {importacion && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle flex items-center gap-2"><Calculator size={16} /> Asiento contable y ficha</h2>
            <button
              className="btn-secondary btn-sm"
              onClick={async () => { const b = await importacionesApi.costeoPdf(importacion.id); descargarBlob(b, `costeo_${importacion.duaNumero || importacion.id}.pdf`); }}
            ><FileDown size={14} /> Ficha de costeo (PDF)</button>
          </div>
          <AsientoTabla importacionId={importacion.id} />
          <p className="text-xs text-ink-subtle">El asiento refleja el último guardado. Si editaste importes, guardá primero para verlo actualizado.</p>
        </div>
      )}

      {importacion && <DocumentosPanel importacionId={importacion.id} />}
      {!importacion && (
        <div className="card p-4 text-sm text-ink-subtle">
          <Paperclip size={14} className="inline mr-1" /> Guardá la importación para gestionar los documentos del expediente (subida múltiple, clasificación y estado).
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
          <Save size={16} /> {guardar.isPending ? 'Guardando…' : 'Guardar importación'}
        </button>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="form-label">{label}</label>{children}</div>;
}
function Resumen({ label, valor, fuerte }: { label: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline/40 pb-1">
      <span className="text-ink-subtle">{label}</span>
      <span className={`figure ${fuerte ? 'font-bold text-ink' : 'text-ink'}`}>{valor}</span>
    </div>
  );
}

function LineasTributos({ tributos, onChange }: { tributos: TributoForm[]; onChange: (t: TributoForm[]) => void }) {
  const add = () => onChange([...tributos, { tipo: 'ARANCEL_TEC', tasa: 0, monto: 0 }]);
  const upd = (i: number, patch: Partial<TributoForm>) => onChange(tributos.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const del = (i: number) => onChange(tributos.filter((_, idx) => idx !== i));
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Tributos del DUA</h2>
        <button className="btn-secondary btn-sm" onClick={add}><Plus size={14} /> Agregar tributo</button>
      </div>
      {tributos.length === 0 ? <p className="text-xs text-ink-subtle">Sin tributos cargados.</p> : (
        <div className="space-y-2">
          {tributos.map((t, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <select className="form-input col-span-5" value={t.tipo} onChange={(e) => upd(i, { tipo: e.target.value as TributoTipo })}>
                {(Object.keys(TRIBUTO_LABEL) as TributoTipo[]).map((k) => <option key={k} value={k}>{TRIBUTO_LABEL[k]}</option>)}
              </select>
              <input type="number" step="0.01" placeholder="Tasa %" className="form-input col-span-2" value={t.tasa} onChange={(e) => upd(i, { tasa: Number(e.target.value) })} />
              <input type="number" step="0.01" placeholder="Monto" className="form-input col-span-4" value={t.monto} onChange={(e) => upd(i, { monto: Number(e.target.value) })} />
              <button className="p-1.5 rounded hover:bg-bad-bg text-bad col-span-1 justify-self-center" onClick={() => del(i)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LineasGastos({ gastos, onChange }: { gastos: GastoForm[]; onChange: (g: GastoForm[]) => void }) {
  const add = () => onChange([...gastos, { concepto: 'HONORARIOS_DESPACHANTE', descripcion: '', monto: 0, gravadoIva: false, ivaGasto: 0 }]);
  const upd = (i: number, patch: Partial<GastoForm>) => onChange(gastos.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  const del = (i: number) => onChange(gastos.filter((_, idx) => idx !== i));
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Gastos de plaza</h2>
        <button className="btn-secondary btn-sm" onClick={add}><Plus size={14} /> Agregar gasto</button>
      </div>
      {gastos.length === 0 ? <p className="text-xs text-ink-subtle">Sin gastos cargados.</p> : (
        <div className="space-y-2">
          {gastos.map((g, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <select className="form-input col-span-3" value={g.concepto} onChange={(e) => upd(i, { concepto: e.target.value as GastoConcepto })}>
                {(Object.keys(GASTO_LABEL) as GastoConcepto[]).map((k) => <option key={k} value={k}>{GASTO_LABEL[k]}</option>)}
              </select>
              <input placeholder="Detalle" className="form-input col-span-3" value={g.descripcion} onChange={(e) => upd(i, { descripcion: e.target.value })} />
              <input type="number" step="0.01" placeholder="Monto" className="form-input col-span-2" value={g.monto} onChange={(e) => upd(i, { monto: Number(e.target.value) })} />
              <input type="number" step="0.01" placeholder="IVA" className="form-input col-span-2" value={g.ivaGasto} onChange={(e) => upd(i, { ivaGasto: Number(e.target.value), gravadoIva: Number(e.target.value) > 0 })} />
              <button className="p-1.5 rounded hover:bg-bad-bg text-bad col-span-1 justify-self-center" onClick={() => del(i)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LineasItems({ items, onChange }: { items: ItemForm[]; onChange: (i: ItemForm[]) => void }) {
  const add = () => onChange([...items, { descripcion: '', ncm: '', cantidad: 1, fobUnitario: 0 }]);
  const upd = (i: number, patch: Partial<ItemForm>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const del = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Ítems (opcional, para prorratear el costo)</h2>
        <button className="btn-secondary btn-sm" onClick={add}><Plus size={14} /> Agregar ítem</button>
      </div>
      {items.length === 0 ? <p className="text-xs text-ink-subtle">Sin ítems. El costo se calcula a nivel de la operación.</p> : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input placeholder="Descripción" className="form-input col-span-4" value={it.descripcion} onChange={(e) => upd(i, { descripcion: e.target.value })} />
              <input placeholder="NCM" className="form-input col-span-2" value={it.ncm} onChange={(e) => upd(i, { ncm: e.target.value })} />
              <input type="number" step="0.01" placeholder="Cant." className="form-input col-span-2" value={it.cantidad} onChange={(e) => upd(i, { cantidad: Number(e.target.value) })} />
              <input type="number" step="0.01" placeholder="FOB unit." className="form-input col-span-3" value={it.fobUnitario} onChange={(e) => upd(i, { fobUnitario: Number(e.target.value) })} />
              <button className="p-1.5 rounded hover:bg-bad-bg text-bad col-span-1 justify-self-center" onClick={() => del(i)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AsientoTabla({ importacionId }: { importacionId: string }) {
  const { data: asiento, isLoading } = useQuery({
    queryKey: ['importacion-asiento', importacionId],
    queryFn: () => importacionesApi.asiento(importacionId),
  });
  if (isLoading) return <p className="text-xs text-ink-subtle">Cargando asiento…</p>;
  if (!asiento) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="table-header">
          <tr>
            <th className="px-3 py-2 text-left">Cuenta</th>
            <th className="px-3 py-2 text-right">Debe</th>
            <th className="px-3 py-2 text-right">Haber</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline/60">
          {asiento.lineas.map((l, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5">{l.cuenta}</td>
              <td className="px-3 py-1.5 text-right figure">{l.debe !== '0' ? fmt(l.debe) : ''}</td>
              <td className="px-3 py-1.5 text-right figure">{l.haber !== '0' ? fmt(l.haber) : ''}</td>
            </tr>
          ))}
          <tr className="font-bold border-t-2 border-hairline">
            <td className="px-3 py-1.5">TOTALES</td>
            <td className="px-3 py-1.5 text-right figure">{fmt(asiento.totalDebe)}</td>
            <td className="px-3 py-1.5 text-right figure">{fmt(asiento.totalHaber)}</td>
          </tr>
        </tbody>
      </table>
      {!asiento.balanceado && <p className="text-xs text-bad mt-1">⚠ El asiento no balancea; revisá los importes.</p>}
    </div>
  );
}

function CreditoFiscalPanel({ companyId }: { companyId: string }) {
  const hoy = new Date();
  const [year, setYear] = useState(hoy.getFullYear());
  const [month, setMonth] = useState(hoy.getMonth() + 1);
  const [abierto, setAbierto] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['importaciones-credito-fiscal', companyId, year, month],
    queryFn: () => importacionesApi.creditoFiscal(companyId, year, month),
    enabled: abierto && !!companyId,
  });

  return (
    <div className="card p-4 space-y-3">
      <button className="flex items-center gap-2 text-sm font-semibold text-ink w-full" onClick={() => setAbierto((v) => !v)}>
        <Calculator size={16} className="text-brand-600" /> Crédito fiscal del mes (DGI)
        <span className="text-ink-subtle font-normal">— IVA importación y anticipos de las importaciones nacionalizadas</span>
      </button>
      {abierto && (
        <div className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="form-label">Mes</label>
              <select className="form-input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Año</label>
              <input type="number" className="form-input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} />
            </div>
            <button
              className="btn-secondary"
              onClick={async () => { const b = await importacionesApi.creditoFiscalExcel(companyId, year, month); descargarBlob(b, `credito_fiscal_${String(month).padStart(2, '0')}${year}.xlsx`); }}
            ><Download size={15} /> Excel</button>
          </div>

          {isLoading ? (
            <p className="text-sm text-ink-subtle">Cargando…</p>
          ) : !data || data.filas.length === 0 ? (
            <p className="text-sm text-ink-subtle">Sin importaciones nacionalizadas en {MESES[month]} {year}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="table-header">
                  <tr>
                    <th className="px-2 py-2 text-left">DUA</th>
                    <th className="px-2 py-2 text-left">Fecha</th>
                    <th className="px-2 py-2 text-left">Proveedor</th>
                    <th className="px-2 py-2 text-right">IVA import.</th>
                    <th className="px-2 py-2 text-right">IVA gastos</th>
                    <th className="px-2 py-2 text-right">Ant. IVA</th>
                    <th className="px-2 py-2 text-right">Ant. IRAE</th>
                    <th className="px-2 py-2 text-right">Crédito fiscal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline/60">
                  {data.filas.map((f) => (
                    <tr key={f.id}>
                      <td className="px-2 py-1.5 font-mono text-xs">{f.duaNumero || '—'}</td>
                      <td className="px-2 py-1.5 text-xs">{f.fecha || '—'}</td>
                      <td className="px-2 py-1.5">{f.proveedor || '—'}</td>
                      <td className="px-2 py-1.5 text-right figure">{fmt(f.ivaImportacion)}</td>
                      <td className="px-2 py-1.5 text-right figure">{fmt(f.ivaGastos)}</td>
                      <td className="px-2 py-1.5 text-right figure">{fmt(f.anticipoIva)}</td>
                      <td className="px-2 py-1.5 text-right figure">{fmt(f.anticipoIrae)}</td>
                      <td className="px-2 py-1.5 text-right figure font-semibold">{fmt(f.creditoFiscalIva)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold border-t-2 border-hairline">
                    <td className="px-2 py-1.5" colSpan={3}>TOTALES</td>
                    <td className="px-2 py-1.5 text-right figure">{fmt(data.totales.ivaImportacion)}</td>
                    <td className="px-2 py-1.5 text-right figure">{fmt(data.totales.ivaGastos)}</td>
                    <td className="px-2 py-1.5 text-right figure">{fmt(data.totales.anticipoIva)}</td>
                    <td className="px-2 py-1.5 text-right figure">{fmt(data.totales.anticipoIrae)}</td>
                    <td className="px-2 py-1.5 text-right figure">{fmt(data.totales.creditoFiscalIva)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImportadorPanel({ companyId, onImported }: { companyId: string; onImported: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [committed, setCommitted] = useState(false);

  const preview = useMutation({
    mutationFn: (f: File) => importacionesApi.importar(companyId, f, false),
    onSuccess: () => { setCommitted(false); setError(''); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo leer el archivo'),
  });
  const commit = useMutation({
    mutationFn: (f: File) => importacionesApi.importar(companyId, f, true),
    onSuccess: () => { setCommitted(true); setError(''); onImported(); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo importar'),
  });
  const result = commit.data ?? preview.data;

  return (
    <div className="card p-4 space-y-3">
      <button className="flex items-center gap-2 text-sm font-semibold text-ink w-full" onClick={() => setAbierto((v) => !v)}>
        <Upload size={16} className="text-brand-600" /> Generar desde archivo
        <span className="text-ink-subtle font-normal">— subí la planilla con los datos del DUA y el sistema crea el registro</span>
      </button>
      {abierto && (
        <div className="space-y-3">
          <button className="btn-secondary btn-sm" onClick={async () => descargarBlob(await importacionesApi.plantilla(), 'plantilla_importaciones.xlsx')}>
            <Download size={14} /> Descargar plantilla
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="btn-secondary cursor-pointer">
              <FileSpreadsheet size={16} /> Elegir archivo
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setCommitted(false); setError(''); preview.reset(); commit.reset(); }} />
            </label>
            <span className="text-sm text-ink-muted">{file ? file.name : 'Ningún archivo seleccionado'}</span>
            <button className="btn-primary" disabled={!file || preview.isPending} onClick={() => file && preview.mutate(file)}>
              <Upload size={16} /> {preview.isPending ? 'Analizando…' : 'Previsualizar'}
            </button>
          </div>

          {error && <div className="flex items-center gap-2 p-3 bg-bad-bg border border-bad/30 rounded-lg text-sm text-bad"><AlertCircle size={16} /> {error}</div>}

          {result && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span className="text-ink-subtle">Total: <b>{result.resumen.total}</b></span>
                <span className="text-ok">Válidas: <b>{result.resumen.validas}</b></span>
                <span className="text-bad">Con errores: <b>{result.resumen.conErrores}</b></span>
                {committed && <span className="text-brand-600">Creadas: <b>{result.resumen.creadas ?? 0}</b></span>}
              </div>
              <div className="border border-hairline/60 rounded-lg overflow-auto max-h-80">
                <table className="w-full text-sm">
                  <thead className="table-header sticky top-0">
                    <tr><th className="px-3 py-2 text-left">Fila</th><th className="px-3 py-2 text-left">DUA</th><th className="px-3 py-2 text-left">Proveedor</th><th className="px-3 py-2 text-right">FOB</th><th className="px-3 py-2 text-left">Estado</th></tr>
                  </thead>
                  <tbody className="divide-y divide-hairline/60">
                    {result.filas.map((r) => (
                      <tr key={r.fila} className={r.errores.length ? 'bg-bad-bg/40' : ''}>
                        <td className="px-3 py-1.5 text-ink-subtle">{r.fila}</td>
                        <td className="px-3 py-1.5">{r.datos.duaNumero || '—'}</td>
                        <td className="px-3 py-1.5">{r.datos.proveedorExterior || '—'}</td>
                        <td className="px-3 py-1.5 text-right figure">{(r.datos.fob || 0).toLocaleString('es-UY')}</td>
                        <td className="px-3 py-1.5">
                          {r.errores.length === 0
                            ? <span className="inline-flex items-center gap-1 text-ok text-xs"><CheckCircle size={13} /> OK</span>
                            : <span className="text-bad text-xs">{r.errores.join('; ')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!committed && result.resumen.validas > 0 && (
                <button className="btn-primary" disabled={commit.isPending} onClick={() => file && commit.mutate(file)}>
                  {commit.isPending ? 'Importando…' : `Crear ${result.resumen.validas} importación(es)`}
                </button>
              )}
              {committed && (
                <div className="flex items-center gap-2 p-3 bg-ok-bg border border-ok/30 rounded-lg text-sm text-ink">
                  <CheckCircle size={16} className="text-ok" /> Se crearon {result.resumen.creadas ?? 0} importación(es) en borrador. Revisalas y completá los adjuntos.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const TIPO_DOC_LABEL: Record<TipoDocImportacion, string> = {
  FACTURA_COMERCIAL: 'Factura comercial', DUA: 'DUA', LIQUIDACION_DESPACHANTE: 'Liquidación despachante',
  SOLICITUD_FONDOS: 'Solicitud de fondos', FACTURA_SERVICIOS_DESPACHANTE: 'Factura servicios despachante',
  SWIFT: 'SWIFT', DEBITO_BANCARIO: 'Débito bancario', FACTURA_FLETE: 'Factura de flete',
  FACTURA_SEGURO: 'Factura de seguro', PAGO_TRIBUTOS: 'Pago de tributos', PACKING_LIST: 'Packing list',
  DOC_TRANSPORTE: 'Documento de transporte', NOTA_CREDITO_DEBITO: 'Nota crédito/débito', OTRO: 'Otro',
};
const ESTADO_DOC_BADGE: Record<EstadoProcDoc, string> = {
  PENDIENTE: 'badge-gray', PROCESANDO: 'badge-yellow', PROCESADO: 'badge-green', ERROR: 'badge-red', DUPLICADO: 'badge-yellow',
};
const ESTADO_DOC_LABEL: Record<EstadoProcDoc, string> = {
  PENDIENTE: 'Pendiente', PROCESANDO: 'Procesando', PROCESADO: 'Procesado', ERROR: 'Error', DUPLICADO: 'Duplicado',
};

function DocumentosPanel({ importacionId }: { importacionId: string }) {
  const qc = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [aviso, setAviso] = useState('');
  const { data: docs = [] } = useQuery({
    queryKey: ['importacion-documentos', importacionId],
    queryFn: () => importacionesApi.documentos.list(importacionId),
  });
  const invalidar = () => qc.invalidateQueries({ queryKey: ['importacion-documentos', importacionId] });

  const subir = useMutation({
    mutationFn: (files: File[]) => importacionesApi.documentos.upload(importacionId, files),
    onSuccess: (r) => { invalidar(); setAviso(r.duplicados.length ? `No se subieron ${r.duplicados.length}: ${r.duplicados.join(' · ')}` : ''); },
    onError: () => setAviso('No se pudieron subir los documentos.'),
  });
  const borrar = useMutation({ mutationFn: (id: string) => importacionesApi.documentos.remove(id), onSuccess: invalidar });

  const recibir = (files: FileList | null) => { if (files && files.length) subir.mutate(Array.from(files)); };

  return (
    <div className="card p-5 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle flex items-center gap-2"><Paperclip size={16} /> Documentos del expediente</h2>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); recibir(e.dataTransfer.files); }}
        className={`rounded-lg border-2 border-dashed p-6 text-center text-sm ${dragOver ? 'border-brand-600 bg-brand-50/40' : 'border-hairline text-ink-subtle'}`}
      >
        <Upload size={20} className="mx-auto mb-2 text-brand-600" />
        Arrastrá y soltá los documentos acá, o
        <label className="text-brand-600 font-medium cursor-pointer"> elegí archivos
          <input type="file" multiple accept=".pdf,image/*,.xlsx,.xls,.csv" className="hidden" onChange={(e) => { recibir(e.target.files); e.target.value = ''; }} />
        </label>.
        <div className="text-xs text-ink-subtle mt-1">PDF, imágenes (JPG/PNG), Excel o CSV — hasta 20 MB cada uno. Se evitan duplicados por contenido.</div>
        {subir.isPending && <div className="text-xs text-brand-600 mt-2">Subiendo…</div>}
      </div>
      {aviso && <div className="text-sm text-ink bg-warn-bg border border-warn/40 rounded-lg p-2">{aviso}</div>}

      {docs.length === 0 ? (
        <p className="text-sm text-ink-subtle">Todavía no hay documentos en el expediente.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header">
              <tr>
                <th className="px-3 py-2 text-left">Archivo</th>
                <th className="px-3 py-2 text-left">Tipo detectado</th>
                <th className="px-3 py-2 text-right">Págs.</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-left">Subido</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {docs.map((d) => {
                const tipo = d.tipoConfirmado ?? d.tipoDetectado;
                return (
                  <tr key={d.id}>
                    <td className="px-3 py-2">
                      <button className="text-brand-600 hover:underline inline-flex items-center gap-1"
                        onClick={async () => descargarBlob(await importacionesApi.documentos.download(d.id), d.fileName)}>
                        <FileDown size={14} /> {d.fileName}
                      </button>
                      {d.errorProc && <div className="text-xs text-bad">{d.errorProc}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">{tipo ? TIPO_DOC_LABEL[tipo] : <span className="text-ink-subtle">— sin clasificar</span>}</td>
                    <td className="px-3 py-2 text-right">{d.paginas ?? '—'}</td>
                    <td className="px-3 py-2"><span className={`text-xs rounded-full px-2 py-0.5 ${ESTADO_DOC_BADGE[d.estadoProc]}`}>{ESTADO_DOC_LABEL[d.estadoProc]}</span></td>
                    <td className="px-3 py-2 text-xs text-ink-subtle">{new Date(d.createdAt).toLocaleDateString('es-UY')}</td>
                    <td className="px-3 py-2 text-right">
                      <button className="text-bad hover:underline" onClick={() => { if (confirm('¿Eliminar este documento del expediente?')) borrar.mutate(d.id); }}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-subtle">La clasificación automática y la extracción de datos de cada documento se agregan en las próximas sub-etapas.</p>
    </div>
  );
}

const OPCIONES = {
  iraeRegimen: ['GENERAL', 'FICTO'],
  ivaRegimen: ['GENERAL', 'MINIMO'],
  grupoCede: ['NO_CEDE', 'CEDE'],
  formularioDgi: ['2178', '1306', 'OTRO'],
  tipoActividad: ['GRAVADA', 'EXONERADA', 'MIXTA'],
  marcoContable: ['NIIF_PYMES', 'NIIF_PLENAS', 'DECRETO_291'],
  metodoCosteo: ['PPP', 'FIFO', 'IDENTIFICACION'],
  politicaDistribucion: ['FOB', 'PESO', 'CANTIDAD', 'VOLUMEN', 'MANUAL'],
};
const ETIQUETA_OPCION: Record<string, string> = {
  GENERAL: 'General', FICTO: 'Ficto', MINIMO: 'IVA mínimo', NO_CEDE: 'NO CEDE', CEDE: 'CEDE',
  '2178': 'Formulario 2178', '1306': 'Formulario 1306', OTRO: 'Otro',
  GRAVADA: 'Gravada', EXONERADA: 'Exonerada', MIXTA: 'Mixta',
  NIIF_PYMES: 'NIIF para PYMES', NIIF_PLENAS: 'NIIF plenas', DECRETO_291: 'Decreto 291/014',
  PPP: 'Precio promedio ponderado', FIFO: 'PEPS (FIFO)', IDENTIFICACION: 'Identificación específica',
  PESO: 'Peso', CANTIDAD: 'Cantidad', VOLUMEN: 'Volumen', MANUAL: 'Manual',
};

function ConfigEmpresa({ companyId, empresaNombre, onClose }: { companyId: string; empresaNombre: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['importaciones-config', companyId],
    queryFn: () => importacionesApi.config.get(companyId),
  });
  const [form, setForm] = useState<ImportacionConfigPayload | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    if (!data) return;
    const c = data.config;
    setForm({
      companyId,
      iraeRegimen: c?.iraeRegimen ?? 'GENERAL',
      ivaRegimen: c?.ivaRegimen ?? 'GENERAL',
      grupoCede: c?.grupoCede ?? 'NO_CEDE',
      formularioDgi: c?.formularioDgi ?? '2178',
      tipoActividad: c?.tipoActividad ?? 'GRAVADA',
      porcentajeDeduccionIva: c?.porcentajeDeduccionIva ?? null,
      marcoContable: c?.marcoContable ?? 'NIIF_PYMES',
      metodoCosteo: c?.metodoCosteo ?? 'PPP',
      politicaDistribucion: c?.politicaDistribucion ?? 'FOB',
      tratamientoMoneda: c?.tratamientoMoneda ?? '',
      monedaFuncional: c?.monedaFuncional ?? 'UYU',
      monedaPresentacion: c?.monedaPresentacion ?? 'UYU',
      cierreEjercicio: c?.cierreEjercicio ?? '12-31',
      inicioActividad: c?.inicioActividad ?? '',
      planCuentas: c?.planCuentas ?? {},
    });
  }, [data, companyId]);

  const guardar = useMutation({
    mutationFn: (payload: ImportacionConfigPayload) => importacionesApi.config.save(payload),
    onSuccess: () => { setGuardado(true); qc.invalidateQueries({ queryKey: ['importaciones-config', companyId] }); },
  });

  if (isLoading || !form || !data) return <div className="card p-6 text-ink-subtle">Cargando configuración…</div>;

  const set = <K extends keyof ImportacionConfigPayload>(k: K, v: ImportacionConfigPayload[K]) => { setForm((p) => (p ? { ...p, [k]: v } : p)); setGuardado(false); };
  const setCuenta = (clave: string, campo: 'codigo' | 'nombre', v: string) => {
    setForm((p) => p ? { ...p, planCuentas: { ...(p.planCuentas ?? {}), [clave]: { ...(p.planCuentas?.[clave] ?? {}), [campo]: v } } } : p);
    setGuardado(false);
  };
  const Sel = ({ campo, opts }: { campo: keyof ImportacionConfigPayload; opts: string[] }) => (
    <select className="form-input" value={(form[campo] as string) ?? ''} onChange={(e) => set(campo, e.target.value as never)}>
      {opts.map((o) => <option key={o} value={o}>{ETIQUETA_OPCION[o] ?? o}</option>)}
    </select>
  );

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Settings size={22} className="text-brand-600" /> Configuración contable y fiscal</h1>
        <button className="btn-secondary" onClick={onClose}><X size={16} /> Cerrar</button>
      </div>
      <p className="text-ink-subtle text-sm">Empresa: <b>{empresaNombre || '—'}</b>. Define el régimen, el marco contable y el plan de cuentas que usan los asientos y el resumen fiscal.</p>

      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Régimen tributario</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="form-label">IRAE</label><Sel campo="iraeRegimen" opts={OPCIONES.iraeRegimen} /></div>
          <div><label className="form-label">IVA</label><Sel campo="ivaRegimen" opts={OPCIONES.ivaRegimen} /></div>
          <div><label className="form-label">Grupo</label><Sel campo="grupoCede" opts={OPCIONES.grupoCede} /></div>
          <div><label className="form-label">Formulario DGI</label><Sel campo="formularioDgi" opts={OPCIONES.formularioDgi} /></div>
          <div><label className="form-label">Actividades</label><Sel campo="tipoActividad" opts={OPCIONES.tipoActividad} /></div>
          <div><label className="form-label">% deducción IVA (mixtas)</label><input type="number" step="0.01" className="form-input" value={form.porcentajeDeduccionIva ?? ''} onChange={(e) => set('porcentajeDeduccionIva', e.target.value === '' ? null : Number(e.target.value))} /></div>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Marco contable</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="form-label">Normas contables</label><Sel campo="marcoContable" opts={OPCIONES.marcoContable} /></div>
          <div><label className="form-label">Método de costeo</label><Sel campo="metodoCosteo" opts={OPCIONES.metodoCosteo} /></div>
          <div><label className="form-label">Distribución de gastos</label><Sel campo="politicaDistribucion" opts={OPCIONES.politicaDistribucion} /></div>
          <div><label className="form-label">Moneda funcional</label><input className="form-input" value={form.monedaFuncional ?? ''} onChange={(e) => set('monedaFuncional', e.target.value)} /></div>
          <div><label className="form-label">Moneda de presentación</label><input className="form-input" value={form.monedaPresentacion ?? ''} onChange={(e) => set('monedaPresentacion', e.target.value)} /></div>
          <div><label className="form-label">Cierre de ejercicio (MM-DD)</label><input className="form-input" placeholder="12-31" value={form.cierreEjercicio ?? ''} onChange={(e) => set('cierreEjercicio', e.target.value)} /></div>
          <div><label className="form-label">Inicio de actividad</label><input type="date" className="form-input" value={form.inicioActividad ?? ''} onChange={(e) => set('inicioActividad', e.target.value)} /></div>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Plan de cuentas</h2>
        <p className="text-xs text-ink-subtle">Asigná el código de tu plan a cada cuenta. El nombre es opcional (si lo dejás vacío se usa el nombre por defecto). Estas cuentas son las que usan los asientos del expediente.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-header">
              <tr><th className="px-3 py-2 text-left">Cuenta</th><th className="px-3 py-2 text-left">Código</th><th className="px-3 py-2 text-left">Nombre (opcional)</th></tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {(data.catalogoCuentas).map((c) => (
                <tr key={c.clave}>
                  <td className="px-3 py-1.5"><span className="text-ink">{c.nombre}</span><div className="text-xs text-ink-subtle">{c.grupo}</div></td>
                  <td className="px-3 py-1.5"><input className="form-input w-28" value={form.planCuentas?.[c.clave]?.codigo ?? ''} onChange={(e) => setCuenta(c.clave, 'codigo', e.target.value)} /></td>
                  <td className="px-3 py-1.5"><input className="form-input w-full" placeholder={c.nombre} value={form.planCuentas?.[c.clave]?.nombre ?? ''} onChange={(e) => setCuenta(c.clave, 'nombre', e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {guardado && <span className="text-sm text-ok inline-flex items-center gap-1"><CheckCircle size={15} /> Configuración guardada</span>}
        <button className="btn-primary" disabled={guardar.isPending} onClick={() => guardar.mutate(form)}>
          <Save size={16} /> {guardar.isPending ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  );
}

const COTIZ_TIPO_LABEL: Record<CotizacionTipo, string> = {
  CONTABLE: 'Contable', ADUANERO: 'Aduanero', BANCARIO: 'Bancario',
  ANTICIPO: 'Anticipos', OBLIGACION: 'Obligaciones', CIERRE: 'Cierre de ejercicio',
};

function CotizacionesView({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const hoy = new Date().toISOString().slice(0, 10);
  const [filtroMoneda, setFiltroMoneda] = useState('');
  const [error, setError] = useState('');
  // Alta / BCU
  const [fecha, setFecha] = useState(hoy);
  const [moneda, setMoneda] = useState('USD');
  const [tipo, setTipo] = useState<CotizacionTipo>('CONTABLE');
  const [valor, setValor] = useState<number>(0);

  const { data } = useQuery({
    queryKey: ['cotizaciones', filtroMoneda],
    queryFn: () => importacionesApi.cotizaciones.list(filtroMoneda ? { moneda: filtroMoneda } : {}),
  });
  const invalidar = () => qc.invalidateQueries({ queryKey: ['cotizaciones'] });

  const manual = useMutation({
    mutationFn: () => importacionesApi.cotizaciones.manual({ fecha, monedaOrigen: moneda, tipo, valor }),
    onSuccess: () => { invalidar(); setError(''); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'No se pudo guardar.'),
  });
  const bcu = useMutation({
    mutationFn: () => importacionesApi.cotizaciones.bcu({ moneda, fecha, tipo }),
    onSuccess: (c) => { invalidar(); setValor(c.valor); setError(''); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'El BCU no devolvió cotización.'),
  });
  const borrar = useMutation({ mutationFn: (id: string) => importacionesApi.cotizaciones.remove(id), onSuccess: invalidar });

  const monedasBcu = data?.monedasBcu ?? ['USD'];

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Coins size={22} className="text-brand-600" /> Cotizaciones</h1>
        <button className="btn-secondary" onClick={onClose}><X size={16} /> Cerrar</button>
      </div>
      <p className="text-ink-subtle text-sm">Tipos de cambio por fecha, moneda y tipo. Podés traerlas del <b>BCU</b> ({monedasBcu.join(', ')}) o cargarlas a mano. Son globales (valen para todas las empresas).</p>

      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-subtle">Agregar cotización</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div><label className="form-label">Fecha</label><input type="date" className="form-input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
          <div><label className="form-label">Moneda</label><input className="form-input" value={moneda} onChange={(e) => setMoneda(e.target.value.toUpperCase())} /></div>
          <div>
            <label className="form-label">Tipo</label>
            <select className="form-input" value={tipo} onChange={(e) => setTipo(e.target.value as CotizacionTipo)}>
              {(Object.keys(COTIZ_TIPO_LABEL) as CotizacionTipo[]).map((t) => <option key={t} value={t}>{COTIZ_TIPO_LABEL[t]}</option>)}
            </select>
          </div>
          <div><label className="form-label">Valor</label><input type="number" step="0.0001" className="form-input" value={valor} onChange={(e) => setValor(Number(e.target.value))} /></div>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={bcu.isPending || !monedasBcu.includes(moneda)} title={monedasBcu.includes(moneda) ? 'Traer del BCU' : 'Moneda sin código BCU'} onClick={() => bcu.mutate()}>
              {bcu.isPending ? 'BCU…' : 'Traer BCU'}
            </button>
            <button className="btn-primary" disabled={manual.isPending || !valor} onClick={() => manual.mutate()}><Save size={15} /></button>
          </div>
        </div>
        {error && <div className="text-sm text-bad bg-bad-bg border border-bad/30 rounded-lg p-2">{error}</div>}
        <p className="text-xs text-ink-subtle">"Traer BCU" completa el valor (venta) desde el servicio oficial para esa fecha; después guardás. Si el BCU no tiene dato (feriado/fin de semana/fecha futura), cargalo a mano.</p>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <label className="form-label mb-0">Filtrar por moneda</label>
          <input className="form-input w-32" value={filtroMoneda} onChange={(e) => setFiltroMoneda(e.target.value.toUpperCase())} placeholder="Todas" />
        </div>
        {!data || data.cotizaciones.length === 0 ? (
          <p className="text-sm text-ink-subtle">Sin cotizaciones cargadas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-header">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Moneda</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-right">Compra</th>
                  <th className="px-3 py-2 text-right">Venta</th>
                  <th className="px-3 py-2 text-left">Fuente</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline/60">
                {data.cotizaciones.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-1.5">{c.fecha}</td>
                    <td className="px-3 py-1.5">{c.monedaOrigen}/{c.monedaDestino}</td>
                    <td className="px-3 py-1.5 text-xs">{COTIZ_TIPO_LABEL[c.tipo]}</td>
                    <td className="px-3 py-1.5 text-right figure">{c.valor.toLocaleString('es-UY', { minimumFractionDigits: 4 })}</td>
                    <td className="px-3 py-1.5 text-right figure">{c.compra != null ? c.compra.toLocaleString('es-UY', { minimumFractionDigits: 4 }) : '—'}</td>
                    <td className="px-3 py-1.5 text-right figure">{c.venta != null ? c.venta.toLocaleString('es-UY', { minimumFractionDigits: 4 }) : '—'}</td>
                    <td className="px-3 py-1.5"><span className={`text-xs rounded-full px-2 py-0.5 ${c.fuente === 'BCU' ? 'badge-green' : 'badge-gray'}`}>{c.fuente}</span></td>
                    <td className="px-3 py-1.5 text-right"><button className="text-bad hover:underline" onClick={() => { if (confirm('¿Eliminar esta cotización?')) borrar.mutate(c.id); }}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
