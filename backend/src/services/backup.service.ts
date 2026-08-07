/**
 * RESPALDO / EXPORT LEGIBLE DEL SISTEMA
 *
 * Genera, en una carpeta del disco, un árbol ordenado POR EMPRESA con toda la
 * información en formato consultable sin el sistema:
 *
 *   Empresas/<Razón Social (RUT ...)>/
 *     Empresa.xlsx        (empresa, personas, contratos, liquidaciones)
 *     datos.json          (fidelidad total — por si hay que reimportar/migrar)
 *     Contratos/          contratos de trabajo en PDF
 *     Liquidaciones/<año>/<mes>/  recibos en PDF
 *     Nomina BPS/<año>/   archivos .bps declarables
 *     Adjuntos/<persona>/ fotos, cédulas, carnés
 *
 * Esta es la capa "legible" del respaldo. La copia técnica (pg_dump + adjuntos
 * comprimidos) para restaurar el sistema tal cual la hace deploy/backup.sh.
 */
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { prisma } from '../utils/prisma';
import { toPesos } from '../utils/money';
import { generateReciboPDF, reciboFilename, generateContratoPDF, contratoFilename } from './pdf.service';
import { generarNominaBps } from './nomina.service';

const STORAGE_DIR = process.env.STORAGE_DIR || '/app/storage';
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Nombre seguro para archivos/carpetas (sin caracteres ilegales).
function safe(name: string): string {
  return (name || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'sin-nombre';
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// JSON con BigInt → string (el dinero se guarda en centésimos como string).
function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

export interface ResultadoRespaldo {
  empresas: number;
  contratosPdf: number;
  recibosPdf: number;
  nominasBps: number;
  adjuntos: number;
  errores: string[];
  outDir: string;
}

export async function exportarRespaldoCompleto(outDir: string): Promise<ResultadoRespaldo> {
  const res: ResultadoRespaldo = { empresas: 0, contratosPdf: 0, recibosPdf: 0, nominasBps: 0, adjuntos: 0, errores: [], outDir };
  ensureDir(outDir);

  const empresas = await prisma.company.findMany({ orderBy: { razonSocial: 'asc' } });
  const raizEmpresas = path.join(outDir, 'Empresas');
  ensureDir(raizEmpresas);

  for (const empresa of empresas) {
    try {
      await exportarEmpresa(empresa, raizEmpresas, res);
      res.empresas++;
    } catch (e) {
      res.errores.push(`Empresa ${empresa.razonSocial}: ${(e as Error).message}`);
    }
  }

  // LEEME con la fecha y el resumen del respaldo.
  const ahora = new Date();
  const leeme = [
    'AsysTax. Sueldos — Respaldo del sistema',
    '',
    `Generado: ${ahora.toISOString()}`,
    `Empresas: ${res.empresas}`,
    `Contratos (PDF): ${res.contratosPdf}`,
    `Recibos (PDF): ${res.recibosPdf}`,
    `Nóminas BPS: ${res.nominasBps}`,
    `Adjuntos: ${res.adjuntos}`,
    '',
    'Estructura: Empresas/<Razón Social (RUT)>/ con Empresa.xlsx, datos.json,',
    'Contratos/, Liquidaciones/<año>/<mes>/, Nomina BPS/<año>/ y Adjuntos/.',
    '',
    'La copia técnica para restaurar el sistema (base de datos + adjuntos) está',
    'en las carpetas hermanas generadas por deploy/backup.sh.',
    res.errores.length ? `\nAvisos:\n- ${res.errores.join('\n- ')}` : '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'LEEME.txt'), leeme, 'utf8');

  return res;
}

type Empresa = Awaited<ReturnType<typeof prisma.company.findMany>>[number];

async function exportarEmpresa(empresa: Empresa, raiz: string, res: ResultadoRespaldo): Promise<void> {
  const dir = path.join(raiz, safe(`${empresa.razonSocial} (RUT ${empresa.rut})`));
  ensureDir(dir);

  const employees = await prisma.employee.findMany({
    where: { companyId: empresa.id },
    orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
  });
  const contratos = await prisma.contrato.findMany({
    where: { companyId: empresa.id },
    orderBy: [{ employeeId: 'asc' }, { vigenciaDesde: 'desc' }],
  });
  const liquidaciones = await prisma.liquidation.findMany({
    where: { period: { companyId: empresa.id } },
    include: { items: { orderBy: [{ itemType: 'asc' }] }, period: true },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
  const periods = await prisma.payrollPeriod.findMany({ where: { companyId: empresa.id } });
  const adjuntos = await prisma.attachment.findMany({ where: { companyId: empresa.id } });

  const nombrePersona = (id: string) => {
    const e = employees.find((x) => x.id === id);
    return e ? `${e.apellido} ${e.nombre}`.trim() : id;
  };

  // ── datos.json (fidelidad total) ────────────────────────────────
  fs.writeFileSync(
    path.join(dir, 'datos.json'),
    jsonStringify({ empresa, employees, contratos, liquidaciones, adjuntos: adjuntos.map((a) => ({ ...a, storageKey: undefined })) }),
    'utf8',
  );

  // ── Empresa.xlsx ────────────────────────────────────────────────
  escribirExcelEmpresa(path.join(dir, 'Empresa.xlsx'), empresa, employees, contratos, liquidaciones, nombrePersona);

  // ── Contratos en PDF ────────────────────────────────────────────
  const dirContratos = path.join(dir, 'Contratos');
  for (const contrato of contratos) {
    try {
      const employee = employees.find((e) => e.id === contrato.employeeId);
      if (!employee) continue;
      const pdf = await generateContratoPDF(employee, contrato, empresa);
      ensureDir(dirContratos);
      fs.writeFileSync(path.join(dirContratos, `${safe(contratoFilename(employee, empresa))} - Nº ${contrato.numero}.pdf`), pdf);
      res.contratosPdf++;
    } catch (e) {
      res.errores.push(`Contrato ${contrato.id} (${empresa.razonSocial}): ${(e as Error).message}`);
    }
  }

  // ── Recibos de liquidación en PDF (todo lo generado, excepto anulado) ──
  for (const liq of liquidaciones) {
    if (liq.status === 'ANULADO') continue;
    try {
      const employee = employees.find((e) => e.id === liq.employeeId);
      if (!employee) continue;
      const contrato = contratos.find((c) => c.employeeId === liq.employeeId) ?? null;
      const empData = { ...employee, company: empresa };
      const pdf = await generateReciboPDF(liq, empData, contrato);
      const dirLiq = path.join(dir, 'Liquidaciones', String(liq.year), safe(`${String(liq.month).padStart(2, '0')} - ${MESES[liq.month] ?? ''}`));
      ensureDir(dirLiq);
      const sufijo = liq.status === 'BORRADOR' ? ' (BORRADOR)' : '';
      fs.writeFileSync(path.join(dirLiq, `${safe(reciboFilename(liq, empData))}${sufijo}.pdf`), pdf);
      res.recibosPdf++;
    } catch (e) {
      res.errores.push(`Recibo ${liq.id} (${empresa.razonSocial}): ${(e as Error).message}`);
    }
  }

  // ── Nómina BPS (.bps) por período ───────────────────────────────
  for (const period of periods) {
    try {
      const nomina = await generarNominaBps(empresa.id, period.year, period.month);
      if (nomina.errores.length > 0) continue; // no declarable: se omite del respaldo
      const dirNom = path.join(dir, 'Nomina BPS', String(period.year));
      ensureDir(dirNom);
      // BPS usa ISO-8859-1 (Latin-1), igual que GNS.
      fs.writeFileSync(path.join(dirNom, safe(nomina.filename)), Buffer.from(nomina.contenido, 'latin1'));
      res.nominasBps++;
    } catch {
      // Período sin datos suficientes: se omite silenciosamente.
    }
  }

  // ── Adjuntos (fotos, cédulas, carnés) ───────────────────────────
  for (const adj of adjuntos) {
    try {
      const origen = path.resolve(STORAGE_DIR, adj.storageKey);
      if (!origen.startsWith(path.resolve(STORAGE_DIR) + path.sep)) continue; // anti path traversal
      if (!fs.existsSync(origen)) continue;
      const carpeta = adj.ownerType === 'PERSONA' ? nombrePersona(adj.ownerId) : adj.ownerType;
      const dirAdj = path.join(dir, 'Adjuntos', safe(carpeta));
      ensureDir(dirAdj);
      fs.copyFileSync(origen, path.join(dirAdj, safe(adj.fileName)));
      res.adjuntos++;
    } catch (e) {
      res.errores.push(`Adjunto ${adj.id} (${empresa.razonSocial}): ${(e as Error).message}`);
    }
  }
}

function escribirExcelEmpresa(
  file: string,
  empresa: Empresa,
  employees: Awaited<ReturnType<typeof prisma.employee.findMany>>,
  contratos: Awaited<ReturnType<typeof prisma.contrato.findMany>>,
  liquidaciones: Array<{ year: number; month: number; type: string; status: string; employeeId: string; totalHaberes: bigint; totalDescuentos: bigint; liquidoPercibir: bigint; diasTrabajados: number }>,
  nombrePersona: (id: string) => string,
): void {
  const wb = XLSX.utils.book_new();

  const empresaAoa: (string | number)[][] = [
    ['Razón social', empresa.razonSocial],
    ['Nombre de fantasía', empresa.nombreFantasia ?? ''],
    ['RUT', empresa.rut],
    ['Nº BPS', empresa.numeroBps ?? ''],
    ['Domicilio', empresa.domicilio ?? ''],
    ['Localidad', empresa.localidad ?? ''],
    ['Departamento', empresa.departamento ?? ''],
    ['Teléfono', empresa.telefono ?? ''],
    ['Email', empresa.email ?? ''],
    ['Grupo de actividad', empresa.grupoActividad ?? ''],
    ['Representante legal', empresa.representanteLegal ?? ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(empresaAoa), 'Empresa');

  const personasAoa = [
    ['CI', 'Legajo', 'Apellidos', 'Nombres', 'Fecha nac.', 'Sexo', 'Email', 'Teléfono', 'Ingreso', 'Activo'],
    ...employees.map((e) => [
      e.ci, e.employeeNumber ?? '', [e.apellido, e.apellido2].filter(Boolean).join(' '),
      [e.nombre, e.nombre2].filter(Boolean).join(' '),
      e.fechaNacimiento ? e.fechaNacimiento.toISOString().slice(0, 10) : '',
      e.sexo ?? '', e.email ?? '', e.telefono ?? '',
      e.fechaIngreso ? e.fechaIngreso.toISOString().slice(0, 10) : '', e.active ? 'Sí' : 'No',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(personasAoa), 'Personas');

  const contratosAoa = [
    ['Persona', 'Nº', 'Desde', 'Hasta', 'Cargo', 'Sector', 'Tipo remun.', 'Nominal $', 'Jornal $', 'Vigente'],
    ...contratos.map((c) => [
      nombrePersona(c.employeeId), c.numero,
      c.vigenciaDesde ? c.vigenciaDesde.toISOString().slice(0, 10) : '',
      c.vigenciaHasta ? c.vigenciaHasta.toISOString().slice(0, 10) : '',
      c.cargo ?? '', c.sector ?? '', c.tipoRemuneracion ?? '',
      toPesos(c.salarioNominal), c.jornal != null ? toPesos(c.jornal) : '',
      c.activo && !c.vigenciaHasta ? 'Sí' : 'No',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(contratosAoa), 'Contratos');

  const liqAoa = [
    ['Persona', 'Año', 'Mes', 'Tipo', 'Estado', 'Días', 'Haberes $', 'Descuentos $', 'Líquido $'],
    ...liquidaciones.map((l) => [
      nombrePersona(l.employeeId), l.year, MESES[l.month] ?? l.month, l.type, l.status, l.diasTrabajados,
      toPesos(l.totalHaberes), toPesos(l.totalDescuentos), toPesos(l.liquidoPercibir),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(liqAoa), 'Liquidaciones');

  XLSX.writeFile(wb, file);
}
