/**
 * SERVICIO DE LIQUIDACIÓN MENSUAL
 */

import { LiquidationType, LiquidationStatus, ItemType, PayrollItem, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { salarioProporcional } from '../utils/money';
import { calcularAportesObreros, calcularAportesPatronales, calcularHorasExtra } from './bps.service';
import { calcularIrpfMensual, calcularIrpfSimplificado } from './irpf.service';
import { parametersService } from './parameters.service';
import { resolverContratoVigente, datosLaboralesEfectivos } from './contract.service';
import { evaluarConcepto, ConceptoContext } from './concept.engine';
import { AppError } from '../middleware/errorHandler';

export interface LiquidacionInput {
  employeeId: string;
  periodId: string;
  year: number;
  month: number;
  diasTrabajados?: number;
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

  // Contrato vigente de la persona PARA ESTA EMPRESA en el período.
  // La liquidación es estrictamente por contrato: si no hay uno vigente
  // (p. ej. un mes entre dos zafras), NO se liquida.
  const contrato = await resolverContratoVigente(input.employeeId, asOfDate, period.companyId);
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

  const diasTrabajados = input.diasTrabajados ?? 30;
  const salarioBase = labor.salaryType === 'MENSUAL'
    ? salarioProporcional(labor.salarioNominal, diasTrabajados, 30)
    : (labor.jornal ?? 0n) * BigInt(diasTrabajados);

  const items: Omit<PayrollItem, 'id' | 'liquidationId' | 'createdAt'>[] = [];

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.HABER,
    concepto: 'SUELDO_BASICO',
    descripcion: labor.salaryType === 'MENSUAL'
      ? `Sueldo básico ${diasTrabajados < 30 ? `(${diasTrabajados}/30 días)` : ''}`
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

  const ctxConcepto: ConceptoContext = {
    salarioNominal: labor.salarioNominal,
    sueldoBasico: salarioBase,
    haberesGravados: gravadoHaberes,
    cantidades: input.cantidadesConcepto,
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

  const baseGravada = gravadoHaberes;

  const aportesObreros = calcularAportesObreros({
    salarioNominal: baseGravada,
    hijosACargo: employee.hijosACargo,
    conyugeACargo: employee.conyugeACargo,
    params,
    bseRateEmpresa: bseRate,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'BPS_JUBILATORIO',
    descripcion: `BPS Jubilatorio (${params.bpsJubilatorioRate / 100}%)`,
    baseCalculo: baseGravada,
    rate: params.bpsJubilatorioRate,
    amount: aportesObreros.jubilatorio,
    calculationDetail: { base: baseGravada.toString(), rateBp: params.bpsJubilatorioRate } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'FONASA',
    descripcion: `FONASA/DISSE (${aportesObreros.detail.fonasaRateEfectivo / 100}%)`,
    baseCalculo: baseGravada,
    rate: aportesObreros.detail.fonasaRateEfectivo,
    amount: aportesObreros.fonasaTotal,
    calculationDetail: {
      base: baseGravada.toString(),
      baseRate: aportesObreros.detail.fonasaBaseRate,
      hijosRate: aportesObreros.detail.fonasaHijosRate,
      conyugeRate: aportesObreros.detail.fonasaConyugeRate,
      hijosACargo: employee.hijosACargo,
      conyugeACargo: employee.conyugeACargo,
    } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'FRL',
    descripcion: `FRL — Fondo de Reconversión Laboral (${params.frlObreroRate / 100}%)`,
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
      deduccionHijosAnual: irpfResult.deduccionHijosAnual.toString(),
      deduccionConyugeAnual: irpfResult.deduccionConyugeAnual.toString(),
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

  for (const od of input.otrosDescuentos ?? []) {
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

  for (const c of conceptos.filter((c) => c.tipoOperacion === ItemType.DESCUENTO_OBRERO)) {
    const amount = evaluarConcepto(c, {
      salarioNominal: labor.salarioNominal,
      sueldoBasico: salarioBase,
      haberesGravados: baseGravada,
      cantidades: input.cantidadesConcepto,
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
    descripcion: `BPS IVS Patronal (${params.bpsIvsPatronalRate / 100}%)`,
    baseCalculo: baseGravada,
    rate: params.bpsIvsPatronalRate,
    amount: aportesPatronales.bpsIvs,
    calculationDetail: { base: baseGravada.toString(), rateBp: params.bpsIvsPatronalRate } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.APORTE_PATRONAL,
    concepto: 'FONASA_PATRONAL',
    descripcion: `FONASA/DISSE Patronal (${fonasaPatronalRate / 100}%)`,
    baseCalculo: baseGravada,
    rate: fonasaPatronalRate,
    amount: aportesPatronales.fonasa,
    calculationDetail: { base: baseGravada.toString(), rateBp: fonasaPatronalRate } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.APORTE_PATRONAL,
    concepto: 'FRL_PATRONAL',
    descripcion: `FRL Patronal (${params.frlPatronalRate / 100}%)`,
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
      descripcion: `BSE — Seguro de Accidentes del Trabajo (${bseRate / 100}%)`,
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
      cantidades: input.cantidadesConcepto,
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
