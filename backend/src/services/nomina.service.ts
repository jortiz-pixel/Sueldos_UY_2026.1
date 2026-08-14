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
import { LiquidationStatus, LiquidationType, PeriodStatus, ItemType } from '@prisma/client';
import { esEmpresaConstruccion } from './construccion.service';
import { fonasaCargasDeSeguroSalud } from './bps.service';
import { salarioProporcional } from '../utils/money';
import { generarLiquidacionMensual } from './liquidation.service';

// ── Formateo ─────────────────────────────────────────────────────
function ddmmaaaa(d: Date | null | undefined): string {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}${String(x.getMonth() + 1).padStart(2, '0')}${x.getFullYear()}`;
}

function monto(cents: bigint): string {
  return (Number(cents) / 100).toFixed(2);
}

// Monto de registro 7 al estilo GNS: sin ceros finales ("27719.4", "0", "4075.15").
function monto7(cents: bigint): string {
  return monto(cents).replace(/\.?0+$/, '') || '0';
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
  if (concepto === 'LICENCIA_NO_GOZADA' || concepto === 'LICENCIA_PENDIENTE') return 5; // licencia no gozada: gravada IRPF, no CESS
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
      vigenciaDesde: { lte: monthEnd },
      AND: [
        { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: monthStart } }] },
        { OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }] },
        // Incluir los contratos ACTIVOS y también los dados de BAJA (egreso, que
        // tienen fechaFin) dentro del mes: el trabajador que egresó igual trabajó
        // parte del mes y hay que declararlo (mensual + liquidación final). Se
        // excluyen los desactivados por error (activo=false y sin fechaFin).
        { OR: [{ activo: true }, { fechaFin: { not: null } }] },
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

    // Días EFECTIVOS trabajados a declarar en BPS (registro 6). Parten de los
    // días de la liquidación mensual/final (ya proporcionales en altas/bajas) y
    // se les descuentan las FALTAS, que en el recibo van como haber negativo
    // (días × valor de un día). Si no hay liquidación o quedó en $0 (no trabajó:
    // subsidio, licencia sin goce, ausencia total), se declaran 0 días — no 30.
    const liqConDias = liqsPersona.find((l) => l.type === 'MENSUAL') ?? liqsPersona.find((l) => l.type === 'LIQUIDACION_FINAL');
    let diasTrabajados = 0;
    if (liqConDias && liqConDias.totalHaberes > 0n) {
      // Valor de un día para traducir el monto de faltas a cantidad de días
      // (mismo criterio que la liquidación: mensual = nominal/30 · jornalero = jornal).
      const valorDia = contrato.salaryType === 'JORNALERO'
        ? (contrato.jornal ?? salarioProporcional(contrato.salarioNominal, 1, 30))
        : salarioProporcional(contrato.salarioNominal, 1, 30);
      let faltaDias = 0;
      if (valorDia > 0n) {
        for (const it of liqConDias.items) {
          if (it.concepto === 'FALTAS') faltaDias += Math.abs(Number(it.amount)) / Number(valorDia);
        }
      }
      diasTrabajados = Math.max(0, Math.round(liqConDias.diasTrabajados - faltaDias));
    }

    // Control: el código de SEGURO DE SALUD (Tabla 8) del contrato tiene que ser
    // coherente con las cargas (hijos/cónyuge) del ADICIONAL FONASA del recibo.
    // Si no coincide, se AVISA (no bloquea): el seguro declarado a BPS y la tasa
    // FONASA del recibo deben corresponder a la misma situación familiar.
    if (contrato.seguroSalud != null) {
      const cargasSeguro = fonasaCargasDeSeguroSalud(contrato.seguroSalud);
      const mensual = liqsPersona.find((l) => l.type === 'MENSUAL');
      const adic = mensual?.items.find((i) => i.concepto === 'FONASA_ADICIONAL');
      const det = adic?.calculationDetail as { hijosACargo?: number; conyugeACargo?: boolean } | null | undefined;
      if (cargasSeguro && det) {
        const hijosRecibo = (det.hijosACargo ?? 0) > 0;
        const conyugeRecibo = !!det.conyugeACargo;
        if (hijosRecibo !== cargasSeguro.hijos || conyugeRecibo !== cargasSeguro.conyuge) {
          const sn = (b: boolean) => (b ? 'sí' : 'no');
          advertencias.push(
            `${quien}: el seguro de salud del contrato (código ${contrato.seguroSalud}: hijos ${sn(cargasSeguro.hijos)}, cónyuge ${sn(cargasSeguro.conyuge)}) no coincide con el FONASA del recibo (hijos ${sn(hijosRecibo)}, cónyuge ${sn(conyugeRecibo)}). Revisá el código de seguro de salud o las cargas.`,
          );
        }
      }
    }

    // Conceptos (registro 7): agrupar ítems HABER por código BPS.
    // El concepto 1 siempre se declara (aunque sea 0); para los JORNALEROS de
    // CONSTRUCCIÓN, GNS declara también el 5 (partidas exentas) aunque sea 0.
    const porConcepto = new Map<number, bigint>();
    const siempreDeclarados = new Set<number>([1]);
    porConcepto.set(1, 0n);
    if (esEmpresaConstruccion(company) && contrato.salaryType === 'JORNALERO') {
      porConcepto.set(5, 0n);
      siempreDeclarados.add(5);
    }
    for (const liq of liqsPersona) {
      for (const item of liq.items) {
        if (item.itemType !== ItemType.HABER) continue;
        const cfg = codBpsPorCodigo.get(item.concepto);
        // Haber no gravado: solo se declara si tiene concepto BPS configurado
        // (codBps). Las partidas exentas del laudo de la construcción van con
        // codBps 5 "Monto Imponible Adicional IRPF" (criterio GNS: medias horas
        // + ropa + transporte + herramientas sumadas bajo el concepto 5). Los
        // reintegros de gastos y ajustes no gravados no se declaran.
        if (cfg && !cfg.gravado && cfg.codBps == null) continue;
        if (['REINTEGRO_GASTOS', 'AJUSTE_NO_GRAVADO', 'VIATICOS'].includes(item.concepto)) continue;
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
      // Tipo de remuneración BPS (Tabla 2): el código del contrato (1..6); si no
      // está, se deriva del salaryType (JORNALERO → 2, si no → 1).
      String(contrato.tipoRemuneracion ?? (contrato.salaryType === 'JORNALERO' ? 2 : 1)),
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
      if (!siempreDeclarados.has(code) && amount === 0n) continue;
      lineas5a7.push(['7', '', String(paisDoc), tipoDoc, doc, String(al), String(code), monto7(amount), '', ''].join('|'));
      totalNomina += amount;
    }

    personasOut.push({
      ci: e.ci,
      nombre: `${[e.apellido, e.apellido2].filter(Boolean).join(' ')}, ${[e.nombre, e.nombre2].filter(Boolean).join(' ')}`,
      diasTrabajados,
      seguroSalud: contrato.seguroSalud,
      vinculoFuncional: contrato.vinculoFuncional,
      conceptos: conceptosOrdenados.filter(([c, a]) => siempreDeclarados.has(c) || a !== 0n).map(([c, a]) => ({ codigo: c, monto: monto7(a) })),
      egreso,
    });
  }

  // ── Registros 1, 4 y 12 ────────────────────────────────────────
  // GNS no incluye ceros a la izquierda en Nº de empresa ni RUT.
  const nroEmpresa = soloDigitos(company.numeroBps ?? '').replace(/^0+(?=\d)/, '');
  const nroContribuyente = soloDigitos(company.rut ?? '').replace(/^0+(?=\d)/, '');
  const linea1 = [
    '1', 'N', '3.0', 'AsysTax Sueldos',
    nroEmpresa, nroContribuyente,
    String(company.tipoAporte ?? ''),
    (company.razonSocial || '').slice(0, 40),
    (company.domicilio || '').slice(0, 80),
    (company.telefono || '').slice(0, 15),
  ].join('|');

  const mesCargo = `${String(month).padStart(2, '0')}${year}`;
  // El monto total del cabezal va REDONDEADO al peso (criterio GNS, validado
  // contra los archivos reales: 37160.42 → 37160.00 · 32240.61 → 32241.00).
  const totalRedondeado = BigInt(Math.round(Number(totalNomina) / 100)) * 100n;
  const linea4 = ['4', mesCargo, String(company.tipoContribuyente ?? ''), monto(totalRedondeado), '', ''].join('|');

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
  // Extensión .bps, igual que los archivos que emite GNS y espera BPS.
  const filename = `N_${String(month).padStart(2, '0')}${String(year).slice(-2)}_${sigla}_${nroEmpresa || 'SINBPS'}.bps`;

  return { filename, contenido, montoTotal: monto(totalNomina), personas: personasOut, errores, advertencias };
}

// ═════════════════════════════════════════════════════════════════
// IMPORTACIÓN desde un archivo de nómina ATYR (migración desde GNS u
// otro software): crea/actualiza la empresa, las personas y sus contratos.
// ═════════════════════════════════════════════════════════════════

function parseFechaDdmmaaaa(s: string): Date | null {
  if (!/^\d{8}$/.test(s)) return null;
  const d = Number(s.slice(0, 2)), m = Number(s.slice(2, 4)), a = Number(s.slice(4));
  const fecha = new Date(a, m - 1, d);
  return isNaN(fecha.getTime()) ? null : fecha;
}

export interface NominaImportPlan {
  mesCargo: { month: number; year: number } | null;
  empresa: {
    accion: 'crear' | 'actualizar' | 'existente';
    razonSocial: string;
    rut: string;
    numeroBps: string;
    tipoAporte: number | null;
    tipoContribuyente: number | null;
  } | null;
  personas: Array<{
    accion: 'crear' | 'existente';
    ci: string;
    nombre: string;
    contrato: 'crear' | 'existente' | null;
    detalles: string;
    omitida?: boolean; // viene con fecha de baja en la nómina: no se agrega
  }>;
  // Liquidaciones generadas automáticamente a partir de la nómina (opcional).
  liquidacionesGeneradas: number;
  liquidacionesExistentes: number; // ya existían para el período: no se tocaron
  advertencias: string[];
  errores: string[];
}

interface PersonaParseada {
  doc: string;
  apellido1: string; apellido2: string; nombre1: string; nombre2: string;
  fechaNacimiento: Date | null;
  sexo: 'M' | 'F';
  nacionalidad: number;
  // registro 6
  acumulacion: number;
  fechaIngreso: Date | null;
  tipoRemuneracion: number;
  horasSemanales: number | null;
  vinculoFuncional: number | null;
  exoneracion: number | null;
  computos: number | null;
  diasTrabajados: number;
  seguroSalud: number | null;
  causalEgreso: number | null;
  fechaEgreso: Date | null;
  // registro 7 (concepto 1)
  montoImponible: bigint;
}

function parseNominaAtyr(contenido: string) {
  const lineas = contenido.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errores: string[] = [];
  let empresa: { nroEmpresa: string; rut: string; tipoAporte: number | null; razonSocial: string; domicilio: string; telefono: string } | null = null;
  let cabezal: { month: number; year: number; tipoContribuyente: number | null } | null = null;
  const personas = new Map<string, PersonaParseada>();

  for (const linea of lineas) {
    const f = linea.split('|');
    const tipo = f[0];
    if (tipo === '1') {
      empresa = {
        nroEmpresa: f[4] ?? '', rut: f[5] ?? '',
        tipoAporte: f[6] ? Number(f[6]) : null,
        razonSocial: f[7] ?? '', domicilio: f[8] ?? '', telefono: f[9] ?? '',
      };
      if ((f[1] ?? 'N') !== 'N') errores.push(`El archivo es de tipo "${f[1]}" — solo se importan nóminas (N).`);
    } else if (tipo === '4') {
      const mes = f[1] ?? '';
      cabezal = {
        month: Number(mes.slice(0, 2)), year: Number(mes.slice(2)),
        tipoContribuyente: f[2] ? Number(f[2]) : null,
      };
    } else if (tipo === '5') {
      const doc = f[3] ?? '';
      if (!doc) { errores.push('Registro 5 sin documento.'); continue; }
      personas.set(doc, {
        doc,
        apellido1: f[4] ?? '', apellido2: f[5] ?? '', nombre1: f[6] ?? '', nombre2: f[7] ?? '',
        fechaNacimiento: parseFechaDdmmaaaa(f[8] ?? ''),
        sexo: (f[9] ?? '1') === '2' ? 'F' : 'M',
        nacionalidad: f[10] ? Number(f[10]) : 1,
        acumulacion: 1, fechaIngreso: null, tipoRemuneracion: 1,
        horasSemanales: null, vinculoFuncional: null, exoneracion: null, computos: null,
        diasTrabajados: 0, seguroSalud: null, causalEgreso: null, fechaEgreso: null,
        montoImponible: 0n,
      });
    } else if (tipo === '6') {
      const p = personas.get(f[4] ?? '');
      if (!p) { errores.push(`Registro 6 para documento ${f[4]} sin registro 5 previo.`); continue; }
      p.acumulacion = f[5] ? Number(f[5]) : 1;
      p.fechaIngreso = parseFechaDdmmaaaa(f[6] ?? '');
      p.tipoRemuneracion = f[7] ? Number(f[7]) : 1;
      p.horasSemanales = f[8] ? Number(f[8]) : null;
      p.vinculoFuncional = f[9] ? Number(f[9]) : null;
      p.exoneracion = f[10] ? Number(f[10]) : null;
      p.computos = f[11] ? Number(f[11]) : null;
      p.diasTrabajados = f[15] ? Number(f[15]) : 0;
      p.seguroSalud = f[17] ? Number(f[17]) : null;
      p.causalEgreso = f[18] ? Number(f[18]) : null;
      p.fechaEgreso = parseFechaDdmmaaaa(f[19] ?? '');
    } else if (tipo === '7') {
      const p = personas.get(f[4] ?? '');
      if (!p) { errores.push(`Registro 7 para documento ${f[4]} sin registro 5 previo.`); continue; }
      const concepto = Number(f[6] ?? 0);
      const montoStr = f[7] ?? '0';
      if (concepto === 1) {
        p.montoImponible += BigInt(Math.round(Number(montoStr) * 100));
      }
    }
    // tipos 2, 3, 12: no se importan
  }

  if (!empresa) errores.push('El archivo no tiene registro de empresa (tipo 1).');
  if (personas.size === 0) errores.push('El archivo no tiene personas (registros 5).');
  return { empresa, cabezal, personas: [...personas.values()], errores };
}

export async function importarNominaAtyr(contenido: string, commit: boolean, generarLiquidaciones = false): Promise<NominaImportPlan> {
  const { empresa, cabezal, personas, errores } = parseNominaAtyr(contenido);
  const advertencias: string[] = [];
  const plan: NominaImportPlan = {
    mesCargo: cabezal ? { month: cabezal.month, year: cabezal.year } : null,
    empresa: null,
    personas: [],
    liquidacionesGeneradas: 0,
    liquidacionesExistentes: 0,
    advertencias,
    errores,
  };
  if (errores.length > 0 || !empresa) return plan;

  // Personas a liquidar automáticamente desde la nómina (si se pidió generar).
  const aLiquidar: Array<{ employeeId: string; nombre: string; dias: number | undefined }> = [];

  // ── Empresa: buscar por RUT; crear o completar datos faltantes ──
  let company = await prisma.company.findUnique({ where: { rut: empresa.rut } });
  const accionEmpresa: 'crear' | 'actualizar' | 'existente' = !company
    ? 'crear'
    : (!company.numeroBps || company.tipoAporte == null || company.tipoContribuyente == null) ? 'actualizar' : 'existente';

  if (commit) {
    if (!company) {
      company = await prisma.company.create({
        data: {
          rut: empresa.rut,
          razonSocial: empresa.razonSocial,
          domicilio: empresa.domicilio || undefined,
          telefono: empresa.telefono || undefined,
          numeroBps: empresa.nroEmpresa || undefined,
          tipoAporte: empresa.tipoAporte ?? undefined,
          tipoContribuyente: cabezal?.tipoContribuyente ?? undefined,
          bseRate: 25,
        },
      });
    } else if (accionEmpresa === 'actualizar') {
      company = await prisma.company.update({
        where: { id: company.id },
        data: {
          numeroBps: company.numeroBps ?? (empresa.nroEmpresa || undefined),
          tipoAporte: company.tipoAporte ?? (empresa.tipoAporte ?? undefined),
          tipoContribuyente: company.tipoContribuyente ?? (cabezal?.tipoContribuyente ?? undefined),
          domicilio: company.domicilio ?? (empresa.domicilio || undefined),
          telefono: company.telefono ?? (empresa.telefono || undefined),
        },
      });
    }
  }
  plan.empresa = {
    accion: accionEmpresa,
    razonSocial: company?.razonSocial ?? empresa.razonSocial,
    rut: empresa.rut,
    numeroBps: empresa.nroEmpresa,
    tipoAporte: empresa.tipoAporte,
    tipoContribuyente: cabezal?.tipoContribuyente ?? null,
  };

  // ── Personas y contratos ───────────────────────────────────────
  const monthStart = cabezal ? new Date(cabezal.year, cabezal.month - 1, 1) : null;
  const monthEnd = cabezal ? new Date(cabezal.year, cabezal.month, 0) : null;

  for (const p of personas) {
    const nombreCompleto = `${p.apellido1}${p.apellido2 ? ' ' + p.apellido2 : ''}, ${p.nombre1}`;
    const detalles: string[] = [];

    // Personas que en la nómina vienen con FECHA DE BAJA (egreso): no se agregan
    // (ni persona, ni contrato, ni liquidación). Solo se listan como omitidas.
    if (p.fechaEgreso) {
      plan.personas.push({
        accion: 'existente',
        ci: p.doc,
        nombre: nombreCompleto,
        contrato: null,
        detalles: `omitida — baja ${p.fechaEgreso.toLocaleDateString('es-UY')}`,
        omitida: true,
      });
      continue;
    }

    // Salario nominal estimado desde el imponible del mes (base ficto 30).
    let salarioNominal = p.montoImponible;
    if (p.diasTrabajados > 0 && p.diasTrabajados < 30 && p.tipoRemuneracion === 1) {
      salarioNominal = (p.montoImponible * 30n) / BigInt(Math.round(p.diasTrabajados));
      detalles.push(`nominal estimado desde ${p.diasTrabajados} días`);
    }
    if (p.montoImponible === 0n) {
      advertencias.push(`${nombreCompleto}: monto imponible 0 en la nómina — revisá el sueldo del contrato.`);
    }

    let employee = company
      ? await prisma.employee.findFirst({ where: { companyId: company.id, ci: p.doc } })
      : null;
    const crearPersona = !employee;

    if (commit && company) {
      if (!employee) {
        const maxEN = await prisma.employee.aggregate({ where: { companyId: company.id }, _max: { employeeNumber: true } });
        employee = await prisma.employee.create({
          data: {
            companyId: company.id,
            employeeNumber: (maxEN._max.employeeNumber ?? 0) + 1,
            ci: p.doc,
            nombre: p.nombre1 || '—',
            nombre2: p.nombre2 || undefined,
            apellido: p.apellido1 || '—',
            apellido2: p.apellido2 || undefined,
            fechaNacimiento: p.fechaNacimiento ?? undefined,
            sexo: p.sexo,
            nacionalidad: p.nacionalidad,
            fechaIngreso: p.fechaIngreso ?? new Date(),
            salarioNominal,
            salaryType: p.tipoRemuneracion === 2 ? 'JORNALERO' : 'MENSUAL',
          },
        });
      } else {
        // Completar datos BPS faltantes de la ficha (sin pisar los existentes).
        await prisma.employee.update({
          where: { id: employee.id },
          data: {
            nombre2: employee.nombre2 ?? (p.nombre2 || undefined),
            apellido2: employee.apellido2 ?? (p.apellido2 || undefined),
            fechaNacimiento: employee.fechaNacimiento ?? (p.fechaNacimiento ?? undefined),
            sexo: employee.sexo ?? p.sexo,
          },
        });
      }
    }

    // Contrato que solape el mes de cargo (o cualquier contrato vigente si no hay cabezal).
    let contratoExistente = null;
    if (employee && monthStart && monthEnd) {
      contratoExistente = await prisma.contrato.findFirst({
        where: {
          employeeId: employee.id,
          companyId: company!.id,
          activo: true,
          vigenciaDesde: { lte: monthEnd },
          AND: [
            { OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: monthStart } }] },
            { OR: [{ fechaFin: null }, { fechaFin: { gte: monthStart } }] },
          ],
        },
      });
    }

    if (commit && company && employee && !contratoExistente) {
      const count = await prisma.contrato.count({ where: { employeeId: employee.id } });
      await prisma.contrato.create({
        data: {
          employeeId: employee.id,
          companyId: company.id,
          numero: count + 1,
          vigenciaDesde: p.fechaIngreso ?? monthStart ?? new Date(),
          fechaIngreso: p.fechaIngreso ?? monthStart ?? new Date(),
          fechaFin: p.fechaEgreso ?? undefined,
          vigenciaHasta: p.fechaEgreso ?? undefined,
          causalEgresoCod: p.causalEgreso ?? undefined,
          salaryType: p.tipoRemuneracion === 2 ? 'JORNALERO' : 'MENSUAL',
          tipoRemuneracion: p.tipoRemuneracion ?? 1,
          salarioNominal,
          acumulacionLaboral: p.acumulacion,
          horasSemanales: p.horasSemanales ?? undefined,
          vinculoFuncional: p.vinculoFuncional ?? undefined,
          exoneracionAporte: p.exoneracion ?? undefined,
          computosEspeciales: p.computos ?? undefined,
          seguroSalud: p.seguroSalud ?? undefined,
        },
      });
    } else if (commit && contratoExistente) {
      // Completar códigos BPS faltantes del contrato existente.
      await prisma.contrato.update({
        where: { id: contratoExistente.id },
        data: {
          vinculoFuncional: contratoExistente.vinculoFuncional ?? (p.vinculoFuncional ?? undefined),
          seguroSalud: contratoExistente.seguroSalud ?? (p.seguroSalud ?? undefined),
          horasSemanales: contratoExistente.horasSemanales ?? (p.horasSemanales ?? undefined),
          computosEspeciales: contratoExistente.computosEspeciales ?? (p.computos ?? undefined),
          exoneracionAporte: contratoExistente.exoneracionAporte ?? (p.exoneracion ?? undefined),
          acumulacionLaboral: contratoExistente.acumulacionLaboral ?? p.acumulacion,
        },
      });
    }

    if (p.vinculoFuncional != null && p.vinculoFuncional !== 12) detalles.push(`vínculo ${p.vinculoFuncional}`);

    plan.personas.push({
      accion: crearPersona ? 'crear' : 'existente',
      ci: p.doc,
      nombre: nombreCompleto,
      contrato: contratoExistente ? 'existente' : 'crear',
      detalles: detalles.join(' · '),
    });

    // Para generar la liquidación del mes: solo con imponible > 0. Los días de
    // la nómina (netos de faltas) se pasan tal cual; si no vienen, el motor usa
    // el proporcional del contrato (30 o alta/baja del mes).
    if (commit && employee && p.montoImponible > 0n) {
      aLiquidar.push({ employeeId: employee.id, nombre: nombreCompleto, dias: p.diasTrabajados > 0 ? p.diasTrabajados : undefined });
    }
  }

  // ── Generar las liquidaciones del mes desde la nómina (opcional) ────
  // Sin duplicar: si la liquidación mensual del período ya existe, NO se toca.
  if (commit && generarLiquidaciones && cabezal && company && aLiquidar.length > 0) {
    const period = await prisma.payrollPeriod.upsert({
      where: { companyId_year_month: { companyId: company.id, year: cabezal.year, month: cabezal.month } },
      create: { companyId: company.id, year: cabezal.year, month: cabezal.month },
      update: {},
    });
    if (period.status === PeriodStatus.CERRADO) {
      advertencias.push(`El período ${String(cabezal.month).padStart(2, '0')}/${cabezal.year} está cerrado: no se generan liquidaciones.`);
    } else {
      for (const item of aLiquidar) {
        try {
          // Si ya hay una mensual de esa persona en el período, se respeta (no se pisa).
          const existente = await prisma.liquidation.findUnique({
            where: { periodId_employeeId_type: { periodId: period.id, employeeId: item.employeeId, type: LiquidationType.MENSUAL } },
            select: { id: true },
          });
          if (existente) { plan.liquidacionesExistentes++; continue; }
          await generarLiquidacionMensual({
            employeeId: item.employeeId,
            periodId: period.id,
            year: cabezal.year,
            month: cabezal.month,
            diasTrabajados: item.dias,
          });
          plan.liquidacionesGeneradas++;
        } catch (e) {
          advertencias.push(`No se pudo generar la liquidación de ${item.nombre}: ${(e as Error).message}`);
        }
      }
    }
  }

  return plan;
}

// ═════════════════════════════════════════════════════════════════
// RECTIFICATIVAS (formato ATYR v3.0)
//
// Al descargar una nómina (N) se guarda una "foto" de lo declarado por
// persona y concepto. La rectificativa (R) es la diferencia entre el estado
// actual de las liquidaciones y lo ya declarado (N + rectificativas previas):
//  - concepto prefijado con 1 = suma (ej. 11), con 2 = resta (ej. 21)
//  - personas omitidas en la N: registro 6 + concepto plano (como una nómina)
//  - en R, los registros 6/7 llevan el mes de cargo; el registro 4 va sin mes
// ═════════════════════════════════════════════════════════════════

interface ResumenDeclarado {
  // doc → { r5: línea registro 5, r6: línea registro 6 (formato N), conceptos: { codigo: centésimos (string, con signo en R) } }
  [doc: string]: { r5: string; r6?: string; conceptos: Record<string, string> };
}

function resumenDesdeContenido(contenido: string): ResumenDeclarado {
  const resumen: ResumenDeclarado = {};
  for (const linea of contenido.trimEnd().split('\n')) {
    const f = linea.split('|');
    if (f[0] === '5') {
      resumen[f[3]] = { r5: linea, conceptos: {} };
    } else if (f[0] === '6' && resumen[f[4]]) {
      resumen[f[4]].r6 = linea;
    } else if (f[0] === '7' && resumen[f[4]]) {
      const codigo = f[6];
      const cents = BigInt(Math.round(Number(f[7]) * 100));
      const prev = BigInt(resumen[f[4]].conceptos[codigo] ?? '0');
      resumen[f[4]].conceptos[codigo] = (prev + cents).toString();
    }
  }
  return resumen;
}

export async function registrarDeclaracion(
  companyId: string, year: number, month: number,
  tipo: 'N' | 'R', filename: string, resumen: ResumenDeclarado,
  montoTotal: bigint, userId?: string,
) {
  await prisma.nominaDeclaracion.create({
    data: {
      companyId, year, month, tipo, filename,
      montoTotal,
      resumen: resumen as object,
      createdBy: userId,
    },
  });
}

// Estado declarado = última N + rectificativas posteriores (deltas con signo).
async function estadoDeclarado(companyId: string, year: number, month: number) {
  const declaraciones = await prisma.nominaDeclaracion.findMany({
    where: { companyId, year, month },
    orderBy: { createdAt: 'asc' },
  });
  const ultimaN = [...declaraciones].reverse().find((d) => d.tipo === 'N');
  if (!ultimaN) return null;

  const estado: ResumenDeclarado = JSON.parse(JSON.stringify(ultimaN.resumen));
  for (const d of declaraciones) {
    if (d.tipo !== 'R' || d.createdAt <= ultimaN.createdAt) continue;
    const r = d.resumen as unknown as ResumenDeclarado;
    for (const doc of Object.keys(r)) {
      if (!estado[doc]) estado[doc] = { r5: r[doc].r5, r6: r[doc].r6, conceptos: {} };
      for (const [codigo, delta] of Object.entries(r[doc].conceptos)) {
        const prev = BigInt(estado[doc].conceptos[codigo] ?? '0');
        estado[doc].conceptos[codigo] = (prev + BigInt(delta)).toString();
      }
    }
  }
  return { estado, declaradaAt: ultimaN.createdAt, rectificativas: declaraciones.filter((d) => d.tipo === 'R' && d.createdAt > ultimaN.createdAt).length };
}

export interface RectificativaGenerada {
  filename: string;
  contenido: string;
  montoTotal: string;
  declaradaAt: Date | null;
  rectificativasPrevias: number;
  diferencias: Array<{
    doc: string;
    nombre: string;
    omitida: boolean;
    conceptos: Array<{ codigo: string; declarado: string; actual: string; delta: string }>;
  }>;
  resumenDeltas: ResumenDeclarado;
  errores: string[];
  advertencias: string[];
}

export async function generarRectificativaBps(companyId: string, year: number, month: number): Promise<RectificativaGenerada> {
  const vacio: RectificativaGenerada = {
    filename: '', contenido: '', montoTotal: '0.00', declaradaAt: null,
    rectificativasPrevias: 0, diferencias: [], resumenDeltas: {}, errores: [], advertencias: [],
  };

  // Estado actual: la nómina que saldría HOY (mismas validaciones que la N).
  const actual = await generarNominaBps(companyId, year, month);
  if (actual.errores.length > 0) return { ...vacio, errores: actual.errores, advertencias: actual.advertencias };

  const declarado = await estadoDeclarado(companyId, year, month);
  if (!declarado) {
    return {
      ...vacio,
      errores: [`No hay una nómina declarada de ${String(month).padStart(2, '0')}/${year}. Descargá primero el archivo de nómina (N): la rectificativa se calcula contra lo declarado.`],
    };
  }

  const resumenActual = resumenDesdeContenido(actual.contenido);
  const lineasActual = actual.contenido.trimEnd().split('\n');
  const mesCargo = `${String(month).padStart(2, '0')}${year}`;
  const nombrePorDoc = new Map(actual.personas.map((p) => [p.ci.replace(/\D/g, ''), p.nombre]));

  const lineas: string[] = [];
  const diferencias: RectificativaGenerada['diferencias'] = [];
  const resumenDeltas: ResumenDeclarado = {};
  let total = 0n;

  const docs = new Set([...Object.keys(resumenActual), ...Object.keys(declarado.estado)]);
  for (const doc of docs) {
    const act = resumenActual[doc];
    const dec = declarado.estado[doc];
    const omitida = !dec; // persona no declarada en la N original
    const codigos = new Set([
      ...Object.keys(act?.conceptos ?? {}),
      ...Object.keys(dec?.conceptos ?? {}),
    ]);

    const difs: RectificativaGenerada['diferencias'][number]['conceptos'] = [];
    const lineas7: string[] = [];
    const deltasDoc: Record<string, string> = {};

    for (const codigo of [...codigos].sort((a, b) => Number(a) - Number(b))) {
      const aAct = BigInt(act?.conceptos[codigo] ?? '0');
      const aDec = BigInt(dec?.conceptos[codigo] ?? '0');
      const delta = aAct - aDec;
      if (delta === 0n) continue;

      difs.push({ codigo, declarado: monto(aDec), actual: monto(aAct), delta: monto(delta) });
      deltasDoc[codigo] = delta.toString();

      // Persona omitida: conceptos planos (regla de nómina). Si no: 1X suma / 2X resta.
      const conceptoR = omitida ? codigo : (delta > 0n ? `1${codigo}` : `2${codigo}`);
      const importe = delta < 0n ? -delta : delta;
      total += importe;

      // Registro 7 en R: mes cargo en el campo 2.
      const base = (act?.r5 ?? dec!.r5).split('|'); // pais/tipoDoc del registro 5
      lineas7.push(['7', mesCargo, base[1], base[2], doc, '1', conceptoR, monto(importe), '', ''].join('|'));
    }

    if (!lineas7.length) continue;

    // Registro 5 (de la nómina actual, o de lo declarado si la persona ya no está).
    lineas.push(act?.r5 ?? dec!.r5);

    // Registro 6 solo para personas omitidas (con mes de cargo, regla de R).
    if (omitida) {
      const r6N = act?.r6 ?? lineasActual.find((l) => l.startsWith('6|') && l.split('|')[4] === doc);
      if (r6N) {
        const f = r6N.split('|');
        f[1] = mesCargo;
        lineas.push(f.join('|'));
      }
    }

    lineas.push(...lineas7);
    diferencias.push({ doc, nombre: nombrePorDoc.get(doc) ?? doc, omitida, conceptos: difs });
    resumenDeltas[doc] = { r5: act?.r5 ?? dec!.r5, r6: act?.r6, conceptos: deltasDoc };
  }

  const advertencias = [...actual.advertencias];
  if (!diferencias.length) {
    advertencias.push('No hay diferencias entre lo declarado y el estado actual: no corresponde rectificativa.');
  }

  // Registro 1 (tipo R) y 4 (sin mes de cargo) a partir de la nómina actual.
  const f1 = lineasActual[0].split('|'); f1[1] = 'R';
  const f4 = lineasActual[1].split('|'); f4[1] = ''; f4[3] = monto(total);
  const linea12 = lineasActual[lineasActual.length - 1];

  const contenido = [f1.join('|'), f4.join('|'), ...lineas, linea12].join('\n') + '\n';
  const filename = actual.filename.replace(/^N_/, 'R_');

  return {
    filename,
    contenido,
    montoTotal: monto(total),
    declaradaAt: declarado.declaradaAt,
    rectificativasPrevias: declarado.rectificativas,
    diferencias,
    resumenDeltas,
    errores: [],
    advertencias,
  };
}
