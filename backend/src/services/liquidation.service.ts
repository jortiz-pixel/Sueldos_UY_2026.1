/**
 * SERVICIO DE LIQUIDACIÓN MENSUAL
 */

import { LiquidationType, LiquidationStatus, ItemType, PayrollItem, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { salarioProporcional, divRoundHalfUp, applyRate, toCtms } from '../utils/money';
import { calcularAportesObreros, calcularAportesPatronales, calcularHorasExtra, fonasaCargasDeSeguroSalud } from './bps.service';
import { calcularIrpfMensual, calcularIrpfSimplificado } from './irpf.service';
import { parametersService } from './parameters.service';
import { resolverContratoEnMes, diasTrabajadosEnMes, datosLaboralesEfectivos } from './contract.service';
import { evaluarConcepto, valorUnitarioConcepto, ConceptoContext } from './concept.engine';
import { calcularAguinaldoBrutoSemestre } from './aguinaldo.service';
import { correspondeHerramientas, esEmpresaConstruccion, ensureConceptosConstruccion, esMiCasaSA, grupoConsejoDeEmpresa, jornalHoraVigente, recuadroDeEmpresa } from './construccion.service';
import { AppError } from '../middleware/errorHandler';

// Días hábiles de licencia GOZADA (LeaveRequest aprobada/pendiente) que caen
// dentro del mes, sin contar domingos (criterio uruguayo).
async function diasLicenciaDelMes(employeeId: string, year: number, month: number): Promise<number> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ['PENDIENTE', 'APROBADA'] },
      fechaInicio: { lte: monthEnd },
      fechaFin: { gte: monthStart },
    },
    select: { fechaInicio: true, fechaFin: true },
  });
  let dias = 0;
  for (const l of leaves) {
    const d = new Date(Math.max(new Date(l.fechaInicio).getTime(), monthStart.getTime()));
    const fin = new Date(Math.min(new Date(l.fechaFin).getTime(), monthEnd.getTime()));
    while (d <= fin) {
      if (d.getDay() !== 0) dias++; // sin domingos
      d.setDate(d.getDate() + 1);
    }
  }
  return dias;
}


// Valor de UNA falta para la liquidación dada. Mensual: sueldo básico / 30
// (ficto 30). Jornalero: el jornal diario. Devuelve el importe en centésimos.
export async function valorJornalFalta(liquidationId: string): Promise<bigint> {
  const liq = await prisma.liquidation.findUnique({
    where: { id: liquidationId },
    include: { period: true },
  });
  if (!liq) throw new AppError(404, 'Liquidación no encontrada');
  const employee = await prisma.employee.findUnique({ where: { id: liq.employeeId } });
  if (!employee) throw new AppError(404, 'Empleado no encontrado');
  const contrato = await resolverContratoEnMes(liq.employeeId, liq.year, liq.month, liq.period?.companyId);
  const labor = datosLaboralesEfectivos(employee, contrato);
  return labor.salaryType === 'MENSUAL'
    ? salarioProporcional(labor.salarioNominal, 1, 30)
    : (labor.jornal ?? salarioProporcional(labor.salarioNominal, 1, 30));
}

// PRIMA POR ANTIGÜEDAD grupo 21 (Servicio Doméstico, Consejo de Salarios 21):
// 0,5% del sueldo básico por cada AÑO completo de antigüedad, DESDE EL PRIMER
// año cumplido (1 año → 0,5% · 4 años → 2% · 10 años → 5%), con tope del 5%.
// Se ACTUALIZA CADA ENERO: rige el número de años completos al 1 de enero del
// año liquidado (ej.: ingreso marzo 2024 → recién en enero 2026 corresponde
// 0,5%). Mientras no corresponda, la línea figura en 0% (visible en 0, GNS).
export function calcularPrimaAntiguedad(
  fechaIngreso: Date, year: number, _month: number, sueldoBasicoMes: bigint,
): { anios: number; rate: number; amount: bigint; descripcion: string } {
  const alEnero = new Date(year, 0, 1); // 1 de enero del año liquidado
  const ing = new Date(fechaIngreso);
  let anios = alEnero.getFullYear() - ing.getFullYear();
  const aniversario = new Date(ing);
  aniversario.setFullYear(alEnero.getFullYear());
  if (aniversario > alEnero) anios--; // aún no cumplió el aniversario al 1/1
  anios = Math.max(anios, 0);
  const tramos = Math.min(anios, 10); // 0,5% por año desde el 1.º, tope 5% (10 años)
  const rate = tramos * 50; // 0,5% por año en basis points (tope 500 = 5%)
  return {
    anios,
    rate,
    amount: applyRate(sueldoBasicoMes, rate),
    descripcion: `Prima por Antigüedad (${anios} ${anios === 1 ? 'año' : 'años'})`,
  };
}

export interface LiquidacionInput {
  employeeId: string;
  periodId: string;
  year: number;
  month: number;
  diasTrabajados?: number;
  diasLicencia?: number;   // días de licencia gozada en el mes (desglosa el sueldo)
  horasTrabajadas?: number; // construcción: horas efectivas del mes (jornalero por horas)
  horasExtraDiurnas?: number;
  horasExtraNocturnas?: number;
  comisiones?: bigint;
  cantidadesConcepto?: Record<string, number>;
  otrosHaberes?: Array<{ concepto: string; descripcion: string; amount: bigint }>;
  otrosDescuentos?: Array<{ concepto: string; descripcion: string; amount: bigint }>;
  userId?: string;
}

export interface LiquidacionResult {
  liquidacionId: string;
  employeeId: string;
  items: Omit<PayrollItem, 'id' | 'liquidationId' | 'createdAt'>[];
  totalHaberes: bigint;
  totalDescuentos: bigint;
  totalPatronal: bigint;
  liquidoPercibir: bigint;
  parametersSnapshot: object;
}

