/**
 * IMPORTADOR de importaciones desde un Excel/CSV (una fila = una importación).
 * El estudio llena la plantilla con los datos del DUA/factura del despachante y
 * el sistema genera el registro con su costeo. Mapea columnas por encabezado.
 * Ver docs/importaciones-diseno.md (Etapa 3).
 */
import * as XLSX from 'xlsx';
import { ImportacionRegimen, TributoImportacionTipo, GastoImportacionConcepto } from '@prisma/client';

export interface ImportacionImportData {
  regimen: ImportacionRegimen;
  proveedorExterior: string | null;
  paisOrigen: string | null;
  incoterm: string | null;
  monedaOrigen: string;
  tipoCambio: number;
  duaNumero: string | null;
  duaFecha?: string;
  despachante: string | null;
  aduana: string | null;
  fechaNacionalizacion?: string;
  fob: number;
  flete: number;
  seguro: number;
  tributos: Array<{ tipo: TributoImportacionTipo; monto: number }>;
  gastos: Array<{ concepto: GastoImportacionConcepto; monto: number; ivaGasto: number }>;
  // Campos opcionales que puede traer la lectura de PDF (factura del despachante).
  facturaComercialNro?: string | null;
  facturaComercialFecha?: string;
  transporteDoc?: string | null;
  notas?: string | null;
  items?: Array<{ descripcion: string; cantidad?: number; fobUnitario?: number }>;
}
export interface ImportacionImportRow {
  fila: number;
  datos: ImportacionImportData;
  errores: string[];
}

function normalize(s: unknown): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
function cellToStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}
function parseFecha(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    const iso = `${year}-${mo}-${d}`;
    return Number.isNaN(new Date(iso).getTime()) ? undefined : iso;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return undefined;
}
function parseNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

// Columna → lista de encabezados reconocidos (normalizados).
const ALIAS = {
  duaNumero: ['dua', 'nrodua', 'numerodua', 'nduadua', 'nrodedua'],
  duaFecha: ['fechadua', 'fecha', 'fechadeldua'],
  proveedorExterior: ['proveedor', 'proveedorexterior', 'proveedordelexterior'],
  paisOrigen: ['pais', 'paisorigen', 'origen', 'paisdeorigen'],
  incoterm: ['incoterm', 'incoterms'],
  monedaOrigen: ['moneda', 'monedaorigen'],
  tipoCambio: ['tipocambio', 'tc', 'tipodecambio'],
  despachante: ['despachante'],
  aduana: ['aduana'],
  regimen: ['regimen'],
  fechaNacionalizacion: ['fechanacionalizacion', 'nacionalizacion', 'fechanac'],
  fob: ['fob'],
  flete: ['flete', 'fleteinternacional'],
  seguro: ['seguro'],
  arancel: ['arancel', 'tec', 'aranceltec'],
  tasaServicios: ['tasa', 'tasaservicios', 'tasadeservicios'],
  imesi: ['imesi'],
  ivaImportacion: ['iva', 'ivaimportacion'],
  anticipoIva: ['anticipoiva'],
  anticipoIrae: ['anticipoirae'],
  recargo: ['recargo'],
  honorarios: ['honorarios', 'honorariosdespachante'],
  deposito: ['deposito'],
  movilizacion: ['movilizacion'],
  gastosBancarios: ['gastosbancarios', 'bancarios'],
  fleteInterno: ['fleteinterno'],
  ivaGastos: ['ivagastos', 'ivadegastos'],
} as const;
type Campo = keyof typeof ALIAS;

function regimenDe(s: string): ImportacionRegimen {
  const n = normalize(s);
  if (n.includes('admision') || n.includes('temporaria')) return ImportacionRegimen.ADMISION_TEMPORARIA;
  if (n.includes('deposito')) return ImportacionRegimen.DEPOSITO;
  if (n.includes('transito')) return ImportacionRegimen.TRANSITO;
  if (n.includes('zona')) return ImportacionRegimen.ZONA_FRANCA;
  return ImportacionRegimen.DEFINITIVA;
}

