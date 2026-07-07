/**
 * SERVICIO DE LIQUIDACIÓN MENSUAL
 */

import { LiquidationType, LiquidationStatus, ItemType, PayrollItem, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { salarioProporcional, divRoundHalfUp } from '../utils/money';
import { calcularAportesObreros, calcularAportesPatronales, calcularHorasExtra, fonasaCargasDeSeguroSalud } from './bps.service';
import { calcularIrpfMensual, calcularIrpfSimplificado } from './irpf.service';
import { parametersService } from './parameters.service';
import { resolverContratoEnMes, diasTrabajadosEnMes, datosLaboralesEfectivos } from './contract.service';
import { evaluarConcepto, ConceptoContext } from './concept.engine';
import { calcularAguinaldoBrutoSemestre } from './aguinaldo.service';
import { correspondeHerramientas, esEmpresaConstruccion, ensureConceptosConstruccion, jornalHoraVigente, recuadroDeEmpresa } from './construccion.service';
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

  for (const c of conceptos.filter((c) => c.tipoOperacion === ItemType.DESCUENTO_OBRERO && esFalta(c.codigo))) {
    const amount = montoFalta(evaluarConcepto(c, {
      salarioNominal: labor.salarioNominal,
      sueldoBasico: salarioBase,
      haberesGravados: gravadoHaberes,
      cantidades,
      horasTrabajadas: horasConstruccion,
      horaLaudo: horaLaudo ?? undefined,
      valorMediaHora: esConstruccion ? divRoundHalfUp(horaPagada, 2n) : undefined,
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
    valorMediaHora: esConstruccion ? divRoundHalfUp(horaPagada, 2n) : undefined,
  };

  for (const c of conceptos.filter((c) => c.tipoOperacion === ItemType.HABER)) {
    ctxConcepto.haberesGravados = gravadoHaberes;
    const amount = evaluarConcepto(c, ctxConcepto);
    if (amount <= 0n) continue;
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: c.codigo,
      descripcion: c.nombre,
      baseCalculo: null,
      rate: c.valorRate ?? null,
      amount,
      calculationDetail: { motor: 'CONCEPTO', tipoCalculo: c.tipoCalculo, gravado: c.gravado, baseCalculo: c.baseCalculo } as unknown as Prisma.JsonValue,
    });
    if (c.gravado) gravadoHaberes += amount;
  }

  const totalHaberes = items
    .filter((i) => i.itemType === ItemType.HABER)
    .reduce((sum, i) => sum + i.amount, 0n);

  // El total de haberes ya está NETO de faltas → esa es la base imponible sobre
  // la que se calculan los aportes personales, patronales y el IRPF.
  const baseGravada = gravadoHaberes;

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
  // aguinaldo del semestre (fonasaAdicionalBase).
  if (aportesObreros.fonasaFamilia > 0n) {
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
  }

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

  if (irpfRetencion > 0n) {
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
      valorMediaHora: esConstruccion ? divRoundHalfUp(horaPagada, 2n) : undefined,
    });
    if (amount <= 0n) continue;
    items.push({
      employeeId: input.employeeId,
      itemType: ItemType.DESCUENTO_OBRERO,
      concepto: c.codigo,
      descripcion: c.nombre,
      baseCalculo: null,
      rate: c.valorRate ?? null,
      amount,
      calculationDetail: { motor: 'CONCEPTO', tipoCalculo: c.tipoCalculo } as unknown as Prisma.JsonValue,
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
      valorMediaHora: esConstruccion ? divRoundHalfUp(horaPagada, 2n) : undefined,
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
      diasTrabajados,
      totalHaberes,
      totalDescuentos,
      totalPatronal,
      liquidoPercibir,
      parametersSnapshot: snapshotJson,
    },
    update: {
      status: LiquidationStatus.BORRADOR,
      diasTrabajados,
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