export async function generarLiquidacionMensual(
  input: LiquidacionInput,
): Promise<LiquidacionResult> {
  const asOfDate = new Date(input.year, input.month - 1, 1);

  // La empresa empleadora de esta liquidación es la del período
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: input.periodId },
    include: { company: true },
  });
  if (!period) throw new AppError(404, 'Período no encontrado');

  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) throw new AppError(404, 'Empleado no encontrado');

  // Contrato que solapa el mes (≥1 día vigente), aunque el alta/baja caigan a
  // mitad de mes. La liquidación es estrictamente por contrato: si no hay
  // ninguno que cubra el período (p. ej. un mes entre dos zafras), NO se liquida.
  const contrato = await resolverContratoEnMes(input.employeeId, input.year, input.month, period.companyId);
  if (!contrato) {
    throw new AppError(
      409,
      `${employee.nombre} ${employee.apellido} no tiene un contrato vigente en ${period.company.razonSocial} para ${String(input.month).padStart(2, '0')}/${input.year}. Registrá el alta del contrato para ese período.`,
    );
  }
  const labor = datosLaboralesEfectivos(employee, contrato);

  const params = await parametersService.getPayrollParameters(asOfDate);
  const bseRate = period.company.bseRate;
  const fonasaPatronalRate = 500;

  // TITULAR DE EMPRESA UNIPERSONAL (vínculo funcional 1 — Patrón unipersonal):
  // NO se liquida como dependiente. Réplica EXACTA de la pantalla GNS (José
  // Lambrechts 07/2026): el ficto de la categoría (2.ª = 27.719,40) figura
  // como haber INFORMATIVO "Aporta (Para BPS)" con Total de Haberes 0;
  // descuentos: Aporte Jubilatorio 15% del ficto (4.157,91) + FRL 0,10%
  // (27,72) + Seguro x Enfermedad 3% de 6,5 BPC (44.616 → 1.338,48) +
  // Adicional según seguro de salud sobre 6,5 BPC (SS1: 3% → 1.338,48) +
  // IRPF 0,00. Líquido NEGATIVO (−6.862,59 = lo que el titular paga).
  if (contrato.vinculoFuncional === 1) {
    return generarLiquidacionTitularUnipersonal(input, period.companyId, contrato, labor.salarioNominal, asOfDate, params, employee);
  }

  // Días trabajados: los indicados, o los que surgen del solapamiento del
  // contrato con el mes (alta/baja a mitad de mes → liquidación parcial).
  const diasTrabajados = input.diasTrabajados ?? diasTrabajadosEnMes(contrato, input.year, input.month);

  // Días de licencia GOZADA del mes: los indicados o, si no, los que surgen de
  // las licencias aprobadas del calendario que caen en el período. La licencia
  // gozada se paga como jornal común (gravado) — se desglosa del sueldo.
  const diasLicencia = Math.min(
    input.diasLicencia ?? await diasLicenciaDelMes(input.employeeId, input.year, input.month),
    diasTrabajados,
  );
  const diasJornal = Math.max(0, diasTrabajados - diasLicencia);

  // CONSTRUCCIÓN (aportación CT): los jornaleros se liquidan POR HORAS. El
  // "jornal" del contrato es el VALOR HORA de la categoría; sin horas indicadas
  // se asume jornada de 8 hs por día trabajado. Con las horas, el resto de las
  // partidas del laudo (presentismo, ropa, transporte, herramientas) y los
  // fondos se calculan solos vía el motor de conceptos.
  const esConstruccion = esEmpresaConstruccion(period.company);
  // Automatización total para grupo 9: si la empresa es de construcción y aún
  // no tiene los conceptos del laudo (p. ej. fue creada antes de esta regla o
  // con aportación Industria y Comercio), se cargan acá mismo antes de liquidar.
  if (esConstruccion) await ensureConceptosConstruccion(period.companyId, true);
  // Hora laudo de la categoría del trabajador (recuadro NO incluidos en la ley):
  // base de los presentismos según el acta del Grupo 9 (validado con recibo GNS:
  // Oficial Albañil → 421,38). Si no hay dato, cae al valorFijo del concepto.
  const horaLaudo = esConstruccion
    ? await jornalHoraVigente(contrato?.categoria, 'NO_INCLUIDOS', asOfDate)
    : null;
  // HORA PAGADA de las horas comunes: el LAUDO VIGENTE del recuadro de la
  // empresa (incluidos si aporta CT, no incluidos si aporta IC), tomado de la
  // tabla de jornales — así los aumentos de ronda se aplican solos. Si el
  // contrato tiene pactado un valor MAYOR al laudo, se respeta el del contrato.
  const laudoVigente = esConstruccion
    ? await jornalHoraVigente(contrato?.categoria, recuadroDeEmpresa(period.company), asOfDate)
    : null;
  const horaPagada = esConstruccion
    ? ((labor.jornal ?? 0n) > (laudoVigente ?? 0n) ? (labor.jornal ?? 0n) : (laudoVigente ?? labor.jornal ?? 0n))
    : (labor.jornal ?? 0n);

  const horasConstruccion = esConstruccion && labor.salaryType === 'JORNALERO'
    ? (input.horasTrabajadas ?? diasTrabajados * 8)
    : input.horasTrabajadas;
  const jornadasConstruccion = horasConstruccion !== undefined
    ? Math.round((horasConstruccion / 8) * 100) / 100
    : undefined;

  // Días que quedan en la liquidación (y se declaran en la nómina BPS): en
  // construcción por horas son los JORNALES efectivos (horas ÷ 8, criterio
  // GNS: 8 hs → 1 día · sin horas → 0 días), no los días del contrato.
  const diasDeclarados = esConstruccion && labor.salaryType === 'JORNALERO' && horasConstruccion !== undefined
    ? Math.ceil(horasConstruccion / 8)
    : diasTrabajados;

  const salarioBase = labor.salaryType === 'MENSUAL'
    ? salarioProporcional(labor.salarioNominal, diasTrabajados, 30)
    : esConstruccion && horasConstruccion !== undefined
      ? divRoundHalfUp(horaPagada * BigInt(Math.round(horasConstruccion * 100)), 100n)
      : (labor.jornal ?? 0n) * BigInt(diasTrabajados);

  // Cantidades para el motor de conceptos (construcción): con solo cargar las
  // horas, todo lo demás sale automático — ropa siempre; transporte para
  // jornaleros; herramientas SOLO desde Medio Oficial; TICKET de alimentación y
  // MEDIA HORA de descanso 1 por jornada de 8 hs. La lluvia se indica a mano.
  // Lo indicado por el usuario pisa cualquier default.
  const cantidades: Record<string, number> = {
    ...(esConstruccion && horasConstruccion ? {
      DESGASTE_ROPA: horasConstruccion,
      TICKET_ALIMENTACION: jornadasConstruccion ?? 0,
      MEDIAS_HORAS: jornadasConstruccion ?? 0,
      ...(labor.salaryType === 'JORNALERO' ? { GASTOS_TRANSPORTE: horasConstruccion } : {}),
      ...(correspondeHerramientas(contrato?.categoria) ? { DESGASTE_HERRAMIENTAS: horasConstruccion } : {}),
    } : {}),
    ...(input.cantidadesConcepto ?? {}),
  };

  const items: Omit<PayrollItem, 'id' | 'liquidationId' | 'createdAt'>[] = [];

  // Valor del jornal (nominal/30 para mensual, o el jornal para jornalero),
  // usado en la descripción estilo GNS "Jornal N x valor".
  const jornalCent = labor.salaryType === 'MENSUAL'
    ? salarioProporcional(labor.salarioNominal, 1, 30)
    : esConstruccion ? horaPagada : (labor.jornal ?? 0n);
  const jornalTxt = (Number(jornalCent) / 100).toFixed(2);

  if (labor.salaryType === 'MENSUAL' && diasLicencia > 0) {
    // Desglose GNS: días trabajados como "Jornal" + días de licencia gozada como
    // "Licencia". Ambos gravados; la suma es el sueldo del mes (aportes sobre el total).
    const montoJornal = salarioProporcional(labor.salarioNominal, diasJornal, 30);
    const montoLicencia = salarioBase - montoJornal; // evita descuadre por redondeo
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: 'SUELDO_BASICO',
      descripcion: `Jornal ${diasJornal} x ${jornalTxt}`,
      baseCalculo: labor.salarioNominal,
      rate: null,
      amount: montoJornal,
      calculationDetail: { diasJornal, jornalCent: jornalCent.toString(), contratoId: contrato?.id ?? null } as unknown as Prisma.JsonValue,
    });
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: 'LICENCIA_GOZADA',
      descripcion: `Licencia ${diasLicencia} x ${jornalTxt}`,
      baseCalculo: labor.salarioNominal,
      rate: null,
      amount: montoLicencia,
      calculationDetail: { diasLicencia, jornalCent: jornalCent.toString() } as unknown as Prisma.JsonValue,
    });
  } else {
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: 'SUELDO_BASICO',
      descripcion: labor.salaryType === 'MENSUAL'
        ? `Sueldo básico ${diasTrabajados < 30 ? `(${diasTrabajados}/30 días)` : ''}`
        : esConstruccion && horasConstruccion !== undefined
          ? `Horas Comunes ${horasConstruccion} x ${jornalTxt}`
          : `Jornal (${diasTrabajados} días)`,
      baseCalculo: labor.salarioNominal,
      rate: diasTrabajados < 30 ? Math.round(diasTrabajados * 10000 / 30) : null,
      amount: salarioBase,
      calculationDetail: {
        salarioNominal: labor.salarioNominal.toString(),
        diasTrabajados,
        diasMes: 30,
        contratoId: contrato?.id ?? null,
      } as unknown as Prisma.JsonValue,
    });
  }

  // GRUPO 21 (Consejo de Salarios): la PRIMA POR ANTIGÜEDAD viene PRECARGADA
  // junto con el sueldo — 0,5% del sueldo básico por año completo, tope 5%.
  if (grupoConsejoDeEmpresa(period.company) === 21) {
    const ingreso = contrato?.fechaIngreso ?? employee.fechaIngreso;
    const prima = ingreso ? calcularPrimaAntiguedad(ingreso, input.year, input.month, salarioBase) : null;
    if (prima) {
      items.push({
        employeeId: input.employeeId,
        itemType: ItemType.HABER,
        concepto: 'PRIMA_ANTIGUEDAD',
        descripcion: prima.descripcion,
        baseCalculo: salarioBase,
        rate: prima.rate,
        amount: prima.amount,
        calculationDetail: {
          grupo: 21,
          aniosAntiguedad: prima.anios,
          fechaIngreso: new Date(ingreso!).toISOString(),
          rateBp: prima.rate,
          topeBp: 500,
        } as unknown as Prisma.JsonValue,
      });
    }
  }

  // MI CASA SOCIEDAD ANÓNIMA: PRIMA POR ANTIGÜEDAD fija del 10% del sueldo
  // básico, PRECARGADA junto con el sueldo (aplica SOLO a esta empresa; no
  // altera la prima progresiva del grupo 21). Reusa el ítem PRIMA_ANTIGUEDAD
  // (gravado, editable/borrable en la ficha). Guarda: solo si aún no se agregó
  // una prima (evita duplicar si la empresa fuese además grupo 21).
  if (esMiCasaSA(period.company) && !items.some((i) => i.concepto === 'PRIMA_ANTIGUEDAD')) {
    const primaRate = 1000; // 10% en basis points
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: 'PRIMA_ANTIGUEDAD',
      descripcion: 'Prima por Antigüedad (10%)',
      baseCalculo: salarioBase,
      rate: primaRate,
      amount: applyRate(salarioBase, primaRate),
      calculationDetail: {
        empresaFija: 'MI CASA SOCIEDAD ANONIMA',
        rateBp: primaRate,
      } as unknown as Prisma.JsonValue,
    });
  }

  if ((input.horasExtraDiurnas ?? 0) > 0 || (input.horasExtraNocturnas ?? 0) > 0) {
    const he = calcularHorasExtra(
      labor.salarioNominal,
      input.horasExtraDiurnas ?? 0,
      input.horasExtraNocturnas ?? 0,
    );
    if (he.importeHorasDiurnas > 0n) {
      items.push({
        employeeId: input.employeeId,
        itemType: ItemType.HABER,
        concepto: 'HORAS_EXTRA_DIURNAS',
        descripcion: `Horas extra diurnas (${input.horasExtraDiurnas}h × 2× valor hora)`,
        baseCalculo: he.valorHoraNormal,
        rate: 20000,
        amount: he.importeHorasDiurnas,
        calculationDetail: { valorHoraNormal: he.valorHoraNormal.toString(), horas: input.horasExtraDiurnas } as unknown as Prisma.JsonValue,
      });
    }
    if (he.importeHorasNocturnas > 0n) {
      items.push({
        employeeId: input.employeeId,
        itemType: ItemType.HABER,
        concepto: 'HORAS_EXTRA_NOCTURNAS',
        descripcion: `Horas extra nocturnas (${input.horasExtraNocturnas}h × 2.5× valor hora)`,
        baseCalculo: he.valorHoraNormal,
        rate: 25000,
        amount: he.importeHorasNocturnas,
        calculationDetail: { valorHoraNormal: he.valorHoraNormal.toString(), horas: input.horasExtraNocturnas } as unknown as Prisma.JsonValue,
      });
    }
  }

  if (input.comisiones && input.comisiones > 0n) {
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: 'COMISIONES',
      descripcion: 'Comisiones del período',
      baseCalculo: null,
      rate: null,
      amount: input.comisiones,
      calculationDetail: null,
    });
  }

  for (const oh of input.otrosHaberes ?? []) {
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: oh.concepto,
      descripcion: oh.descripcion,
      baseCalculo: null,
      rate: null,
      amount: oh.amount,
      calculationDetail: null,
    });
  }

  // MOTOR DE CONCEPTOS: conceptos activos aplicables a la empresa empleadora.
  // Incluye los propios de la empresa y los comunes (companyId null), excluyendo
  // los que esta empresa decidió ocultar.
  const conceptos = await prisma.concepto.findMany({
    where: {
      activo: true,
      OR: [{ companyId: period.companyId }, { companyId: null }],
      NOT: { ocultoEn: { has: period.companyId } },
    },
    orderBy: [{ orden: 'asc' }, { codigo: 'asc' }],
  });

  let gravadoHaberes = items
    .filter((i) => i.itemType === ItemType.HABER)
    .reduce((sum, i) => sum + i.amount, 0n);

  // FALTAS: en el recibo (estilo GNS) las faltas figuran del lado de los HABERES
  // como un haber NEGATIVO (días × jornal). Así el "Total de Haberes" ya sale
  // NETO de faltas y TODOS los descuentos (aportes personales, patronales e
  // IRPF) se calculan sobre ese neto. Se detectan por el código FALTAS y pueden
  // venir cargadas a mano ("otros descuentos") o desde el motor de conceptos.
  const esFalta = (codigo: string) => codigo.trim().toUpperCase() === 'FALTAS';
  const montoFalta = (v: bigint) => (v < 0n ? v : -v); // el importe de falta siempre resta

  const otrosDescuentosSinFaltas = (input.otrosDescuentos ?? []).filter((od) => !esFalta(od.concepto));
  for (const od of (input.otrosDescuentos ?? []).filter((od) => esFalta(od.concepto))) {
    const amount = montoFalta(od.amount);
    if (amount === 0n) continue;
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: od.concepto,
      descripcion: od.descripcion,
      baseCalculo: null,
      rate: null,
      amount,
      calculationDetail: { falta: true } as unknown as Prisma.JsonValue,
    });
    gravadoHaberes += amount; // amount es negativo → reduce el neto imponible
  }

  // Media hora PAGADA (unidad de MEDIAS_HORAS): hora pagada ÷ 2 TRUNCADA al
  // centésimo (444,85/2 → 222,42, como GNS). Hora pagada = unidad de la lluvia.
  const valorMediaHora = esConstruccion ? horaPagada / 2n : undefined;
  const valorHoraPagada = esConstruccion ? horaPagada : undefined;

  for (const c of conceptos.filter((c) => c.tipoOperacion === ItemType.DESCUENTO_OBRERO && esFalta(c.codigo))) {
    const amount = montoFalta(evaluarConcepto(c, {
      salarioNominal: labor.salarioNominal,
      sueldoBasico: salarioBase,
      haberesGravados: gravadoHaberes,
      cantidades,
      horasTrabajadas: horasConstruccion,
      horaLaudo: horaLaudo ?? undefined,
      valorMediaHora,
      valorHoraPagada,
    }));
    if (amount === 0n) continue;
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: c.codigo,
      descripcion: c.nombre,
      baseCalculo: null,
      rate: c.valorRate ?? null,
      amount,
      calculationDetail: { motor: 'CONCEPTO', tipoCalculo: c.tipoCalculo, falta: true } as unknown as Prisma.JsonValue,
    });
    gravadoHaberes += amount;
  }

  const ctxConcepto: ConceptoContext = {
    salarioNominal: labor.salarioNominal,
    sueldoBasico: salarioBase,
    haberesGravados: gravadoHaberes,
    cantidades,
    horasTrabajadas: horasConstruccion,
    horaLaudo: horaLaudo ?? undefined,
    valorMediaHora,
    valorHoraPagada,
  };

  // En modo construcción por horas, el recibo GNS muestra TODAS las líneas del
  // laudo aunque den 0 (ej. lluvia sin horas cargadas). Herramientas solo desde
  // ½ Oficial y transporte solo para jornaleros (si no corresponden, no figuran).
  const modoHorasConstruccion = esConstruccion && horasConstruccion !== undefined;
  const CODIGOS_LAUDO_G9 = new Set([
    'HORAS_LLUVIA', 'PRESENTISMO_OBRA', 'PRES_MES_COMPLETO', 'TICKET_ALIMENTACION',
    'MEDIAS_HORAS', 'DESGASTE_ROPA', 'GASTOS_TRANSPORTE', 'DESGASTE_HERRAMIENTAS',
  ]);
  const mostrarEnCero = (codigo: string) => modoHorasConstruccion
    && CODIGOS_LAUDO_G9.has(codigo)
    && (codigo !== 'DESGASTE_HERRAMIENTAS' || correspondeHerramientas(contrato?.categoria))
    && (codigo !== 'GASTOS_TRANSPORTE' || labor.salaryType === 'JORNALERO');

  for (const c of conceptos.filter((c) => c.tipoOperacion === ItemType.HABER)) {
    ctxConcepto.haberesGravados = gravadoHaberes;
    const amount = evaluarConcepto(c, ctxConcepto);
    if (amount <= 0n && !mostrarEnCero(c.codigo)) continue;
    if (amount < 0n) continue;
    // Detalle estilo GNS: "N x valor" para cantidad×valor; base para porcentajes.
    const esCantidadValor = c.tipoCalculo === 'CANTIDAD_VALOR';
    const cantidad = esCantidadValor ? (cantidades[c.codigo] ?? 0) : undefined;
    const valorUnit = esCantidadValor ? valorUnitarioConcepto(c, ctxConcepto) : undefined;
    const basePorcentaje = c.baseCalculo === 'HORAS_LAUDO'
      ? divRoundHalfUp((horaLaudo ?? c.valorFijo ?? 0n) * BigInt(Math.round((horasConstruccion ?? 0) * 100)), 100n)
      : null;
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: c.codigo,
      descripcion: c.nombre,
      baseCalculo: basePorcentaje,
      rate: c.valorRate ?? null,
      amount,
      calculationDetail: {
        motor: 'CONCEPTO',
        tipoCalculo: c.tipoCalculo,
        gravado: c.gravado,
        baseCalculo: c.baseCalculo,
        ...(esCantidadValor ? { cantidad, valorUnit: (valorUnit ?? 0n).toString() } : {}),
      } as unknown as Prisma.JsonValue,
    });
    if (c.gravado) gravadoHaberes += amount;
  }

  const totalHaberes = items
    .filter((i) => i.itemType === ItemType.HABER)
    .reduce((sum, i) => sum + i.amount, 0n);

  // El total de haberes ya está NETO de faltas → esa es la base imponible sobre
  // la que se calculan los aportes personales, patronales y el IRPF.
  const baseGravada = gravadoHaberes;

  // La base de Fondo Social / Fondo de Vivienda (fórmula GNS "ApliAFondos") se
  // calcula más abajo, después del IRPF, porque lo necesita.

  // En junio y diciembre el ADICIONAL de FONASA del aguinaldo se cobra en la
  // mensualidad: su base es (nominal del mes + aguinaldo del semestre). El
  // aguinaldo se calcula sobre las mensuales confirmadas del semestre (no
  // depende de la mensual de este mes).
  const fonasaAdicionalExtraBase = (input.month === 6 || input.month === 12)
    ? (await calcularAguinaldoBrutoSemestre(input.employeeId, input.year, input.month)).bruto
    : 0n;

  // El adicional FONASA (hijos/cónyuge) se determina por el código de Seguro de
  // Salud (Tabla 8) del contrato vigente; si el código no lo determina, se usan
  // los datos del empleado. Así, al cambiar el seguro de salud del contrato (o
  // crear un contrato nuevo desde una fecha), la mensualidad toma el % correcto.
  const cargasFonasa = fonasaCargasDeSeguroSalud(contrato?.seguroSalud);
  const fonasaHijosACargo = cargasFonasa ? (cargasFonasa.hijos ? 1 : 0) : employee.hijosACargo;
  const fonasaConyugeACargo = cargasFonasa ? cargasFonasa.conyuge : employee.conyugeACargo;

  const aportesObreros = calcularAportesObreros({
    salarioNominal: baseGravada,
    hijosACargo: fonasaHijosACargo,
    conyugeACargo: fonasaConyugeACargo,
    params,
    bseRateEmpresa: bseRate,
    fonasaAdicionalExtraBase,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'BPS_JUBILATORIO',
    descripcion: 'BPS Jubilatorio',
    baseCalculo: aportesObreros.baseJubilatorio,
    rate: params.bpsJubilatorioRate,
    amount: aportesObreros.jubilatorio,
    calculationDetail: { base: aportesObreros.baseJubilatorio.toString(), gravado: baseGravada.toString(), rateBp: params.bpsJubilatorioRate } as unknown as Prisma.JsonValue,
  });

  // FONASA (Seguro por Enfermedad): 3% fijo sobre el total de haberes.
  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'FONASA',
    descripcion: 'FONASA (Seguro por Enfermedad)',
    baseCalculo: baseGravada,
    rate: aportesObreros.detail.fonasaSeguroRate,
    amount: aportesObreros.fonasaBasico,
    calculationDetail: { base: baseGravada.toString(), rateBp: aportesObreros.detail.fonasaSeguroRate } as unknown as Prisma.JsonValue,
  });

  // Adicional FONASA: complemento según el seguro de salud (escalón > 2,5 BPC +
  // hijos + cónyuge). Partida SEPARADA. En junio/diciembre su base incluye el
  // aguinaldo del semestre (fonasaAdicionalBase). SIEMPRE figura en el recibo,
  // aun en 0 ("Adicional Fonasa 0%", estilo GNS).
  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'FONASA_ADICIONAL',
    descripcion: 'Adicional FONASA',
    baseCalculo: aportesObreros.detail.fonasaAdicionalBase,
    rate: aportesObreros.detail.fonasaAdicionalRate,
    amount: aportesObreros.fonasaFamilia,
    calculationDetail: {
      base: aportesObreros.detail.fonasaAdicionalBase.toString(),
      rateBp: aportesObreros.detail.fonasaAdicionalRate,
      hijosRate: aportesObreros.detail.fonasaHijosRate,
      conyugeRate: aportesObreros.detail.fonasaConyugeRate,
      hijosACargo: fonasaHijosACargo,
      conyugeACargo: fonasaConyugeACargo,
      seguroSalud: contrato?.seguroSalud ?? null,
    } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'FRL',
    descripcion: 'Fondo de Reconversión Laboral',
    baseCalculo: baseGravada,
    rate: params.frlObreroRate,
    amount: aportesObreros.frl,
    calculationDetail: { base: baseGravada.toString(), rateBp: params.frlObreroRate } as unknown as Prisma.JsonValue,
  });

  let irpfRetencion = 0n;
  let irpfDetail: Prisma.JsonValue = {};

  if (employee.irpfMetodo === 'SIMPLIFICADO' && employee.irpfFicto) {
    irpfRetencion = calcularIrpfSimplificado(employee.irpfFicto, params);
    irpfDetail = { metodo: 'SIMPLIFICADO', ficto: employee.irpfFicto.toString() };
  } else {
    const irpfResult = calcularIrpfMensual({
      salarioNominal: baseGravada,
      fonasaMensual: aportesObreros.fonasaTotal,
      bpsMensual: aportesObreros.jubilatorio,
      hijosACargo: employee.hijosACargo,
      hijosDiscapacitados: employee.hijosDiscapacitados,
      conyugeACargo: employee.conyugeACargo,
      params,
    });
    irpfRetencion = irpfResult.retencionMensual;
    irpfDetail = {
      metodo: 'PROYECCION_ANUAL',
      rentaNetaMensual: irpfResult.rentaNetaMensual.toString(),
      rentaNetaAnual: irpfResult.rentaNetaAnual.toString(),
      deduccionAportesAnual: irpfResult.deduccionAportesAnual.toString(),
      deduccionHijosAnual: irpfResult.deduccionHijosAnual.toString(),
      deduccionConyugeAnual: irpfResult.deduccionConyugeAnual.toString(),
      tasaDeduccionBp: irpfResult.tasaDeduccionBp,
      creditoDeducciones: irpfResult.creditoDeducciones.toString(),
      impuestoPrimarioAnual: irpfResult.impuestoPrimarioAnual.toString(),
      baseIrpfAnual: irpfResult.baseIrpfAnual.toString(),
      impuestoAnual: irpfResult.impuestoAnual.toString(),
      tramos: irpfResult.tramos.map((t) => ({
        fromBpc: t.fromCtms.toString(),
        toBpc: t.toCtms?.toString() ?? null,
        rate: t.ratePercent,
        baseEnTramo: t.baseEnTramo.toString(),
        impuesto: t.impuestoEnTramo.toString(),
      })),
    } as unknown as Prisma.JsonValue;
  }

  // El IRPF SIEMPRE figura en el recibo, aun en 0,00 (estilo GNS).
  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'IRPF',
    descripcion: 'IRPF — Impuesto a la Renta de las Personas Físicas (Cat. II)',
    baseCalculo: baseGravada,
    rate: null,
    amount: irpfRetencion,
    calculationDetail: irpfDetail,
  });

  // Base de Fondo Social / Fondo de Vivienda: fórmula GNS "ApliAFondos" =
  // Total de Haberes del mes (sin aguinaldo ni salario vacacional, ya neto de
  // faltas) − aportes personales BPS TEÓRICOS (las TASAS aplicadas al nominal
  // gravado SIN redondear cada partida: jubilatorio sobre la base topeada +
  // FONASA seguro + adicional + FRL) − IRPF. Se redondea recién al final.
  // Recibo Martín Hernández 1/2026: 4.720,51 − 4.262,83 × 18,1% − 0 = 3.948,94
  // → Fondo Social 22,94 y Fondo de Vivienda 0,99 exactos.
  let baseFondoConstruccion: bigint | undefined;
  if (esConstruccion) {
    // El Reintegro de Gastos (y los ajustes no gravados) quedan FUERA de la
    // base ApliAFondos: no son materia gravada de los fondos de la construcción.
    const haberesParaFondos = items
      .filter((i) => i.itemType === ItemType.HABER && !['REINTEGRO_GASTOS', 'AJUSTE_NO_GRAVADO', 'VIATICOS'].includes(i.concepto))
      .reduce((sum, i) => sum + i.amount, 0n);
    const rateFonasaFrl = BigInt(
      aportesObreros.detail.fonasaSeguroRate + aportesObreros.detail.fonasaAdicionalRate + params.frlObreroRate,
    );
    const apliAFondos = divRoundHalfUp(
      haberesParaFondos * 10000n
        - aportesObreros.baseJubilatorio * BigInt(params.bpsJubilatorioRate)
        - baseGravada * rateFonasaFrl
        - irpfRetencion * 10000n,
      10000n,
    );
    baseFondoConstruccion = apliAFondos > 0n ? apliAFondos : 0n;
  }

  for (const od of otrosDescuentosSinFaltas) {
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.DESCUENTO_OBRERO,
      concepto: od.concepto,
      descripcion: od.descripcion,
      baseCalculo: null,
      rate: null,
      amount: od.amount,
      calculationDetail: null,
    });
  }

  for (const c of conceptos.filter((c) => c.tipoOperacion === ItemType.DESCUENTO_OBRERO && !esFalta(c.codigo))) {
    const amount = evaluarConcepto(c, {
      salarioNominal: labor.salarioNominal,
      sueldoBasico: salarioBase,
      haberesGravados: baseGravada,
      cantidades,
      horasTrabajadas: horasConstruccion,
      horaLaudo: horaLaudo ?? undefined,
      valorMediaHora,
      valorHoraPagada,
      baseFondoConstruccion,
    });
    if (amount <= 0n) continue;
    const baseDescuento = c.tipoCalculo === 'PORCENTAJE' || c.tipoCalculo === 'PORCENTAJE_CIENMIL'
      ? (c.baseCalculo === 'FONDO_CONSTRUCCION'
        ? (baseFondoConstruccion ?? baseGravada)
        : c.baseCalculo === 'NOMINAL' ? labor.salarioNominal
          : c.baseCalculo === 'SUELDO_BASICO' ? salarioBase
            : baseGravada)
      : null;
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.DESCUENTO_OBRERO,
      concepto: c.codigo,
      descripcion: c.nombre,
      baseCalculo: baseDescuento,
      rate: c.valorRate ?? null,
      amount,
      calculationDetail: { motor: 'CONCEPTO', tipoCalculo: c.tipoCalculo, baseCalculo: c.baseCalculo } as unknown as Prisma.JsonValue,
    });
  }

  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: baseGravada,
    params,
    bseRateEmpresa: bseRate,
    fonasaPatronalRate,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.APORTE_PATRONAL,
    concepto: 'BPS_IVS_PATRONAL',
    descripcion: 'BPS IVS Patronal',
    baseCalculo: baseGravada,
    rate: params.bpsIvsPatronalRate,
    amount: aportesPatronales.bpsIvs,
    calculationDetail: { base: baseGravada.toString(), rateBp: params.bpsIvsPatronalRate } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.APORTE_PATRONAL,
    concepto: 'FONASA_PATRONAL',
    descripcion: 'FONASA Patronal',
    baseCalculo: baseGravada,
    rate: fonasaPatronalRate,
    amount: aportesPatronales.fonasa,
    calculationDetail: { base: baseGravada.toString(), rateBp: fonasaPatronalRate } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.APORTE_PATRONAL,
    concepto: 'FRL_PATRONAL',
    descripcion: 'Fondo de Reconversión Laboral (Patronal)',
    baseCalculo: baseGravada,
    rate: params.frlPatronalRate,
    amount: aportesPatronales.frl,
    calculationDetail: null,
  });

  if (aportesPatronales.bse > 0n) {
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.APORTE_PATRONAL,
      concepto: 'BSE',
      descripcion: 'BSE — Seguro de Accidentes del Trabajo',
      baseCalculo: baseGravada,
      rate: bseRate,
      amount: aportesPatronales.bse,
      calculationDetail: null,
    });
  }

  for (const c of conceptos.filter((c) => c.tipoOperacion === ItemType.APORTE_PATRONAL || c.tipoOperacion === ItemType.INFORMATIVO)) {
    const amount = evaluarConcepto(c, {
      salarioNominal: labor.salarioNominal,
      sueldoBasico: salarioBase,
      haberesGravados: baseGravada,
      cantidades,
      horasTrabajadas: horasConstruccion,
      horaLaudo: horaLaudo ?? undefined,
      valorMediaHora,
      valorHoraPagada,
      baseFondoConstruccion,
    });
    if (amount <= 0n) continue;
    items.push({
      employeeId: input.employeeId,
      itemType: c.tipoOperacion,
      concepto: c.codigo,
      descripcion: c.nombre,
      baseCalculo: null,
      rate: c.valorRate ?? null,
      amount,
      calculationDetail: { motor: 'CONCEPTO', tipoCalculo: c.tipoCalculo } as unknown as Prisma.JsonValue,
    });
  }

  const totalDescuentos = items
    .filter((i) => i.itemType === ItemType.DESCUENTO_OBRERO)
    .reduce((sum, i) => sum + i.amount, 0n);

  const totalPatronal = items
    .filter((i) => i.itemType === ItemType.APORTE_PATRONAL)
    .reduce((sum, i) => sum + i.amount, 0n);

  const liquidoPercibir = totalHaberes - totalDescuentos;

  const parametersSnapshot = {
    asOfDate: asOfDate.toISOString(),
    companyId: period.companyId,
    contratoId: contrato?.id ?? null,
    baseGravada: baseGravada.toString(),
    bpc: params.bpc.toString(),
    bpsJubilatorioRate: params.bpsJubilatorioRate,
    fonasaRateEfectivo: aportesObreros.detail.fonasaRateEfectivo,
    frlObreroRate: params.frlObreroRate,
    bpsIvsPatronalRate: params.bpsIvsPatronalRate,
    fonasaPatronalRate,
    bseRate,
    irpfBrackets: params.irpfBrackets,
  };
  const snapshotJson = parametersSnapshot as unknown as Prisma.InputJsonValue;

  const liquidacion = await prisma.liquidation.upsert({
    where: {
      periodId_employeeId_type: {
        periodId: input.periodId,
        employeeId: input.employeeId,
        type: LiquidationType.MENSUAL,
      },
    },
    create: {
      periodId: input.periodId,
      employeeId: input.employeeId,
      type: LiquidationType.MENSUAL,
      status: LiquidationStatus.BORRADOR,
      year: input.year,
      month: input.month,
      diasTrabajados: diasDeclarados,
      totalHaberes,
      totalDescuentos,
      totalPatronal,
      liquidoPercibir,
      parametersSnapshot: snapshotJson,
    },
    update: {
      status: LiquidationStatus.BORRADOR,
      diasTrabajados: diasDeclarados,
      totalHaberes,
      totalDescuentos,
      totalPatronal,
      liquidoPercibir,
      parametersSnapshot: snapshotJson,
    },
  });

  await prisma.payrollItem.deleteMany({ where: { liquidationId: liquidacion.id } });

  await prisma.payrollItem.createMany({
    data: items.map((item) => {
      const { calculationDetail, baseCalculo, ...rest } = item;
      return {
        ...rest,
        liquidationId: liquidacion.id,
        baseCalculo: baseCalculo ?? null,
        calculationDetail: calculationDetail !== null
          ? calculationDetail as unknown as Prisma.InputJsonValue
          : Prisma.DbNull,
      };
    }),
  });

  return {
    liquidacionId: liquidacion.id,
    employeeId: input.employeeId,
    items,
    totalHaberes,
    totalDescuentos,
    totalPatronal,
    liquidoPercibir,
    parametersSnapshot,
  };
}

