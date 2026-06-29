import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Lock, Mail, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import GroLogo from '../components/GroLogo';
import { GOOGLE_CLIENT_ID } from '../constants/google';

interface LoginForm {
  email: string;
  password: string;
}

// Tipado mínimo de Google Identity Services (window.google).
interface GoogleId {
  accounts: {
    id: {
      initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
}
declare global {
  interface Window { google?: { accounts: GoogleId['accounts'] } }
}

export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>();
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Carga el script de Google Identity Services y renderiza el botón oficial.
  useEffect(() => {
    const handleCredential = async (response: { credential: string }) => {
      setError('');
      setLoading(true);
      try {
        await loginWithGoogle(response.credential);
        navigate('/');
      } catch (e) {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setError(msg || 'No se pudo ingresar con Google.');
      } finally {
        setLoading(false);
      }
    };

    const init = () => {
      if (!window.google || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', width: 320, text: 'signin_with', shape: 'rectangular',
      });
    };

    if (window.google) { init(); return; }
    const existing = document.getElementById('gsi-script');
    if (existing) { existing.addEventListener('load', init); return; }
    const script = document.createElement('script');
    script.id = 'gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = init;
    document.body.appendChild(script);
  }, [loginWithGoogle, navigate]);

  const onSubmit = async (data: LoginForm) => {
    setError('');
    setLoading(true);
    try {
      await login(data.email, data.password);
      navigate('/');
    } catch {
      setError('Credenciales incorrectas. Verifique su email y contraseña.');
    } finally {
      setLoading(false);
    }
  };

  const beneficios = [
    'Aguinaldo, licencia y aportes calculados según normativa uruguaya',
    'Recibos en PDF, reportes y exportación',
    'Multiempresa, con accesos y permisos por usuario',
  ];

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Panel de marca (izquierda, oculto en celular) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-[#00307F] via-[#003DA5] to-[#75AADB] text-white p-12 flex-col justify-between">
        {/* Formas decorativas */}
        <div aria-hidden className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="absolute bottom-0 -left-20 w-80 h-80 rounded-full bg-[#75AADB]/30 blur-3xl" />

        <div className="relative z-10">
          <GroLogo variant="light" height={46} />
        </div>

        <div className="relative z-10 max-w-md">
          <h2 className="text-4xl font-extrabold leading-tight tracking-tight">
            Liquidá sueldos<br />sin complicaciones.
          </h2>
          <p className="mt-4 text-blue-100/90 text-lg">
            La plataforma de nómina de GRO Consultores & Asociados, al día con la normativa uruguaya 2026.
          </p>
          <ul className="mt-8 space-y-3">
            {beneficios.map((b) => (
              <li key={b} className="flex items-start gap-3 text-blue-50/90">
                <CheckCircle2 size={20} className="flex-shrink-0 mt-0.5 text-white" />
                <span className="text-sm">{b}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-blue-100/70 text-xs">
          <ShieldCheck size={14} />
          <span>Datos cifrados · GRO Consultores & Asociados · Uruguay 2026</span>
        </div>
      </div>

      {/* Panel del formulario (derecha) */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Logo en celular */}
          <div className="lg:hidden mb-8 flex justify-center">
            <GroLogo variant="dark" height={48} />
          </div>

          <div className="bg-white rounded-2xl shadow-xl shadow-blue-900/5 border border-gray-100 p-8">
            <div className="mb-7">
              <h1 className="text-2xl font-bold text-gray-900">Ingresá a tu cuenta</h1>
              <p className="text-gray-500 text-sm mt-1">Sistema de liquidación de sueldos</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={16} className="flex-shrink-0" />
                  {error}
                </div>
              )}

              <div>
                <label className="form-label">Correo electrónico</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    {...register('email', { required: 'Email requerido' })}
                    type="email"
                    className="form-input pl-9 py-2.5"
                    placeholder="usuario@empresa.uy"
                    autoComplete="email"
                  />
                </div>
                {errors.email && <p className="form-error">{errors.email.message}</p>}
              </div>

              <div>
                <label className="form-label">Contraseña</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    {...register('password', { required: 'Contraseña requerida' })}
                    type="password"
                    className="form-input pl-9 py-2.5"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>
                {errors.password && <p className="form-error">{errors.password.message}</p>}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full justify-center py-2.5 text-sm font-semibold rounded-lg text-white bg-[#003DA5] hover:bg-[#00307F] transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#003DA5] disabled:opacity-60 inline-flex items-center gap-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Ingresando...
                  </span>
                ) : 'Ingresar'}
              </button>
            </form>

            {/* Separador + botón de Google */}
            <div className="flex items-center gap-3 my-5">
              <div className="h-px bg-gray-200 flex-1" />
              <span className="text-xs text-gray-400">o continuá con</span>
              <div className="h-px bg-gray-200 flex-1" />
            </div>
            <div className="flex justify-center">
              <div ref={googleBtnRef} />
            </div>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            © {new Date().getFullYear()} GRO Consultores & Asociados
          </p>
        </div>
      </div>
    </div>
  );
}
