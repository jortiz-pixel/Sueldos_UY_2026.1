import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Building2, KeyRound, AlertCircle, ShieldCheck } from 'lucide-react';
import AsysTaxLogo from '../../components/AsysTaxLogo';
import { portalEmpresaApi } from '../../services/api';

interface CompanyLoginForm {
  rut: string;
  pin: string;
}

export default function CompanyPortalLoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<CompanyLoginForm>();

  const onSubmit = async (data: CompanyLoginForm) => {
    setError('');
    setLoading(true);
    try {
      const r = await portalEmpresaApi.login(data.rut, data.pin);
      if (r.mustSetPin && r.setupToken) {
        localStorage.setItem('portalEmpresaSetupToken', r.setupToken);
        navigate('/portal-empresa/nuevo-pin');
        return;
      }
      if (r.token) {
        localStorage.setItem('portalEmpresaToken', r.token);
        navigate('/portal-empresa/recibos');
      }
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'RUT o PIN incorrectos.');
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
            <h1 className="text-2xl font-bold text-ink">Portal de clientes</h1>
            <p className="text-ink-subtle text-sm mt-1">Consultá y descargá los recibos de tu empresa.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={16} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="form-label">RUT de la empresa</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  {...register('rut', { required: 'Ingresá el RUT' })}
                  type="text"
                  inputMode="numeric"
                  className="form-input pl-9 py-2.5"
                  placeholder="21 876543 0019"
                  autoComplete="username"
                />
              </div>
              {errors.rut && <p className="form-error">{errors.rut.message}</p>}
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
            El PIN te lo entrega tu estudio contable la primera vez. Si no lo tenés o lo olvidaste,
            pedí que lo restablezcan.
          </p>
          <div className="mt-4 pt-4 border-t border-hairline">
            <Link to="/portal" className="text-xs text-brand-600 hover:text-brand-700">
              ¿Sos empleado? Ingresá al portal de empleados →
            </Link>
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