// Categorías de aportación ficta del titular unipersonal (1.ª a 10.ª), en
// unidades de BFC (Base Ficta de Contribución).
const UNIDADES_BFC = [11, 15, 20, 25, 30, 36, 42, 48, 54, 60];

async function generarLiquidacionTitularUnipersonal(
  input: LiquidacionInput,
  companyId: string,
  contrato: { id: string; fictoCategoria: number | null; seguroSalud: number | null },
  salarioNominalContrato: bigint,
  asOfDate: Date,
  params: Awaited<ReturnType<typeof parametersService.getPayrollParameters>>,
  employee: { hijosACargo: number; conyugeACargo: boolean },
): Promise<LiquidacionResult> {
  const bfc = toCtms((await parametersService.getParam<number>('BFC_UNIPERSONAL', asOfDate)) ?? 1847.96);
  const cat = contrato.fictoCategoria && contrato.fictoCategoria >= 1 && contrato.fictoCategoria <= 10
    ? contrato.fictoCategoria
    : null;
  const unidades = cat ? UNIDADES_BFC[cat - 1] : null;
  // Sin categoría elegida, se usa el sueldo del contrato como ficto.
  const ficto = unidades ? bfc * BigInt(unidades) : salarioNominalContrato;

  // Aporte Jubilatorio personal 15% + FRL 0,10% sobre el ficto (criterio GNS).
  const jubilatorio = applyRate(ficto, params.bpsJubilatorioRate);
  const frl = applyRate(ficto, params.frlObreroRate);

  // FONASA del titular: sobre una base de 6,5 BPC (2026: 44.616), Seguro por
  // Enfermedad 3% + Adicional según el seguro de salud del contrato (escalón
  // 1,5% + hijos 1,5% + cónyuge 2%) — GNS SS1: 3% + 3% = 1.338,48 + 1.338,48.
  const baseFonasaBpc = (await parametersService.getParam<number>('FONASA_TITULAR_BASE_BPC', asOfDate)) ?? 6.5;
  const baseFonasa = divRoundHalfUp(params.bpc * BigInt(Math.round(baseFonasaBpc * 100)), 100n);
  const cargas = fonasaCargasDeSeguroSalud(contrato.seguroSalud);
  const conHijos = cargas ? cargas.hijos : employee.hijosACargo > 0;
  const conConyuge = cargas ? cargas.conyuge : employee.conyugeACargo;
  const seguroRate = params.fonasaBasicRate; // 3%
  const adicionalRate = (params.fonasaBasicHighRate - params.fonasaBasicRate)
    + (conHijos ? params.fonasaHijosRate : 0)
    + (conConyuge ? params.fonasaConyugeRate : 0);
  const fonasaSeguro = applyRate(baseFonasa, seguroRate);
  const fonasaAdicional = applyRate(baseFonasa, adicionalRate);

  const items: Omit<PayrollItem, 'id' | 'liquidationId' | 'createdAt'>[] = [
    {
      // Igual que GNS: el ficto figura como haber INFORMATIVO "Aporta (Para
      // BPS)" — se declara en la nómina como concepto 1, pero NO suma al Total
      // de Haberes (que queda en 0: el titular no cobra sueldo por acá).
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: 'SUELDO_FICTO',
      descripcion: cat ? `Aporta (Para BPS) — Cat. ${cat}.ª (${unidades} BFC)` : 'Aporta (Para BPS)',
      baseCalculo: bfc,
      rate: null,
      amount: ficto,
      calculationDetail: { titular: true, informativo: true, categoria: cat, unidadesBfc: unidades, bfc: bfc.toString(), contratoId: contrato.id } as unknown as Prisma.JsonValue,
    },
    {
      employeeId: input.employeeId,
      itemType: ItemType.DESCUENTO_OBRERO,
      concepto: 'BPS_JUBILATORIO',
      descripcion: 'Aporte Jubilatorio',
      baseCalculo: ficto,
      rate: params.bpsJubilatorioRate,
      amount: jubilatorio,
      calculationDetail: { titular: true, rateBp: params.bpsJubilatorioRate } as unknown as Prisma.JsonValue,
    },
    {
      employeeId: input.employeeId,
      itemType: ItemType.DESCUENTO_OBRERO,
      concepto: 'FRL',
      descripcion: 'FRL',
      baseCalculo: ficto,
      rate: params.frlObreroRate,
      amount: frl,
      calculationDetail: { titular: true } as unknown as Prisma.JsonValue,
    },
    {
      employeeId: input.employeeId,
      itemType: ItemType.DESCUENTO_OBRERO,
      concepto: 'FONASA',
      descripcion: 'Seguro x Enfermedad',
      baseCalculo: baseFonasa,
      rate: seguroRate,
      amount: fonasaSeguro,
      calculationDetail: { titular: true, baseBpc: baseFonasaBpc, rateBp: seguroRate } as unknown as Prisma.JsonValue,
    },
    {
      employeeId: input.employeeId,
      itemType: ItemType.DESCUENTO_OBRERO,
      concepto: 'FONASA_ADICIONAL',
      descripcion: 'Adicional Sist. Nac. Int. de Salud',
      baseCalculo: baseFonasa,
      rate: adicionalRate,
      amount: fonasaAdicional,
      calculationDetail: { titular: true, baseBpc: baseFonasaBpc, rateBp: adicionalRate, hijos: conHijos, conyuge: conConyuge, seguroSalud: contrato.seguroSalud ?? null } as unknown as Prisma.JsonValue,
    },
    {
      // Estilo GNS: el IRPF figura SIEMPRE, aun vacío (el ficto patronal no
      // tributa IRPF Cat. II por esta vía).
      employeeId: input.employeeId,
      itemType: ItemType.DESCUENTO_OBRERO,
      concepto: 'IRPF',
      descripcion: 'I.R.P.F.',
      baseCalculo: null,
      rate: null,
      amount: 0n,
      calculationDetail: { titular: true } as unknown as Prisma.JsonValue,
    },
  ];

  // Igual que GNS: Total de Haberes 0 (el ficto es informativo) y líquido
  // NEGATIVO = lo que el titular debe aportar.
  const totalHaberes = 0n;
  const totalDescuentos = jubilatorio + frl + fonasaSeguro + fonasaAdicional;
  const liquidoPercibir = -totalDescuentos;

  const parametersSnapshot = {
    asOfDate: asOfDate.toISOString(),
    companyId,
    contratoId: contrato.id,
    titularUnipersonal: true,
    bfc: bfc.toString(),
    categoriaFicto: cat,
    unidadesBfc: unidades,
    ficto: ficto.toString(),
    baseFonasa: baseFonasa.toString(),
    baseFonasaBpc,
    seguroSalud: contrato.seguroSalud ?? null,
    jubRateBp: params.bpsJubilatorioRate,
    frlRateBp: params.frlObreroRate,
    fonasaSeguroRateBp: seguroRate,
    fonasaAdicionalRateBp: adicionalRate,
  };

  const liquidacion = await prisma.liquidation.upsert({
    where: {
      periodId_employeeId_type: {
        periodId: input.periodId,
        employeeId: input.employeeId,
        type: LiquidationType.MENSUAL,
      },
    },
    create: {
      periodId: input.periodId,
      employeeId: input.employeeId,
      type: LiquidationType.MENSUAL,
      status: LiquidationStatus.BORRADOR,
      year: input.year,
      month: input.month,
      diasTrabajados: 30,
      totalHaberes,
      totalDescuentos,
      totalPatronal: 0n,
      liquidoPercibir,
      parametersSnapshot: parametersSnapshot as unknown as Prisma.InputJsonValue,
    },
    update: {
      status: LiquidationStatus.BORRADOR,
      diasTrabajados: 30,
      totalHaberes,
      totalDescuentos,
      totalPatronal: 0n,
      liquidoPercibir,
      parametersSnapshot: parametersSnapshot as unknown as Prisma.InputJsonValue,
    },
  });

  await prisma.payrollItem.deleteMany({ where: { liquidationId: liquidacion.id } });
  await prisma.payrollItem.createMany({
    data: items.map((item) => {
      const { calculationDetail, baseCalculo, ...rest } = item;
      return {
        ...rest,
        liquidationId: liquidacion.id,
        baseCalculo: baseCalculo ?? null,
        calculationDetail: calculationDetail !== null
          ? calculationDetail as unknown as Prisma.InputJsonValue
          : Prisma.DbNull,
      };
    }),
  });

  return {
    liquidacionId: liquidacion.id,
    employeeId: input.employeeId,
    items,
    totalHaberes,
    totalDescuentos,
    totalPatronal: 0n,
    liquidoPercibir,
    parametersSnapshot,
  };
}

export async function confirmarLiquidacion(
  liquidacionId: string,
  userId: string,
): Promise<void> {
  await prisma.liquidation.update({
    where: { id: liquidacionId },
    data: {
      status: LiquidationStatus.CONFIRMADO,
      confirmedAt: new Date(),
      confirmedBy: userId,
    },
  });
}
