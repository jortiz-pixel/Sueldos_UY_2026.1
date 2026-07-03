/**
 * GENERADOR DE NÓMINA BPS — Formato ATYR v3.0
 *
 * Genera el archivo de declaración nominada (registros 1, 4, 5, 6, 7 y 12)
 * según "Presentación de nóminas, rectificativas y deducciones — Formato de
 * archivo Versión 3.0" (BPS ATyR, 8/2024), validado contra un archivo real
 * emitido por GNS Personal (N_0626_AMIG_8269951).
 *
 * Reglas clave del formato:
 *  - Campos separados por | (ASCII 124), registros por \n (ASCII 10).
 *  - Campo sin dato = vacío (dos separadores seguidos), sin ceros ni espacios.
 *  - Montos con punto decimal y 2 decimales.
 *  - Registro 6/7: el campo "mes cargo" va NULO en nóminas (solo rectificativas).
 */

import { prisma } from '../utils/prisma';
import { LiquidationStatus, ItemType } from '@prisma/client';

// ── Formateo ─────────────────────────────────────────────────────
function ddmmaaaa(d: Date | null | undefined): string {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}${String(x.getMonth() + 1).padStart(2, '0')}${x.getFullYear()}`;
}

function monto(cents: bigint): string {
  return (Number(cents) / 100).toFixed(2);
}

function soloDigitos(s: string): string {
  return (s || '').replace(/\D/g, '');
}

// Caracteres permitidos en nombres: letras (con ñ y acentos), espacios y apóstrofes.
function nombreBps(s: string | null | undefined): string {
  return (s || '').replace(/[^a-zA-ZáéíóúÁÉÍÓÚüÜñÑ' ]/g, '').trim();
}

// Concepto BPS (Tabla 15) para un ítem HABER de la liquidación.
// null = no se declara (partidas indemnizatorias: IPD, preaviso).
function codigoConceptoBps(concepto: string, codBpsConfigurado?: number | null): number | null {
  if (concepto.startsWith('AGUINALDO')) return 2;
  if (concepto === 'SALARIO_VACACIONAL') return 41;
  if (concepto === 'LICENCIA_PENDIENTE') return 5; // licencia no gozada: gravada IRPF, no CESS
  if (concepto === 'INDEMNIZACION' || concepto === 'PREAVISO') return null;
  return codBpsConfigurado ?? 1; // monto imponible mensual
}

export interface NominaGenerada {
  filename: string;
  contenido: string;
  montoTotal: string;
  personas: Array<{
    ci: string;
    nombre: string;
    diasTrabajados: number;
    seguroSalud: number | null;
    vinculoFuncional: number | null;
    conceptos: Array<{ codigo: number; monto: string }>;
    egreso: { causal: number; fecha: string } | null;
  }>;
  errores: string[];
  advertencias: string[];
}

export async function generarNominaBps(companyId: string, year: number, month: number): Promise<NominaGenerada> {
  const errores: string[] = [];
  const advertencias: string[] = [];

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error('Empresa no encontrada');

  const gestoria = await prisma.gestoriaConfig.findUnique({ where: { id: 'default' } });
  if (!gestoria) advertencias.push('No hay datos de gestoría configurados (registro 12): se emite con datos de la empresa.');

  // ── Validaciones de empresa (registros 1 y 4) ──────────────────
  if (!company.numeroBps) errores.push('La empresa no tiene Nº de empresa BPS.');
  if (!company.rut) errores.push('La empresa no tiene RUT (Nº de contribuyente).');
  if (company.tipoAporte == null) errores.push('La empresa no tiene tipo de aportación (Tabla 1).');
  if (company.tipoContribuyente == null) errores.push('La empresa no tiene tipo de contribuyente.');
  if (!company.domicilio) errores.push('La empresa no tiene domicilio.');

  // ── Roster: personas con contrato que solapa el mes ────────────
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const contratos = await prisma.contrato.findMany({
    where: {
      companyId,
      activo: true,
      vigenciaDesde: { lte: monthEnd },
      AND: [
        { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: monthStart } }] },
        { OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }] },
      ],
    },
    include: { employee: true },
    orderBy: { vigenciaDesde: 'desc' },
  });
  // Un contrato por persona (el más reciente que solapa el mes).
  const porPersona = new Map<string, typeof contratos[number]>();
  for (const c of contratos) if (!porPersona.has(c.employeeId)) porPersona.set(c.employeeId, c);

  if (porPersona.size === 0) errores.push('No hay personas con contrato vigente en el mes.');

  // ── Liquidaciones del período ──────────────────────────────────
  const period = await prisma.payrollPeriod.findFirst({ where: { companyId, year, month } });
  const liquidations = period
    ? await prisma.liquidation.findMany({
        where: { periodId: period.id },
        include: { items: true },
      })
    : [];
  const borradores = liquidations.filter((l) => l.status === LiquidationStatus.BORRADOR);
  if (borradores.length > 0) {
    errores.push(`Hay ${borradores.length} liquidación(es) en BORRADOR en ${String(month).padStart(2, '0')}/${year}: confirmalas antes de generar la nómina.`);
  }
  const confirmadas = liquidations.filter((l) => l.status === LiquidationStatus.CONFIRMADO);
  if (!period) advertencias.push('No existe período de liquidación para el mes: la nómina saldrá con montos en 0.');

  // Conceptos configurados (para mapear codBps de haberes manuales).
  const conceptosConfig = await prisma.concepto.findMany({
    where: { OR: [{ companyId }, { companyId: null }] },
  });
  const codBpsPorCodigo = new Map(conceptosConfig.map((c) => [c.codigo, { codBps: c.codBps, gravado: c.gravado }]));

  // ── Armar registros por persona ────────────────────────────────
  const lineas5a7: string[] = [];
  const personasOut: NominaGenerada['personas'] = [];
  let totalNomina = 0n;

  const personas = [...porPersona.values()].sort((a, b) =>
    soloDigitos(a.employee.ci).localeCompare(soloDigitos(b.employee.ci), 'es', { numeric: true }));

  for (const contrato of personas) {
    const e = contrato.employee;
    const quien = `${e.apellido} ${e.nombre} (CI ${e.ci})`;
    const doc = soloDigitos(e.ci);
    const tipoDoc = e.tipoDocumento || 'DO';
    const paisDoc = 1; // Uruguay (para PA extranjero se requiere país específico)

    // Validaciones de persona (registro 5)
    if (!doc) errores.push(`${quien}: sin número de documento.`);
    if (!e.fechaNacimiento) errores.push(`${quien}: falta la fecha de nacimiento.`);
    if (!e.sexo) errores.push(`${quien}: falta el sexo.`);
    // Validaciones de actividad (registro 6)
    if (contrato.vinculoFuncional == null) errores.push(`${quien}: falta el vínculo funcional (Tabla 3).`);
    if (contrato.seguroSalud == null) errores.push(`${quien}: falta el seguro de salud (Tabla 8).`);
    if (contrato.horasSemanales == null) errores.push(`${quien}: faltan las horas semanales.`);

    const liqsPersona = confirmadas.filter((l) => l.employeeId === e.id);
    if (period && liqsPersona.length === 0) {
      advertencias.push(`${quien}: sin liquidación confirmada en el mes — se declara con 0 días y $0 (subsidio, licencia sin goce, etc.).`);
    }

    // Días trabajados: de la liquidación mensual/final; 0 si no hay liquidación.
    const liqConDias = liqsPersona.find((l) => l.type === 'MENSUAL') ?? liqsPersona.find((l) => l.type === 'LIQUIDACION_FINAL');
    const diasTrabajados = liqConDias?.diasTrabajados ?? 0;

    // Conceptos (registro 7): agrupar ítems HABER por código BPS.
    const porConcepto = new Map<number, bigint>();
    porConcepto.set(1, 0n); // el concepto 1 siempre se declara (aunque sea 0)
    for (const liq of liqsPersona) {
      for (const item of liq.items) {
        if (item.itemType !== ItemType.HABER) continue;
        const cfg = codBpsPorCodigo.get(item.concepto);
        if (cfg && !cfg.gravado) continue; // haber no gravado: no se declara
        const code = codigoConceptoBps(item.concepto, cfg?.codBps);
        if (code == null) continue; // partida indemnizatoria
        porConcepto.set(code, (porConcepto.get(code) ?? 0n) + item.amount);
      }
    }

    // Egreso (causal + fecha, ambos o ninguno) si la baja cae dentro del mes.
    let egreso: { causal: number; fecha: string } | null = null;
    const fin = contrato.fechaFin ? new Date(contrato.fechaFin) : null;
    if (fin && fin >= monthStart && fin <= monthEnd) {
      const causal = contrato.causalEgresoCod ?? 1;
      if (contrato.causalEgresoCod == null) {
        advertencias.push(`${quien}: baja el ${fin.toLocaleDateString('es-UY')} sin causal de egreso — se declara causal 1 (Voluntario).`);
      }
      egreso = { causal, fecha: ddmmaaaa(fin) };
    }

    // Registro 5 — persona
    lineas5a7.push([
      '5', String(paisDoc), tipoDoc, doc,
      nombreBps(e.apellido), nombreBps(e.apellido2),
      nombreBps(e.nombre), nombreBps(e.nombre2),
      ddmmaaaa(e.fechaNacimiento), e.sexo === 'F' ? '2' : '1', String(e.nacionalidad ?? 1),
    ].join('|'));

    // Registro 6 — actividad (mes cargo NULO en nóminas)
    const al = contrato.acumulacionLaboral ?? 1;
    lineas5a7.push([
      '6', '', String(paisDoc), tipoDoc, doc,
      String(al),
      ddmmaaaa(contrato.fechaIngreso),
      contrato.salaryType === 'JORNALERO' ? '2' : '1',
      contrato.horasSemanales != null ? String(contrato.horasSemanales) : '',
      contrato.vinculoFuncional != null ? String(contrato.vinculoFuncional) : '',
      String(contrato.exoneracionAporte ?? 9),
      String(contrato.computosEspeciales ?? 99),
      '', '', '', // categoría, caja de actividad, asignación familiar (CT/RU)
      String(diasTrabajados),
      '0', // horas trabajadas (IC: 0)
      contrato.seguroSalud != null ? String(contrato.seguroSalud) : '',
      egreso ? String(egreso.causal) : '',
      egreso ? egreso.fecha : '',
    ].join('|'));

    // Registros 7 — remuneraciones por concepto (jornal y otros haberes: solo CT)
    const conceptosOrdenados = [...porConcepto.entries()].sort((a, b) => a[0] - b[0]);
    for (const [code, amount] of conceptosOrdenados) {
      if (code !== 1 && amount === 0n) continue;
      lineas5a7.push(['7', '', String(paisDoc), tipoDoc, doc, String(al), String(code), monto(amount), '', ''].join('|'));
      totalNomina += amount;
    }

    personasOut.push({
      ci: e.ci,
      nombre: `${[e.apellido, e.apellido2].filter(Boolean).join(' ')}, ${[e.nombre, e.nombre2].filter(Boolean).join(' ')}`,
      diasTrabajados,
      seguroSalud: contrato.seguroSalud,
      vinculoFuncional: contrato.vinculoFuncional,
      conceptos: conceptosOrdenados.filter(([c, a]) => c === 1 || a !== 0n).map(([c, a]) => ({ codigo: c, monto: monto(a) })),
      egreso,
    });
  }

  // ── Registros 1, 4 y 12 ────────────────────────────────────────
  const nroEmpresa = soloDigitos(company.numeroBps ?? '');
  const nroContribuyente = soloDigitos(company.rut ?? '');
  const linea1 = [
    '1', 'N', '3.0', 'AsysTax Sueldos',
    nroEmpresa, nroContribuyente,
    String(company.tipoAporte ?? ''),
    (company.razonSocial || '').slice(0, 40),
    (company.domicilio || '').slice(0, 80),
    (company.telefono || '').slice(0, 15),
  ].join('|');

  const mesCargo = `${String(month).padStart(2, '0')}${year}`;
  const linea4 = ['4', mesCargo, String(company.tipoContribuyente ?? ''), monto(totalNomina), '', ''].join('|');

  const linea12 = [
    '12',
    (gestoria?.nombre ?? '').slice(0, 30),
    (gestoria?.direccion ?? company.domicilio ?? '').slice(0, 80),
    (gestoria?.telefono ?? company.telefono ?? '').slice(0, 15),
    (gestoria?.fax ?? '').slice(0, 15),
    (gestoria?.contacto ?? gestoria?.nombre ?? company.razonSocial ?? '').slice(0, 30),
    (gestoria?.email ?? company.email ?? '').slice(0, 50),
  ].join('|');

  const contenido = [linea1, linea4, ...lineas5a7, linea12].join('\n') + '\n';

  // Nombre estilo GNS: N_MMAA_XXXX_NROEMPRESA.txt
  const sigla = (company.nombreFantasia || company.razonSocial || 'EMP')
    .replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4) || 'EMP';
  const filename = `N_${String(month).padStart(2, '0')}${String(year).slice(-2)}_${sigla}_${nroEmpresa || 'SINBPS'}.txt`;

  return { filename, contenido, montoTotal: monto(totalNomina), personas: personasOut, errores, advertencias };
}
