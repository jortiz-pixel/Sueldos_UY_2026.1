import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ship, Plus, Trash2, Save, X, Pencil, FileDown, Download, Calculator } from 'lucide-react';
import { importacionesApi } from '../services/api';
import { useCompany } from '../hooks/useCompany';
import {
  Importacion, ImportacionPayload, ImportacionEstado, ImportacionRegimen,
  TributoTipo, GastoConcepto, MESES,
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

export default function ImportacionesPage() {
  const { activeCompanyId, companies } = useCompany();
  const empresa = companies.find((c) => c.companyId === activeCompanyId);
  const qc = useQueryClient();
  const [editando, setEditando] = useState<Importacion | null | 'nueva'>(null);
  const [error, setError] = useState('');

  const { data: lista = [], isLoading } = useQuery({
    queryKey: ['importaciones', activeCompanyId],
    queryFn: () => importacionesApi.list(activeCompanyId),
    enabled: !!activeCompanyId,
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['importaciones', activeCompanyId] });

  const estadoMutation = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: ImportacionEstado }) => importacionesApi.estado(id, estado),
    onSuccess: invalidar,
  });
  const borrarMutation = useMutation({
    mutationFn: (id: string) => importacionesApi.remove(id),
    onSuccess: invalidar,
  });

  if (!activeCompanyId) {
    return <div className="card p-6 text-ink-subtle">Elegí una empresa en el selector de arriba para ver sus importaciones.</div>;
  }

  if (editando) {
    return (
      <FormImportacion
        companyId={activeCompanyId}
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
          <p className="text-ink-subtle text-sm">Operaciones de comercio exterior de <b>{empresa?.nombreFantasia || empresa?.razonSocial || '—'}</b>. Costeo, crédito fiscal y seguimiento del trámite.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditando('nueva')}><Plus size={16} /> Nueva importación</button>
      </div>

      <CreditoFiscalPanel companyId={activeCompanyId} />

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

  const guardar = useMutation({
    mutationFn: () => {
      const payload = aPayload(companyId, f);
      return importacion ? importacionesApi.update(importacion.id, payload) : importacionesApi.create(payload);
    },
    onSuccess: onSaved,
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg || 'No se pudo guardar la importación.');
    },
  });

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Ship size={22} className="text-brand-600" /> {importacion ? 'Editar importación' : 'Nueva importación'}</h1>
        <button className="btn-secondary" onClick={onClose}><X size={16} /> Cerrar</button>
      </div>

      {error && <div className="p-3 bg-bad-bg border border-bad/30 rounded-lg text-sm text-bad">{error}</div>}

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
