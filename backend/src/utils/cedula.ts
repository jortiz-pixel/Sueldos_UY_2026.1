/** Valida una cédula uruguaya por su dígito verificador. Acepta con o sin formato. */
export function validarCedula(ci: string): boolean {
  const digits = (ci || '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 8) return false;
  const padded = digits.padStart(8, '0');
  const body = padded.slice(0, 7).split('').map(Number);
  const check = Number(padded[7]);
  const weights = [2, 9, 8, 7, 6, 3, 4];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += body[i] * weights[i];
  const dv = (10 - (sum % 10)) % 10;
  return dv === check;
}

/** Normaliza una cédula a solo dígitos (para comparaciones/deduplicación). */
export function soloDigitos(ci: string): string {
  return (ci || '').replace(/\D/g, '');
}
