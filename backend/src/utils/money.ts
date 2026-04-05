/**
 * UTILIDADES MONETARIAS
 *
 * Toda aritmética monetaria se realiza en CENTÉSIMOS (enteros BigInt)
 * para evitar errores de punto flotante en cálculos financieros.
 *
 * 1 Peso Uruguayo = 100 centésimos
 * Internamente: $1,234.56 → 123456n (BigInt)
 *
 * Regla de redondeo DGI: ROUND_HALF_UP (0.5 → 1)
 */

/** Convierte pesos a centésimos (BigInt) */
export function toCtms(pesos: number): bigint {
  return BigInt(Math.round(pesos * 100));
}

/** Convierte centésimos (BigInt) a pesos (number con 2 decimales) */
export function toPesos(ctms: bigint): number {
  const sign = ctms < 0n ? -1 : 1;
  const abs = ctms < 0n ? -ctms : ctms;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return sign * (Number(whole) + Number(frac) / 100);
}

/** Formatea centésimos como string de pesos: "$12,345.67" */
export function formatPesos(ctms: bigint): string {
  const pesos = toPesos(ctms);
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: 'UYU',
    minimumFractionDigits: 2,
  }).format(pesos);
}

/**
 * Aplica una tasa (en basis points) a un monto en centésimos.
 * Basis points: 10000 bp = 100% = rate 1.0
 * Ejemplo: 15% = 1500 bp
 *
 * Redondeo: ROUND_HALF_UP (regla DGI)
 */
export function applyRate(amountCtms: bigint, rateBasisPts: number): bigint {
  // amount * rate / 10000, redondeado a centésimos
  // Usamos BigInt * BigInt para mantener precisión
  const numerator = amountCtms * BigInt(Math.round(rateBasisPts * 100));
  // numerator / 1_000_000 with ROUND_HALF_UP
  return divRoundHalfUp(numerator, 1_000_000n);
}

/**
 * División entera con redondeo ROUND_HALF_UP (requerido por DGI para IRPF).
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const isNegative = (numerator < 0n) !== (denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  // If remainder * 2 >= denominator → round up
  const rounded = remainder * 2n >= absDen ? quotient + 1n : quotient;
  return isNegative ? -rounded : rounded;
}

/**
 * Multiplica centésimos por un factor decimal con precisión.
 * Ejemplo: calcular 1/12 de aguinaldo
 */
export function multiplyFraction(
  amountCtms: bigint,
  numerator: number,
  denominator: number,
): bigint {
  return divRoundHalfUp(
    amountCtms * BigInt(numerator),
    BigInt(denominator),
  );
}

/** Máximo entre dos bigints */
export function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Mínimo entre dos bigints */
export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Clamp: mantiene valor entre min y max */
export function clampBigInt(value: bigint, min: bigint, max: bigint): bigint {
  return maxBigInt(min, minBigInt(max, value));
}

/**
 * Convierte un JSON value (que puede ser string o number) a BigInt centésimos.
 * Útil al leer de la base de datos donde BigInt se serializa como string.
 */
export function jsonToBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return BigInt(value);
  if (typeof value === 'number') return BigInt(Math.round(value));
  throw new Error(`Cannot convert ${typeof value} to BigInt`);
}

/**
 * Serializa BigInt a string para JSON (Prisma devuelve BigInt).
 * Usar en express res.json() o JSON.stringify replacer.
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * Calcula el salario proporcional por días trabajados.
 * días trabajados / días del mes (generalmente 30 para jornada mensual)
 */
export function salarioProporcional(
  salarioMensual: bigint,
  diasTrabajados: number,
  diasMes: number = 30,
): bigint {
  if (diasTrabajados >= diasMes) return salarioMensual;
  return multiplyFraction(salarioMensual, diasTrabajados, diasMes);
}
