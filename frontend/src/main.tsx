import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

// Ingreso desde AsysTax e-Factura: el facturador abre Sueldos con
// #efactura=<pase de un solo uso>. Si el pase es válido se inicia la sesión
// del mismo usuario en la misma empresa ANTES de montar la app; si no, se
// sigue con el login de siempre. Sin ese fragmento no cambia nada.
async function ingresoDesdeEfactura(): Promise<void> {
  const m = /(?:^#|&)efactura=([A-Za-z0-9_-]{20,64})/.exec(window.location.hash);
  if (!m) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  try {
    const r = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/auth/efactura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: m[1] }),
    });
    if (!r.ok) return;
    const d = (await r.json()) as { accessToken?: string; refreshToken?: string; companyId?: string | null };
    if (!d.accessToken || !d.refreshToken) return;
    localStorage.setItem('accessToken', d.accessToken);
    localStorage.setItem('refreshToken', d.refreshToken);
    if (d.companyId) localStorage.setItem('activeCompanyId', d.companyId);
  } catch {
    // Sin conexión con el backend: queda el login normal
  }
}

ingresoDesdeEfactura().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
