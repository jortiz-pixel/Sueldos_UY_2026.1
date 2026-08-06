import { useNavigate } from 'react-router-dom';
import { User, Building2, ChevronRight, ShieldCheck } from 'lucide-react';
import AsysTaxLogo from '../../components/AsysTaxLogo';

export default function PortalChooserPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <AsysTaxLogo variant="dark" height={50} />
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-navy/5 border border-hairline p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-ink">Portal de recibos</h1>
            <p className="text-ink-subtle text-sm mt-1">¿Cómo querés ingresar?</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => navigate('/portal/empleado')}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-hairline hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-left group"
            >
              <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                <User size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">Soy empleado</p>
                <p className="text-xs text-ink-subtle">Ingresá con tu cédula para ver tus recibos.</p>
              </div>
              <ChevronRight size={18} className="text-gray-300 group-hover:text-brand-600 transition-colors" />
            </button>

            <button
              onClick={() => navigate('/portal/empresa')}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-hairline hover:border-brand-300 hover:bg-brand-50/50 transition-colors text-left group"
            >
              <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                <Building2 size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">Soy empresa / cliente</p>
                <p className="text-xs text-ink-subtle">Ingresá con el RUT para ver los recibos de tus empleados.</p>
              </div>
              <ChevronRight size={18} className="text-gray-300 group-hover:text-brand-600 transition-colors" />
            </button>
          </div>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-subtle mt-6">
          <ShieldCheck size={13} />
          Acceso seguro · AsysTax. Sueldos
        </p>
      </div>
    </div>
  );
}
