import { useEffect, useRef, useState, ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Upload, FileText, Trash2, Eye } from 'lucide-react';
import { attachmentApi, AttachmentTipo } from '../services/api';

const TIPO_LABEL: Record<string, string> = {
  FOTO: 'Foto', CEDULA: 'Cédula', LIBRETA: 'Libreta', CARNE_SALUD: 'Carné de salud', CV: 'CV', OTRO: 'Otro',
};

const TIPOS_DOC: AttachmentTipo[] = ['CEDULA', 'LIBRETA', 'CARNE_SALUD', 'CV', 'OTRO'];
const TIPOS_CON_VENCIMIENTO = new Set(['CARNE_SALUD', 'LIBRETA']);

function useBlobUrl(id?: string) {
  // Cacheamos el BLOB (datos), no la object URL: la URL se crea fresca en el
  // componente y se revoca al desmontar. Así no queda una URL revocada en caché.
  const { data: blob } = useQuery({
    queryKey: ['attachment-blob', id],
    queryFn: () => attachmentApi.blob(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) { setUrl(undefined); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

interface Props {
  companyId: string;
  ownerType: string;
  ownerId: string;
  hidePhoto?: boolean;
}

export default function AttachmentsPanel({ companyId, ownerType, ownerId, hidePhoto }: Props) {
  const queryClient = useQueryClient();
  const fotoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const [docTipo, setDocTipo] = useState<AttachmentTipo>('CEDULA');
  const [docVenc, setDocVenc] = useState('');
  const [error, setError] = useState('');

  const enabled = !!companyId && !!ownerId;
  const { data: attachments } = useQuery({
    queryKey: ['attachments', companyId, ownerType, ownerId],
    queryFn: () => attachmentApi.list({ companyId, ownerType, ownerId }),
    enabled,
  });

  const foto = attachments?.find((a) => a.tipo === 'FOTO');
  const fotoUrl = useBlobUrl(foto?.id);
  const docs = (attachments ?? []).filter((a) => a.tipo !== 'FOTO');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['attachments', companyId, ownerType, ownerId] });

  const uploadMutation = useMutation({
    mutationFn: (vars: { file: File; tipo: AttachmentTipo; vencimiento?: string }) => {
      const fd = new FormData();
      fd.append('companyId', companyId);
      fd.append('ownerType', ownerType);
      fd.append('ownerId', ownerId);
      fd.append('tipo', vars.tipo);
      if (vars.vencimiento) fd.append('vencimiento', vars.vencimiento);
      fd.append('file', vars.file);
      return attachmentApi.upload(fd);
    },
    onSuccess: () => { invalidate(); setDocVenc(''); setError(''); },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'No se pudo subir el archivo');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => attachmentApi.remove(id),
    onSuccess: invalidate,
  });

  const view = async (id: string) => {
    const url = URL.createObjectURL(await attachmentApi.blob(id));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const onFoto = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadMutation.mutate({ file: f, tipo: 'FOTO' });
    e.target.value = '';
  };

  const onDoc = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadMutation.mutate({ file: f, tipo: docTipo, vencimiento: docVenc || undefined });
    e.target.value = '';
  };

  const vencInfo = (v: string | null) => {
    if (!v) return null;
    const d = new Date(v);
    const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
    const cls = days < 0 ? 'text-red-600' : days < 30 ? 'text-amber-600' : 'text-gray-500';
    const extra = days < 0 ? ' (vencido)' : days < 30 ? ` (${days}d)` : '';
    return <span className={`text-xs ${cls}`}>Vence {d.toLocaleDateString('es-UY')}{extra}</span>;
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
        {hidePhoto ? <FileText size={16} /> : <Camera size={16} />} {hidePhoto ? 'Documentos' : 'Foto y documentos'}
      </div>

      {/* Foto */}
      {!hidePhoto && (
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
            {fotoUrl
              ? <img src={fotoUrl} alt="Foto" className="w-full h-full object-cover" />
              : <Camera size={28} className="text-gray-300" />}
          </div>
          <div>
            <button type="button" onClick={() => fotoInput.current?.click()} className="btn-secondary btn-sm" disabled={!enabled || uploadMutation.isPending}>
              <Upload size={14} /> {foto ? 'Cambiar foto' : 'Subir foto'}
            </button>
            {foto && (
              <button type="button" onClick={() => removeMutation.mutate(foto.id)} className="text-red-600 hover:text-red-700 text-xs ml-3">
                Quitar
              </button>
            )}
            <input ref={fotoInput} type="file" accept="image/*" className="hidden" onChange={onFoto} />
          </div>
        </div>
      )}

      {error && <p className="text-red-600 text-xs">{error}</p>}

      {/* Documentos */}
      <div className="border-t border-gray-100 pt-3 space-y-2">
        {docs.length === 0 && <p className="text-xs text-gray-400">Sin documentos cargados</p>}
        {docs.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm">
            <FileText size={15} className="text-gray-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-gray-800 truncate">{TIPO_LABEL[a.tipo]} · <span className="text-gray-500">{a.fileName}</span></p>
              {vencInfo(a.vencimiento)}
            </div>
            <button type="button" onClick={() => view(a.id)} className="text-blue-600 hover:text-blue-700" title="Ver"><Eye size={15} /></button>
            <button type="button" onClick={() => removeMutation.mutate(a.id)} className="text-red-600 hover:text-red-700" title="Eliminar"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      {/* Agregar documento */}
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <div className="flex gap-2">
          <select
            value={docTipo}
            onChange={(e) => setDocTipo(e.target.value as AttachmentTipo)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm flex-1"
          >
            {TIPOS_DOC.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
          </select>
          {TIPOS_CON_VENCIMIENTO.has(docTipo) && (
            <input
              type="date"
              value={docVenc}
              onChange={(e) => setDocVenc(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              title="Vencimiento"
            />
          )}
        </div>
        <button type="button" onClick={() => docInput.current?.click()} className="btn-secondary btn-sm w-full justify-center" disabled={!enabled || uploadMutation.isPending}>
          <Upload size={14} /> {uploadMutation.isPending ? 'Subiendo…' : 'Subir documento (imagen o PDF)'}
        </button>
        <input ref={docInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={onDoc} />
      </div>
    </div>
  );
}
