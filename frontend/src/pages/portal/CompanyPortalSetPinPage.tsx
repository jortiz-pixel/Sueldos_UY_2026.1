import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { KeyRound, AlertCircle, ShieldCheck } from 'lucide-react';
import AsysTaxLogo from '../../components/AsysTaxLogo';
import { portalEmpresaApi } from '../../services/api';

interface SetPinForm {
  newPin: string;
  repeatPin: string;
}

export default function CompanyPortalSetPinPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<SetPinForm>();

  useEffect(() => {
    if (!localStorage.getItem('portalEmpresaSetupToken')) navigate('/portal/empresa');
  }, [navigate]);

  const onSubmit = async (data: SetPinForm) => {
    setError('');
    const setupToken = localStorage.getItem('portalEmpresaSetupToken');
    if (!setupToken) { navigate('/portal/empresa'); return; }
    setLoading(true);
    try {
      const r = await portalEmpresaApi.setPin(data.newPin, setupToken);
      localStorage.removeItem('portalEmpresaSetupToken');
      localStorage.setItem('portalEmpresaToken', r.token);
      navigate('/portal/empresa/recibos');
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'No se pudo guardar el PIN. Probá ingresar de nuevo.');
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
            <h1 className="text-2xl font-bold text-ink">Elegí tu PIN</h1>
            <p className="text-ink-subtle text-sm mt-1">
              Es el primer ingreso de la empresa. Definí un PIN propio (mínimo 6 caracteres) para proteger los recibos.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={16} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="form-label">Nuevo PIN</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  {...register('newPin', { required: 'Ingresá un PIN', minLength: { value: 6, message: 'Mínimo 6 caracteres' } })}
                  type="password"
                  className="form-input pl-9 py-2.5"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
              {errors.newPin && <p className="form-error">{errors.newPin.message}</p>}
            </div>

            <div>
              <label className="form-label">Repetir PIN</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  {...register('repeatPin', {
                    required: 'Repetí el PIN',
                    validate: (v) => v === watch('newPin') || 'Los PIN no coinciden',
                  })}
                  type="password"
                  className="form-input pl-9 py-2.5"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
              {errors.repeatPin && <p className="form-error">{errors.repeatPin.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full justify-center py-2.5 text-sm font-semibold rounded-xl text-white bg-brand-600 hover:bg-brand-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-600 disabled:opacity-60 inline-flex items-center gap-2"
            >
              {loading ? 'Guardando...' : 'Guardar y continuar'}
            </button>
          </form>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-subtle mt-6">
          <ShieldCheck size={13} />
          Acceso seguro · AsysTax. Sueldos
        </p>
      </div>
    </div>
  );
}
