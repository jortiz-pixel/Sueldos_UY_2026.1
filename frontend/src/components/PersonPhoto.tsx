import { useEffect, useRef, useState, ChangeEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Upload } from 'lucide-react';
import { attachmentApi } from '../services/api';

function useBlobUrl(id?: string) {
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
  ownerId: string;
}

export default function PersonPhoto({ companyId, ownerId }: Props) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const enabled = !!companyId && !!ownerId;

  const { data: attachments } = useQuery({
    queryKey: ['attachments', companyId, 'PERSONA', ownerId],
    queryFn: () => attachmentApi.list({ companyId, ownerType: 'PERSONA', ownerId }),
    enabled,
  });
  const foto = attachments?.find((a) => a.tipo === 'FOTO');
  const fotoUrl = useBlobUrl(foto?.id);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['attachments', companyId, 'PERSONA', ownerId] });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('companyId', companyId);
      fd.append('ownerType', 'PERSONA');
      fd.append('ownerId', ownerId);
      fd.append('tipo', 'FOTO');
      fd.append('file', file);
      return attachmentApi.upload(fd);
    },
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => attachmentApi.remove(id),
    onSuccess: invalidate,
  });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadMutation.mutate(f);
    e.target.value = '';
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-40 h-40 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center border border-gray-200">
        {fotoUrl
          ? <img src={fotoUrl} alt="Foto" className="w-full h-full object-cover" />
          : <Camera size={40} className="text-gray-300" />}
      </div>
      {/* type="button" obligatorio: este componente vive dentro del <form> */}
      <button type="button" onClick={() => input.current?.click()} className="btn-secondary btn-sm" disabled={!enabled || uploadMutation.isPending}>
        <Upload size={14} /> {uploadMutation.isPending ? 'Subiendo…' : foto ? 'Cambiar foto' : 'Subir foto'}
      </button>
      {foto && (
        <button type="button" onClick={() => removeMutation.mutate(foto.id)} className="text-red-600 hover:text-red-700 text-xs">
          Quitar foto
        </button>
      )}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </div>
  );
}
