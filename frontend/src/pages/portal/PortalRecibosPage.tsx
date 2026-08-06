import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, LogOut, FileText, AlertCircle } from 'lucide-react';
import AsysTaxLogo from '../../components/AsysTaxLogo';
import { portalApi, PortalRecibo } from '../../services/api';
import { formatPesos, MESES } from '../../types';

const TIPO_LABEL: Record<string, string> = {
  MENSUAL: 'Mensual',
  AGUINALDO: 'Aguinaldo',
  LICENCIA: 'Salario vacacional',
  VACACIONAL: 'Salario vacacional',
  LIQUIDACION_FINAL: 'Liquidación final',
  AJUSTE: 'Ajuste',
};

export default function PortalRecibosPage() {
  const navigate = useNavigate();
  const [descargando, setDescargando] = useState<string | null>(null);

  const { data: recibos, isLoading, isError } = useQuery({
    queryKey: ['portal', 'recibos'],
    queryFn: portalApi.recibos,
    retry: false,
  });

  // 401 → el token venció: al portal de login.
  useEffect(() => {
    if (isError) {
      localStorage.removeItem('portalToken');
      navigate('/portal');
    }
  }, [isError, navigate]);

  const salir = () => {
    localStorage.removeItem('portalToken');
    navigate('/portal');
  };

  const descargar = async (r: PortalRecibo) => {
    setDescargando(r.id);
    try {
      const blob = await portalApi.reciboPdf(r.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recibo-${r.year}-${String(r.month).padStart(2, '0')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('No se pudo descargar el recibo. Probá ingresar de nuevo.');
    } finally {
      setDescargando(null);
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-white border-b border-hairline">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <AsysTaxLogo variant="dark" height={34} />
          <button
            onClick={salir}
            className="inline-flex items-center gap-1.5 text-sm text-ink-subtle hover:text-ink transition-colors"
          >
            <LogOut size={15} />
            Salir
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-xl font-bold text-ink mb-1">Mis recibos</h1>
        <p className="text-sm text-ink-subtle mb-6">Recibos confirmados disponibles para descargar.</p>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <span className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        )}

        {!isLoading && recibos && recibos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle size={32} className="text-gray-300 mb-3" />
            <p className="text-sm text-ink-subtle">Todavía no hay recibos confirmados disponibles.</p>
          </div>
        )}

        {!isLoading && recibos && recibos.length > 0 && (
          <div className="space-y-2.5">
            {recibos.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-xl border border-hairline p-4 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                    <FileText size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">
                      {MESES[r.month]} {r.year}
                      <span className="ml-2 text-xs font-normal text-ink-subtle">
                        {TIPO_LABEL[r.type] || r.type}
                      </span>
                    </p>
                    <p className="text-xs text-ink-subtle truncate">{r.empresa}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className="figure text-sm font-semibold text-ink hidden sm:block">
                    $ {formatPesos(r.liquidoPercibir)}
                  </span>
                  <button
                    onClick={() => descargar(r)}
                    disabled={descargando === r.id}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-white bg-brand-600 hover:bg-brand-700 transition-colors disabled:opacity-60"
                  >
                    {descargando === r.id ? (
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    ) : (
                      <Download size={15} />
                    )}
                    <span className="hidden sm:inline">PDF</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
