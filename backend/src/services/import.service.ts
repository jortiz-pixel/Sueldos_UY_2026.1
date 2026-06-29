import * as XLSX from 'xlsx';
import { validarCedula, soloDigitos } from '../utils/cedula';

export interface ImportPersonaDatos {
  ci: string;
  nombre: string;
  apellido: string;
  fechaNacimiento?: string; // YYYY-MM-DD
  email?: string;
  telefono?: string;
  fechaIngreso?: string;    // YYYY-MM-DD
  salarioNominal?: number;  // pesos
  cargo?: string;
}

export interface ImportRow {
  fila: number;
  datos: ImportPersonaDatos;
  errores: string[];
}

/** Alias de columnas reconocidos (auto-mapeo por encabezado). */
const FIELD_ALIASES: Record<keyof ImportPersonaDatos, string[]> = {
  ci: ['ci', 'cedula', 'documento', 'doc', 'ciempleado'],
  nombre: ['nombre', 'nombres', 'firstname'],
  apellido: ['apellido', 'apellidos', 'lastname'],
  fechaNacimiento: ['fechanacimiento', 'nacimiento', 'fechadenacimiento', 'fnac', 'nac'],
  email: ['email', 'correo', 'mail', 'correoelectronico'],
  telefono: ['telefono', 'celular', 'tel', 'movil'],
  fechaIngreso: ['fechaingreso', 'ingreso', 'fechadeingreso', 'alta', 'fechaalta'],
  salarioNominal: ['salario', 'sueldo', 'salarionominal', 'nominal', 'sueldonominal', 'remuneracion'],
  cargo: ['cargo', 'puesto', 'rol'],
};

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

function parseNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return v;
  // Quita separadores de miles (.) y usa coma como decimal si aplica.
  const s = String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isNaN(n) ? undefined : n;
}

/** Parsea la primera hoja del Excel/CSV y mapea columnas por encabezado. */
export function parsePersonasExcel(buffer: Buffer): { headers: string[]; mapeo: Partial<Record<keyof ImportPersonaDatos, string>>; rows: ImportRow[] } {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], mapeo: {}, rows: [] };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  if (matrix.length === 0) return { headers: [], mapeo: {}, rows: [] };

  const headers = (matrix[0] as unknown[]).map(cellToStr);
  const colMap: Partial<Record<keyof ImportPersonaDatos, number>> = {};
  const mapeo: Partial<Record<keyof ImportPersonaDatos, string>> = {};
  headers.forEach((h, idx) => {
    const n = normalize(h);
    (Object.keys(FIELD_ALIASES) as (keyof ImportPersonaDatos)[]).forEach((field) => {
      if (colMap[field] === undefined && FIELD_ALIASES[field].includes(n)) {
        colMap[field] = idx;
        mapeo[field] = h;
      }
    });
  });

  const rows: ImportRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i] as unknown[];
    const get = (field: keyof ImportPersonaDatos) => (colMap[field] !== undefined ? r[colMap[field] as number] : undefined);
    rows.push({
      fila: i + 1,
      datos: {
        ci: cellToStr(get('ci')),
        nombre: cellToStr(get('nombre')),
        apellido: cellToStr(get('apellido')),
        fechaNacimiento: parseFecha(get('fechaNacimiento')),
        email: cellToStr(get('email')) || undefined,
        telefono: cellToStr(get('telefono')) || undefined,
        fechaIngreso: parseFecha(get('fechaIngreso')),
        salarioNominal: parseNumber(get('salarioNominal')),
        cargo: cellToStr(get('cargo')) || undefined,
      },
      errores: [],
    });
  }
  return { headers, mapeo, rows };
}

/** Genera un Excel de plantilla con encabezados y filas de ejemplo. */
export function buildPlantillaPersonas(): Buffer {
  const aoa = [
    ['Cédula', 'Nombre', 'Apellido', 'Fecha de ingreso', 'Salario', 'Fecha de nacimiento', 'Email', 'Teléfono', 'Cargo'],
    ['41318048', 'Ana', 'García', '01/03/2024', '80000', '15/06/1990', 'ana@empresa.uy', '099123456', 'Administrativa'],
    ['41290797', 'Juan', 'Pérez', '15/01/2023', '95000', '20/11/1985', '', '', 'Vendedor'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Personas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Valida cada fila (cédula, requeridos, duplicados internos y contra existentes). Muta errores[]. */
export function validateRows(rows: ImportRow[], existingCIs: Set<string>): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const d = row.datos;
    const ciDigits = soloDigitos(d.ci);
    if (!ciDigits) row.errores.push('Falta cédula');
    else if (!validarCedula(ciDigits)) row.errores.push('Cédula inválida (dígito verificador)');
    else if (existingCIs.has(ciDigits)) row.errores.push('La cédula ya existe en el sistema');
    else if (seen.has(ciDigits)) row.errores.push('Cédula duplicada en el archivo');
    if (ciDigits) seen.add(ciDigits);

    if (!d.nombre) row.errores.push('Falta nombre');
    if (!d.apellido) row.errores.push('Falta apellido');
    if (!d.fechaIngreso) row.errores.push('Falta fecha de ingreso (o formato inválido)');
    if (d.salarioNominal === undefined || d.salarioNominal <= 0) row.errores.push('Falta salario nominal válido');
  }
}
