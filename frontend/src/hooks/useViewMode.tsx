import { createContext, useContext, useState, ReactNode } from 'react';
import { isAgendaHost } from '../utils/host';

// El sistema tiene dos "áreas" sobre el mismo login: SUELDOS y TAREAS (Agenda del
// estudio). El usuario elige en qué área trabajar; la elección se recuerda.
export type ViewMode = 'sueldos' | 'tareas';

interface ViewModeCtx {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
}
const Ctx = createContext<ViewModeCtx | null>(null);

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ViewMode>(() => {
    if (isAgendaHost) return 'tareas';
    return (localStorage.getItem('viewMode') as ViewMode) || 'sueldos';
  });
  const setMode = (m: ViewMode) => { setModeState(m); localStorage.setItem('viewMode', m); };
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>;
}

export function useViewMode() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useViewMode must be used within ViewModeProvider');
  return ctx;
}
