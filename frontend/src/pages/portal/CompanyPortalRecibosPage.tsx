import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, LogOut, FileText, AlertCircle } from 'lucide-react';
import AsysTaxLogo from '../../components/AsysTaxLogo';
import { portalEmpresaApi, PortalEmpresaRecibo } from '../../services/api';
import { formatPesos, MESES } from '../../types';

const TIPO_LABEL: Record<string, string> = {
  MENSUAL: 'Mensual',
  AGUINALDO: 'Aguinaldo',
  LICENCIA: 'Salario vacacional',
  VACACIONAL: 'Salario vacacional',
  LIQUIDACION_FINAL: 'Liquidación final',
  AJUSTE: 'Ajuste',
};

interface Grupo {
  key: string;
  year: number;
  month: number;
  recibos: PortalEmpresaRecibo[];
  total: number;
}

export default function CompanyPortalRecibosPage() {
  const navigate = useNavigate();
  const [descargando, setDescargando] = useState<string | null>(null);

  const { data: recibos, isLoading, isError } = useQuery({
    queryKey: ['portal-empresa', 'recibos'],
    queryFn: portalEmpresaApi.recibos,
    retry: false,
  });

  useEffect(() => {
    if (isError) {
      localStorage.removeItem('portalEmpresaToken');
      navigate('/portal-empresa');
    }
  }, [isError, navigate]);

  // Agrupar por mes (ya vienen ordenados desc por año/mes desde el backend).
  const grupos = useMemo<Grupo[]>(() => {
    const map = new Map<string, Grupo>();
    for (const r of recibos ?? []) {
      const key = `${r.year}-${r.month}`;
      let g = map.get(key);
      if (!g) { g = { key, year: r.year, month: r.month, recibos: [], total: 0 }; map.set(key, g); }
      g.recibos.push(r);
      g.total += Number(r.liquidoPercibir);
    }
    return Array.from(map.values());
  }, [recibos]);

  const salir = () => {
    localStorage.removeItem('portalEmpresaToken');
    navigate('/portal-empresa');
  };

  const descargar = async (r: PortalEmpresaRecibo) => {
    setDescargando(r.id);
    try {
      const blob = await portalEmpresaApi.reciboPdf(r.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recibo-${r.ci}-${r.year}-${String(r.month).padStart(2, '0')}.pdf`;
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
        <h1 className="text-xl font-bold text-ink mb-1">Recibos de la empresa</h1>
        <p className="text-sm text-ink-subtle mb-6">Recibos confirmados de tus empleados, por mes.</p>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <span className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
          </div>
        )}

        {!isLoading && grupos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle size={32} className="text-gray-300 mb-3" />
            <p className="text-sm text-ink-subtle">Todavía no hay recibos confirmados disponibles.</p>
          </div>
        )}

        <div className="space-y-6">
          {grupos.map((g) => (
            <div key={g.key}>
              <div className="flex items-center justify-between mb-2 px-1">
                <h2 className="text-sm font-semibold text-ink">{MESES[g.month]} {g.year}</h2>
                <span className="text-xs text-ink-subtle">
                  {g.recibos.length} recibo{g.recibos.length !== 1 ? 's' : ''} · líquido total{' '}
                  <span className="figure font-semibold text-ink">$ {formatPesos(String(g.total))}</span>
                </span>
              </div>
              <div className="space-y-2">
                {g.recibos.map((r) => (
                  <div
                    key={r.id}
                    className="bg-white rounded-xl border border-hairline p-3.5 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                        <FileText size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink truncate">{r.empleado || r.ci}</p>
                        <p className="text-xs text-ink-subtle truncate">
                          {TIPO_LABEL[r.type] || r.type} · CI {r.ci}
                        </p>
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
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
