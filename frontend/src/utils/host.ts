// El sistema se sirve en dos direcciones sobre el MISMO backend/base:
//  - sueldos.gro.com.uy  → sistema de sueldos completo
//  - agenda.gro.com.uy   → solo la Agenda del estudio (tareas y vencimientos)
// El "modo agenda" se detecta por el host y ajusta el landing y el menú.
export const isAgendaHost =
  typeof window !== 'undefined' && /^agenda\./i.test(window.location.hostname);
