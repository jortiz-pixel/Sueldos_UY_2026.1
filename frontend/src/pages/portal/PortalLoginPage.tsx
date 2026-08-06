import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { CreditCard, KeyRound, AlertCircle, ShieldCheck } from 'lucide-react';
import AsysTaxLogo from '../../components/AsysTaxLogo';
import { portalApi } from '../../services/api';

interface PortalLoginForm {
  ci: string;
  pin: string;
}

export default function PortalLoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<PortalLoginForm>();

  const onSubmit = async (data: PortalLoginForm) => {
    setError('');
    setLoading(true);
    try {
      const r = await portalApi.login(data.ci, data.pin);
      if (r.mustSetPin && r.setupToken) {
        // Primer ingreso: hay que fijar un PIN propio antes de ver los recibos.
        localStorage.setItem('portalSetupToken', r.setupToken);
        navigate('/portal/nuevo-pin');
        return;
      }
      if (r.token) {
        localStorage.setItem('portalToken', r.token);
        navigate('/portal/recibos');
      }
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Cédula o PIN incorrectos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <AsysTaxLogo variant="dark" height={50} />
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-navy/5 border border-hairline p-8">
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-ink">Portal de empleados</h1>
            <p className="text-ink-subtle text-sm mt-1">Consultá y descargá tus recibos de sueldo.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={16} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="form-label">Cédula de identidad</label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  {...register('ci', { required: 'Ingresá tu cédula' })}
                  type="text"
                  inputMode="numeric"
                  className="form-input pl-9 py-2.5"
                  placeholder="1.234.567-8"
                  autoComplete="username"
                />
              </div>
              {errors.ci && <p className="form-error">{errors.ci.message}</p>}
            </div>

            <div>
              <label className="form-label">PIN</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  {...register('pin', { required: 'Ingresá tu PIN' })}
                  type="password"
                  className="form-input pl-9 py-2.5"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              {errors.pin && <p className="form-error">{errors.pin.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full justify-center py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-600 hover:bg-brand-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-600 disabled:opacity-60 inline-flex items-center gap-2"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Ingresando...
                </span>
              ) : 'Ingresar'}
            </button>
          </form>

          <p className="text-xs text-ink-subtle mt-5 leading-relaxed">
            El PIN te lo entrega tu empleador la primera vez. Si no lo tenés o lo olvidaste,
            pedí que lo restablezcan.
          </p>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-subtle mt-6">
          <ShieldCheck size={13} />
          Acceso seguro · AsysTax. Sueldos
        </p>
      </div>
    </div>
  );
}
