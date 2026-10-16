/**
 * Configuración fiscal y contable de importaciones por empresa (Etapa 2 §3).
 * Catálogo canónico de cuentas (no se fijan números iguales para todos los
 * clientes) y resolución de etiquetas para los asientos a partir del plan de
 * cuentas configurado. Ver docs/importaciones-diseno.md.
 */

/** Claves canónicas de cuenta del módulo de importaciones. */
export const CUENTAS_IMPORTACION: Array<{ clave: string; nombre: string; grupo: string }> = [
  { clave: 'bancoPesos', nombre: 'Banco moneda nacional', grupo: 'Disponibilidades' },
  { clave: 'bancoMe', nombre: 'Banco moneda extranjera', grupo: 'Disponibilidades' },
  { clave: 'anticiposProveedores', nombre: 'Anticipos a proveedores del exterior', grupo: 'Créditos' },
  { clave: 'proveedoresExterior', nombre: 'Proveedores del exterior', grupo: 'Pasivo' },
  { clave: 'proveedoresLocales', nombre: 'Proveedores locales', grupo: 'Pasivo' },
  { clave: 'despachantes', nombre: 'Despachantes de aduana', grupo: 'Pasivo' },
  { clave: 'mercaderiaTransito', nombre: 'Mercadería en tránsito', grupo: 'Bienes de cambio' },
  { clave: 'mercaderiasImportadas', nombre: 'Mercaderías importadas', grupo: 'Bienes de cambio' },
  { clave: 'gastosBancarios', nombre: 'Gastos y comisiones bancarias', grupo: 'Resultado' },
  { clave: 'diferenciasCambio', nombre: 'Diferencias de cambio', grupo: 'Resultado' },
  { clave: 'ivaComprasImportacion', nombre: 'IVA compras importación', grupo: 'Crédito fiscal' },
  { clave: 'ivaComprasPlaza', nombre: 'IVA compras plaza', grupo: 'Crédito fiscal' },
  { clave: 'anticipoIvaImportacion', nombre: 'Anticipo IVA importación', grupo: 'Anticipos tributarios' },
  { clave: 'anticipoIrae', nombre: 'Anticipo IRAE', grupo: 'Anticipos tributarios' },
  { clave: 'otrosImpuestosTasas', nombre: 'Otros impuestos y tasas', grupo: 'Varios' },
  { clave: 'costoVentas', nombre: 'Costo de ventas', grupo: 'Resultado' },
];

const NOMBRE_POR_CLAVE: Record<string, string> = Object.fromEntries(
  CUENTAS_IMPORTACION.map((c) => [c.clave, c.nombre]),
);

export type PlanCuentas = Record<string, { codigo?: string | null; nombre?: string | null }>;

/** Etiqueta de una cuenta para el asiento: "<código> — <nombre>" según el plan
 * configurado; si no hay config, usa el nombre canónico por defecto. */
export function etiquetaCuenta(plan: PlanCuentas | null | undefined, clave: string): string {
  const def = NOMBRE_POR_CLAVE[clave] ?? clave;
  const cfg = plan?.[clave];
  const nombre = (cfg?.nombre && cfg.nombre.trim()) || def;
  const codigo = cfg?.codigo && cfg.codigo.trim();
  return codigo ? `${codigo} — ${nombre}` : nombre;
}
