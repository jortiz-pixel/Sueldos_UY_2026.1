// ═══════════════════════════════════════════════════════════════════
// FOCER — Fondo de Cesantía y Retiro de la Industria de la Construcción
// ═══════════════════════════════════════════════════════════════════
// Declaración nominada de FOCER que presentan SOLO las empresas del
// Grupo 9 · Subgrupo 1 de los Consejos de Salarios (industria de la
// construcción). Es una aportación del 5% sobre la materia gravada BPS,
// separada de la nómina ATYR y del recibo (no se descuenta al trabajador).
//
// Formato de ancho fijo (delimitadores <FOCERINI>/<FOCERFIN>, líneas CRLF,
// codificación ISO-8859-1) validado BYTE A BYTE contra el archivo real de
// GNS `5667352052026.txt` (Lambrechts, 05/2026). Registros:
//   1  empresa    · 2  cabezal (período, totales)
//   4  por empleado (nombres, materia gravada e importe FOCER)
//   6  por empleado (domicilio y fecha de ingreso)
//
// Campos DERIVADOS de los datos del sistema: BPS, RUT, razón social,
// domicilio, departamento, teléfono, e-mail, período, cantidad, nombres,
// CI, tipo de documento, nacimiento, sexo, jornales, y los cuatro importes.
// El PIN FOCER del registro 2 se toma de la empresa (`company.focerPin`). En el
// registro 4, la posición 206 es el "tipo de FOCER" (1 = 0,5% · 2 = 5%) y la 208
// el "tipo de contrato" (1 indefinido · 2 a prueba · 3 a término · 4 suplencia),
// ambos del contrato; la 151 es el sexo. El bloque `1 1 198 2` (posiciones
// 153/155/157/161) es FIJO en todas las declaraciones (confirmado por el estudio).
import { LiquidationStatus, ItemType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { divRoundHalfUp, salarioProporcional } from '../utils/money';
import { esEmpresaConstruccion, grupoConsejoDeEmpresa } from './construccion.service';

// Tasa FOCER según el "tipo de FOCER" del contrato (registro 4, posición 206):
//   1 → 0,5% (50 bp) · 2 → 5% (500 bp, default). Validado: 8525.57 × 5% = 426.28.
function focerRateBp(focerTipo: number | null | undefined): number {
  return focerTipo === 1 ? 50 : 500;
}

// ── Helpers de formato de ancho fijo ───────────────────────────────
function padR(s: string, n: number): string {
  return (s || '').slice(0, n).padEnd(n, ' ');
}
function money(cents: bigint): string {
  const neg = cents < 0n;
  const c = neg ? -cents : cents;
  const ent = c / 100n;
  const dec = c % 100n;
  return `${neg ? '-' : ''}${ent}.${dec.toString().padStart(2, '0')}`;
}
function ddmmaaaa(d: Date | null | undefined): string {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}${String(x.getMonth() + 1).padStart(2, '0')}${x.getFullYear()}`;
}
function soloDigitos(s: string): string {
  return (s || '').replace(/\D/g, '');
}
function nombreBps(s: string | null | undefined): string {
  return (s || '').replace(/[^a-zA-ZáéíóúÁÉÍÓÚüÜñÑ' ]/g, '').trim();
}
// Escribe `s` en `buf` a partir de `start` (justificado a la izquierda).
function place(buf: string[], start: number, s: string): void {
  for (let i = 0; i < s.length; i++) buf[start + i] = s[i];
}
// Escribe `s` justificado a la DERECHA: último carácter en la columna endExcl-1.
function placeR(buf: string[], endExcl: number, s: string): void {
  place(buf, endExcl - s.length, s);
}

// ── Constructores de registros (ancho fijo) ─────────────────────────
// PUROS y sin dependencias: las POSICIONES y ANCHOS están validados byte a byte
// contra el archivo real de GNS. No cambiar una columna sin ajustar focer.test.ts.
export interface FocerEmpresaLinea {
  bps: string; rut: string; razonSocial: string; domicilio: string;
  departamento: string; telefono: string; gestoria: string;
  email: string; focerCodigo: string; month: number; year: number;
  cantidad: number; totGravado: bigint; totFocer: bigint;
}
export interface FocerEmpleadoLinea {
  tipoDoc: string; doc: string;
  apellido: string; apellido2: string | null; nombre: string; nombre2: string | null;
  fechaNacimiento: Date | null; sexoF: boolean; jornales: number | null;
  gravadoJornales: bigint; restoGravado: bigint; materiaGravada: bigint; focer: bigint;
  focerTipo: number; focerTipoContrato: number;
  direccion: string; departamento: string; telefono: string; fechaIngreso: Date | null;
}

// Registro 1 — empresa (219). [0]tipo·[1)bps14·[15)rut14·[29)razón40·[69)dom80·[149)depto20·[169)tel15·[184)gestoría35
export function buildFocerReg1(e: FocerEmpresaLinea): string {
  return '1' + padR(e.bps, 14) + padR(e.rut, 14) + padR(e.razonSocial, 40)
    + padR(e.domicilio, 80) + padR(e.departamento, 20) + padR(e.telefono, 15) + padR(e.gestoria, 35);
}
// Registro 2 — cabezal (100). [1)email50·[51)código8·[61)período6·rjust cant→71·totGrav→85·totFocer→100
export function buildFocerReg2(e: FocerEmpresaLinea): string {
  const b = new Array<string>(100).fill(' ');
  b[0] = '2';
  place(b, 1, padR(e.email, 50));
  place(b, 51, padR(e.focerCodigo, 8));
  place(b, 61, `${String(e.month).padStart(2, '0')}${e.year}`);
  placeR(b, 71, String(e.cantidad));
  placeR(b, 85, money(e.totGravado));
  placeR(b, 100, money(e.totFocer));
  return b.join('');
}
// Registro 4 — empleado (219). Nombres 30c/u, importes rjust, códigos 206/208.
export function buildFocerReg4(p: FocerEmpleadoLinea): string {
  const b = new Array<string>(219).fill(' ');
  b[0] = '4';
  b[3] = '1'; // país del documento (Uruguay)
  place(b, 4, padR(p.tipoDoc, 2));
  place(b, 6, padR(p.doc, 14));
  place(b, 22, padR(nombreBps(p.apellido), 30));
  place(b, 52, padR(nombreBps(p.apellido2), 30));
  place(b, 82, padR(nombreBps(p.nombre), 30));
  place(b, 112, padR(nombreBps(p.nombre2), 30));
  place(b, 142, ddmmaaaa(p.fechaNacimiento));
  b[151] = p.sexoF ? '2' : '1';
  // Bloque de códigos FIJO en toda declaración FOCER: `1 1 198 2`.
  b[153] = '1';
  b[155] = '1';
  place(b, 157, '198');
  b[161] = '2';
  if (p.jornales) placeR(b, 165, String(p.jornales));
  placeR(b, 175, money(p.gravadoJornales));
  placeR(b, 185, money(p.restoGravado));
  placeR(b, 195, money(p.materiaGravada));
  placeR(b, 205, money(p.focer));
  // 206 = tipo de FOCER (1 = 0,5% · 2 = 5%) · 208 = tipo de contrato
  // (1 indefinido · 2 a prueba · 3 a término · 4 suplencia).
  b[206] = String(p.focerTipo);
  b[208] = String(p.focerTipoContrato);
  place(b, 215, '0.00');
  return b.join('');
}
// Registro 6 — domicilio/depto/teléfono/ingreso del trabajador (155).
export function buildFocerReg6(p: FocerEmpleadoLinea): string {
  const b = new Array<string>(155).fill(' ');
  b[0] = '6';
  b[3] = '1';
  place(b, 4, padR(p.tipoDoc, 2));
  place(b, 6, padR(p.doc, 14));
  place(b, 22, padR(p.direccion, 80));
  place(b, 102, padR(p.departamento, 15));
  place(b, 117, padR(p.telefono, 15));
  place(b, 147, ddmmaaaa(p.fechaIngreso));
  return b.join('');
}
// Ensambla el archivo completo (delimitadores + CRLF).
export function ensamblarFocer(reg1: string, reg2: string, reg4: string[], reg6: string[]): string {
  return ['<FOCERINI>', reg1, reg2, ...reg4, ...reg6, '<FOCERFIN>'].join('\r\n');
}

// ── ¿La empresa debe declarar FOCER? (Grupo 9 · Subgrupo 1) ─────────
export function esEmpresaFocer(co?: {
  tipoAporte?: number | null;
  grupoActividadNum?: number | null;
  grupoActividad?: string | null;
  actividadPrincipal?: string | null;
  subgrupo?: string | null;
} | null): boolean {
  if (!co) return false;
  if (grupoConsejoDeEmpresa(co) !== 9) return false;
  if (!esEmpresaConstruccion(co)) return false;
  // Subgrupo 1 (o sin subgrupo cargado, se asume el principal de construcción).
  const sub = (co.subgrupo ?? '').trim();
  if (!sub) return true;
  const m = /(\d{1,2})/.exec(sub);
  return m ? Number(m[1]) === 1 : true;
}

export interface FocerGenerado {
  filename: string;
  contenido: string;
  totalGravado: string;
  totalFocer: string;
  empleados: Array<{
    ci: string;
    nombre: string;
    jornales: number | null;
    gravadoJornales: string;
    restoGravado: string;
    totalGravado: string;
    focer: string;
    direccion: string;
    departamento: string;
    telefono: string;
  }>;
  lineas: string[];
  errores: string[];
  advertencias: string[];
}

export async function generarFocer(companyId: string, year: number, month: number): Promise<FocerGenerado> {
  const errores: string[] = [];
  const advertencias: string[] = [];

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error('Empresa no encontrada');
  const gestoria = await prisma.gestoriaConfig.findUnique({ where: { id: 'default' } });

  if (!esEmpresaFocer(company)) {
    errores.push('FOCER corresponde solo a empresas del Grupo 9 · Subgrupo 1 (industria de la construcción).');
  }
  if (!company.numeroBps) errores.push('La empresa no tiene Nº de empresa BPS.');
  if (!company.rut) errores.push('La empresa no tiene RUT (Nº de contribuyente).');
  if (!company.domicilio) errores.push('La empresa no tiene domicilio.');

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  // Contratos que solapan el mes (mismo criterio que la nómina BPS).
  const contratos = await prisma.contrato.findMany({
    where: {
      companyId,
      vigenciaDesde: { lte: monthEnd },
      AND: [
        { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: monthStart } }] },
        { OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }] },
        { OR: [{ activo: true }, { fechaFin: { not: null } }] },
      ],
    },
    include: { employee: true },
    orderBy: { vigenciaDesde: 'desc' },
  });
  const porPersona = new Map<string, typeof contratos[number]>();
  for (const c of contratos) if (!porPersona.has(c.employeeId)) porPersona.set(c.employeeId, c);
  if (porPersona.size === 0) errores.push('No hay personas con contrato vigente en el mes.');

  const period = await prisma.payrollPeriod.findFirst({ where: { companyId, year, month } });
  const liquidations = period
    ? await prisma.liquidation.findMany({ where: { periodId: period.id }, include: { items: true } })
    : [];
  const borradores = liquidations.filter((l) => l.status === LiquidationStatus.BORRADOR);
  if (borradores.length > 0) {
    errores.push(`Hay ${borradores.length} liquidación(es) en BORRADOR: confirmalas antes de generar el FOCER.`);
  }
  const confirmadas = liquidations.filter((l) => l.status === LiquidationStatus.CONFIRMADO);

  // Mapa codBps/gravado de los conceptos (para separar materia gravada de exentos).
  const conceptosConfig = await prisma.concepto.findMany({ where: { OR: [{ companyId }, { companyId: null }] } });
  const cfgPorCodigo = new Map(conceptosConfig.map((c) => [c.codigo, { codBps: c.codBps, gravado: c.gravado }]));

  const personas = [...porPersona.values()].sort((a, b) =>
    soloDigitos(a.employee.ci).localeCompare(soloDigitos(b.employee.ci), 'es', { numeric: true }));

  const reg4: string[] = [];
  const reg6: string[] = [];
  const empleadosOut: FocerGenerado['empleados'] = [];
  let totGravado = 0n;
  let totFocer = 0n;

  for (const contrato of personas) {
    const e = contrato.employee;
    const quien = `${e.apellido} ${e.nombre} (CI ${e.ci})`;
    const doc = soloDigitos(e.ci);
    const tipoDoc = e.tipoDocumento || 'DO';
    if (!doc) errores.push(`${quien}: sin número de documento.`);
    if (!e.fechaNacimiento) errores.push(`${quien}: falta la fecha de nacimiento.`);

    const liqsPersona = confirmadas.filter((l) => l.employeeId === e.id);

    // Materia gravada BPS (m3) = suma de haberes que van a concepto 1/2 (imponible
    // + aguinaldo), NETA de faltas. Los exentos del laudo (codBps 5) y los no
    // gravados quedan afuera. Mismo criterio que el concepto 1 de la nómina ATYR.
    let materiaGravada = 0n;
    // Materia gravada de "jornales al laudo" (m1) = base HORAS_LAUDO del
    // presentismo (horas × valor hora laudo), guardada en baseCalculo del ítem.
    let gravadoJornales = 0n;
    for (const liq of liqsPersona) {
      for (const it of liq.items) {
        if (it.itemType !== ItemType.HABER) continue;
        if (it.concepto === 'FALTAS' || it.concepto === 'HORAS_TARDE') {
          materiaGravada += it.amount < 0n ? it.amount : -it.amount;
          continue;
        }
        if (it.concepto === 'PRESENTISMO_OBRA' && it.baseCalculo != null) {
          gravadoJornales = it.baseCalculo; // base laudo (idéntica en presentismo y mes completo)
        }
        if (['REINTEGRO_GASTOS', 'AJUSTE_NO_GRAVADO', 'VIATICOS'].includes(it.concepto)) continue;
        const cfg = cfgPorCodigo.get(it.concepto);
        if (cfg && !cfg.gravado && cfg.codBps == null) continue; // no gravado sin codBps → no declara
        const codBps = cfg?.codBps ?? null;
        if (codBps === 5) continue; // exento del laudo (adicional IRPF), no es materia gravada FOCER
        if (codBps === 41) continue; // salario vacacional, liquidación aparte
        materiaGravada += it.amount;
      }
    }
    if (materiaGravada < 0n) materiaGravada = 0n;
    if (gravadoJornales > materiaGravada) gravadoJornales = materiaGravada;
    const restoGravado = materiaGravada - gravadoJornales;
    const focerTipo = contrato.focerTipo ?? 2; // default 5%
    const focer = divRoundHalfUp(materiaGravada * BigInt(focerRateBp(focerTipo)), 10000n);

    // Jornales trabajados (mismo cálculo que los días del registro 6 de la nómina).
    const liqConDias = liqsPersona.find((l) => l.type === 'MENSUAL') ?? liqsPersona.find((l) => l.type === 'LIQUIDACION_FINAL');
    let jornales: number | null = null;
    if (liqConDias && liqConDias.totalHaberes > 0n) {
      const valorDia = contrato.salaryType === 'JORNALERO'
        ? (contrato.jornal ?? salarioProporcional(contrato.salarioNominal, 1, 30))
        : salarioProporcional(contrato.salarioNominal, 1, 30);
      let faltaDias = 0;
      if (valorDia > 0n) {
        for (const it of liqConDias.items) if (it.concepto === 'FALTAS') faltaDias += Math.abs(Number(it.amount)) / Number(valorDia);
      }
      jornales = Math.max(0, Math.round(liqConDias.diasTrabajados - faltaDias)) || null;
    }

    totGravado += materiaGravada;
    totFocer += focer;

    // Datos de contacto propios del TRABAJADOR (ficha de la persona).
    const direccion = (e.domicilio || e.localidad || '').toUpperCase();
    const departamento = e.departamento || '';
    const telefono = soloDigitos(e.telefono || '');
    if (!direccion || !telefono || !departamento) {
      const faltan = [!direccion && 'dirección', !departamento && 'departamento', !telefono && 'teléfono'].filter(Boolean).join(', ');
      advertencias.push(`${quien}: falta ${faltan} en la ficha de la persona (FOCER los declara por trabajador).`);
    }

    const lineaEmp: FocerEmpleadoLinea = {
      tipoDoc, doc,
      apellido: e.apellido, apellido2: e.apellido2, nombre: e.nombre, nombre2: e.nombre2,
      fechaNacimiento: e.fechaNacimiento, sexoF: e.sexo === 'F', jornales,
      gravadoJornales, restoGravado, materiaGravada, focer,
      focerTipo, focerTipoContrato: contrato.focerTipoContrato ?? 1,
      direccion, departamento, telefono, fechaIngreso: e.fechaIngreso,
    };
    reg4.push(buildFocerReg4(lineaEmp));
    reg6.push(buildFocerReg6(lineaEmp));

    empleadosOut.push({
      ci: doc,
      nombre: `${e.apellido} ${e.apellido2 ?? ''} ${e.nombre} ${e.nombre2 ?? ''}`.replace(/\s+/g, ' ').trim(),
      jornales,
      gravadoJornales: money(gravadoJornales),
      restoGravado: money(restoGravado),
      totalGravado: money(materiaGravada),
      focer: money(focer),
      direccion,
      departamento,
      telefono,
    });
  }

  // ── Registros 1 y 2 (empresa + cabezal) ────────────────────────────
  const bps = soloDigitos(company.numeroBps ?? '').replace(/^0+(?=\d)/, '');
  const rut = soloDigitos(company.rut ?? '');
  const focerCodigo = company.focerPin || '';
  if (!focerCodigo) advertencias.push('Falta el PIN FOCER de la empresa (cargalo en la configuración de la empresa) para que el archivo coincida con FOCER.');
  const lineaEmpresa: FocerEmpresaLinea = {
    bps, rut,
    razonSocial: company.razonSocial || '',
    domicilio: company.domicilio || '',
    departamento: company.departamento || '',
    telefono: soloDigitos(company.telefono || ''),
    gestoria: gestoria?.nombre || gestoria?.contacto || '',
    email: gestoria?.email || company.email || '',
    focerCodigo, month, year,
    cantidad: personas.length, totGravado, totFocer,
  };
  const reg1 = buildFocerReg1(lineaEmpresa);
  const reg2 = buildFocerReg2(lineaEmpresa);

  const lineas = ['<FOCERINI>', reg1, reg2, ...reg4, ...reg6, '<FOCERFIN>'];
  const contenido = lineas.join('\r\n');

  const sigla = (company.nombreFantasia || company.razonSocial || 'EMP')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
  const filename = `FOCER_${String(month).padStart(2, '0')}${year}_${sigla}_${bps}.txt`;

  return {
    filename,
    contenido,
    totalGravado: money(totGravado),
    totalFocer: money(totFocer),
    empleados: empleadosOut,
    lineas,
    errores,
    advertencias,
  };
}
