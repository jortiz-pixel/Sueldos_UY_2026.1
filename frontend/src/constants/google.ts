// Client ID de Google OAuth (es público: solo identifica la app ante Google).
// Se puede sobreescribir en build con VITE_GOOGLE_CLIENT_ID.
export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '452392392541-o8r6toecbd4s09iccfaiaehtfvt9oq6l.apps.googleusercontent.com';
