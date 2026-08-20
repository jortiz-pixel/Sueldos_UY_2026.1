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

    // ── Registro 4 (empleado) ───────────────────────────────────────
    const b4 = new Array<string>(219).fill(' ');
    b4[0] = '4';
    b4[3] = '1'; // país del documento (Uruguay)
    place(b4, 4, padR(tipoDoc, 2));
    place(b4, 6, padR(doc, 14));
    place(b4, 22, padR(nombreBps(e.apellido), 30));
    place(b4, 52, padR(nombreBps(e.apellido2), 30));
    place(b4, 82, padR(nombreBps(e.nombre), 30));
    place(b4, 112, padR(nombreBps(e.nombre2), 30));
    place(b4, 142, ddmmaaaa(e.fechaNacimiento));
    b4[151] = e.sexo === 'F' ? '2' : '1';
    // Bloque de códigos FIJO en toda declaración FOCER: `1 1 198 2`.
    b4[153] = '1';
    b4[155] = '1';
    place(b4, 157, '198');
    b4[161] = '2';
    if (jornales) placeR(b4, 165, String(jornales));
    placeR(b4, 175, money(gravadoJornales));
    placeR(b4, 185, money(restoGravado));
    placeR(b4, 195, money(materiaGravada));
    placeR(b4, 205, money(focer));
    // 206 = tipo de FOCER (1 = 0,5% · 2 = 5%) · 208 = tipo de contrato
    // (1 indefinido · 2 a prueba · 3 a término · 4 suplencia).
    b4[206] = String(focerTipo);
    b4[208] = String(contrato.focerTipoContrato ?? 1);
    place(b4, 215, '0.00');
    reg4.push(b4.join(''));

    // ── Registro 6 (domicilio, departamento, teléfono, fecha de ingreso) ──
    // Datos propios del TRABAJADOR (se cargan en la ficha de la persona).
    const direccion = (e.domicilio || e.localidad || '').toUpperCase();
    const departamento = e.departamento || '';
    const telefono = soloDigitos(e.telefono || '');
    if (!direccion || !telefono || !departamento) {
      const faltan = [!direccion && 'dirección', !departamento && 'departamento', !telefono && 'teléfono'].filter(Boolean).join(', ');
      advertencias.push(`${quien}: falta ${faltan} en la ficha de la persona (FOCER los declara por trabajador).`);
    }
    const b6 = new Array<string>(155).fill(' ');
    b6[0] = '6';
    b6[3] = '1';
    place(b6, 4, padR(tipoDoc, 2));
    place(b6, 6, padR(doc, 14));
    place(b6, 22, padR(direccion, 80));
    place(b6, 102, padR(departamento, 15));
    place(b6, 117, padR(telefono, 15));
    place(b6, 147, ddmmaaaa(e.fechaIngreso));
    reg6.push(b6.join(''));

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

  // ── Registro 1 (empresa) ───────────────────────────────────────────
  const bps = soloDigitos(company.numeroBps ?? '').replace(/^0+(?=\d)/, '');
  const rut = soloDigitos(company.rut ?? '');
  const reg1 =
    '1' +
    padR(bps, 14) +
    padR(rut, 14) +
    padR(company.razonSocial || '', 40) +
    padR(company.domicilio || '', 80) +
    padR(company.departamento || '', 20) +
    padR(soloDigitos(company.telefono || ''), 15) +
    padR(gestoria?.nombre || gestoria?.contacto || '', 35);

  // ── Registro 2 (cabezal) ───────────────────────────────────────────
  const focerCodigo = company.focerPin || '';
  if (!focerCodigo) advertencias.push('Falta el PIN FOCER de la empresa (cargalo en la configuración de la empresa) para que el archivo coincida con FOCER.');
  const b2 = new Array<string>(100).fill(' ');
  b2[0] = '2';
  place(b2, 1, padR(gestoria?.email || company.email || '', 50));
  place(b2, 51, padR(focerCodigo, 8));
  place(b2, 61, `${String(month).padStart(2, '0')}${year}`);
  placeR(b2, 71, String(personas.length));
  placeR(b2, 85, money(totGravado));
  placeR(b2, 100, money(totFocer));
  const reg2 = b2.join('');

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