export function parseImportacionesExcel(buffer: Buffer): {
  headers: string[];
  mapeo: Partial<Record<Campo, string>>;
  rows: ImportacionImportRow[];
} {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], mapeo: {}, rows: [] };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  if (matrix.length === 0) return { headers: [], mapeo: {}, rows: [] };

  const headers = (matrix[0] as unknown[]).map(cellToStr);
  const colMap: Partial<Record<Campo, number>> = {};
  const mapeo: Partial<Record<Campo, string>> = {};
  headers.forEach((h, idx) => {
    const n = normalize(h);
    (Object.keys(ALIAS) as Campo[]).forEach((campo) => {
      if (colMap[campo] === undefined && (ALIAS[campo] as readonly string[]).includes(n)) {
        colMap[campo] = idx;
        mapeo[campo] = h;
      }
    });
  });

  const rows: ImportacionImportRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i] as unknown[];
    const raw = (c: Campo) => (colMap[c] !== undefined ? r[colMap[c] as number] : undefined);
    const num = (c: Campo) => parseNumber(raw(c));
    const str = (c: Campo) => cellToStr(raw(c)) || null;

    const tributos: ImportacionImportData['tributos'] = [];
    const addT = (tipo: TributoImportacionTipo, c: Campo) => { const m = num(c); if (m > 0) tributos.push({ tipo, monto: m }); };
    addT(TributoImportacionTipo.ARANCEL_TEC, 'arancel');
    addT(TributoImportacionTipo.TASA_SERVICIOS, 'tasaServicios');
    addT(TributoImportacionTipo.IMESI, 'imesi');
    addT(TributoImportacionTipo.IVA_IMPORTACION, 'ivaImportacion');
    addT(TributoImportacionTipo.ANTICIPO_IVA, 'anticipoIva');
    addT(TributoImportacionTipo.ANTICIPO_IRAE, 'anticipoIrae');
    addT(TributoImportacionTipo.RECARGO, 'recargo');

    const gastos: ImportacionImportData['gastos'] = [];
    const addG = (concepto: GastoImportacionConcepto, c: Campo) => { const m = num(c); if (m > 0) gastos.push({ concepto, monto: m, ivaGasto: 0 }); };
    addG(GastoImportacionConcepto.HONORARIOS_DESPACHANTE, 'honorarios');
    addG(GastoImportacionConcepto.DEPOSITO, 'deposito');
    addG(GastoImportacionConcepto.MOVILIZACION, 'movilizacion');
    addG(GastoImportacionConcepto.GASTOS_BANCARIOS, 'gastosBancarios');
    addG(GastoImportacionConcepto.FLETE_INTERNO, 'fleteInterno');
    // IVA de los gastos: se asigna al primer gasto (o a uno "OTRO") para el crédito fiscal.
    const ivaGastos = num('ivaGastos');
    if (ivaGastos > 0) {
      if (gastos.length) gastos[0].ivaGasto = ivaGastos;
      else gastos.push({ concepto: GastoImportacionConcepto.OTRO, monto: 0, ivaGasto: ivaGastos });
    }

    const datos: ImportacionImportData = {
      regimen: regimenDe(cellToStr(raw('regimen'))),
      proveedorExterior: str('proveedorExterior'),
      paisOrigen: str('paisOrigen'),
      incoterm: str('incoterm'),
      monedaOrigen: (str('monedaOrigen') || 'USD') as string,
      tipoCambio: num('tipoCambio') || 1,
      duaNumero: str('duaNumero'),
      duaFecha: parseFecha(raw('duaFecha')),
      despachante: str('despachante'),
      aduana: str('aduana'),
      fechaNacionalizacion: parseFecha(raw('fechaNacionalizacion')),
      fob: num('fob'),
      flete: num('flete'),
      seguro: num('seguro'),
      tributos,
      gastos,
    };

    const errores: string[] = [];
    if (!datos.duaNumero && !datos.proveedorExterior) errores.push('Falta el DUA o el proveedor (al menos uno para identificar la operación)');
    if (datos.fob <= 0 && datos.flete <= 0 && datos.seguro <= 0) errores.push('Sin valores de CIF (FOB/flete/seguro en 0)');

    rows.push({ fila: i + 1, datos, errores });
  }
  return { headers, mapeo, rows };
}

/** Plantilla Excel con los encabezados y una fila de ejemplo. */
export function buildPlantillaImportaciones(): Buffer {
  const aoa = [
    ['DUA', 'Fecha DUA', 'Proveedor', 'País', 'Incoterm', 'Moneda', 'Tipo de cambio', 'Despachante', 'Aduana', 'Régimen', 'Fecha nacionalización',
      'FOB', 'Flete', 'Seguro',
      'Arancel', 'Tasa servicios', 'IMESI', 'IVA importación', 'Anticipo IVA', 'Anticipo IRAE', 'Recargo',
      'Honorarios', 'Depósito', 'Movilización', 'Gastos bancarios', 'Flete interno', 'IVA gastos'],
    ['226123/2026', '10/10/2026', 'Shenzhen Co. Ltd', 'China', 'FOB', 'USD', '41.50', 'Despachante SRL', 'Montevideo', 'Definitiva', '13/10/2026',
      400000, 60000, 8000,
      0, 1200, 0, 102960, 15000, 10000, 0,
      12000, 3000, 2500, 1800, 0, 4290],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = aoa[0].map(() => ({ wch: 15 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Importaciones');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
