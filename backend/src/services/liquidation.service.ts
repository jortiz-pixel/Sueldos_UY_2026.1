/**
 * SERVICIO DE LIQUIDACIÓN MENSUAL
 */

import { LiquidationType, LiquidationStatus, ItemType, PayrollItem, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { salarioProporcional } from '../utils/money';
import { calcularAportesObreros, calcularAportesPatronales, calcularHorasExtra } from './bps.service';
import { calcularIrpfMensual, calcularIrpfSimplificado } from './irpf.service';
import { parametersService } from './parameters.service';
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

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    include: { company: true },
  });
  if (!employee) throw new AppError(404, 'Empleado no encontrado');

  const params = await parametersService.getPayrollParameters(asOfDate);
  const bseRate = employee.company.bseRate;
  const fonasaPatronalRate = 500;

  const diasTrabajados = input.diasTrabajados ?? 30;
  const salarioBase = employee.salaryType === 'MENSUAL'
    ? salarioProporcional(employee.salarioNominal, diasTrabajados, 30)
    : (employee.jornal ?? 0n) * BigInt(diasTrabajados);

  const items: Omit<PayrollItem, 'id' | 'liquidationId' | 'createdAt'>[] = [];

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.HABER,
    concepto: 'SUELDO_BASICO',
    descripcion: employee.salaryType === 'MENSUAL'
      ? `Sueldo básico ${diasTrabajados < 30 ? `(${diasTrabajados}/30 días)` : ''}`
      : `Jornal (${diasTrabajados} días)`,
    baseCalculo: employee.salarioNominal,
    rate: diasTrabajados < 30 ? Math.round(diasTrabajados * 10000 / 30) : null,
    amount: salarioBase,
    calculationDetail: {
      salarioNominal: employee.salarioNominal.toString(),
      diasTrabajados,
      diasMes: 30,
    } as unknown as Prisma.JsonValue,
  });

  if ((input.horasExtraDiurnas ?? 0) > 0 || (input.horasExtraNocturnas ?? 0) > 0) {
    const he = calcularHorasExtra(
      employee.salarioNominal,
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

  const totalHaberes = items
    .filter((i) => i.itemType === ItemType.HABER)
    .reduce((sum, i) => sum + i.amount, 0n);

  const aportesObreros = calcularAportesObreros({
    salarioNominal: totalHaberes,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: bseRate,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'BPS_JUBILATORIO',
    descripcion: `BPS Jubilatorio (${params.bpsJubilatorioRate / 100}%)`,
    baseCalculo: totalHaberes,
    rate: params.bpsJubilatorioRate,
    amount: aportesObreros.jubilatorio,
    calculationDetail: { base: totalHaberes.toString(), rateBp: params.bpsJubilatorioRate } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'FONASA',
    descripcion: `FONASA/DISSE${employee.fonasaFamilia ? ' (con familia)' : ''} (${(params.fonasaBasicRate + (employee.fonasaFamilia ? params.fonasaFamiliaRate : 0)) / 100}%)`,
    baseCalculo: totalHaberes,
    rate: params.fonasaBasicRate + (employee.fonasaFamilia ? params.fonasaFamiliaRate : 0),
    amount: aportesObreros.fonasaTotal,
    calculationDetail: { base: totalHaberes.toString(), basicRate: params.fonasaBasicRate, familiaRate: employee.fonasaFamilia ? params.fonasaFamiliaRate : 0, fonasaFamilia: employee.fonasaFamilia } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.DESCUENTO_OBRERO,
    concepto: 'FRL',
    descripcion: `FRL — Fondo de Reconversión Laboral (${params.frlObreroRate / 100}%)`,
    baseCalculo: totalHaberes,
    rate: params.frlObreroRate,
    amount: aportesObreros.frl,
    calculationDetail: { base: totalHaberes.toString(), rateBp: params.frlObreroRate } as unknown as Prisma.JsonValue,
  });

  let irpfRetencion = 0n;
  let irpfDetail: Prisma.JsonValue = {};

  if (employee.irpfMetodo === 'SIMPLIFICADO' && employee.irpfFicto) {
    irpfRetencion = calcularIrpfSimplificado(employee.irpfFicto, params);
    irpfDetail = { metodo: 'SIMPLIFICADO', ficto: employee.irpfFicto.toString() };
  } else {
    const irpfResult = calcularIrpfMensual({
      salarioNominal: totalHaberes,
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
      baseCalculo: totalHaberes,
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

  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: totalHaberes,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: bseRate,
    fonasaPatronalRate,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.APORTE_PATRONAL,
    concepto: 'BPS_IVS_PATRONAL',
    descripcion: `BPS IVS Patronal (${params.bpsIvsPatronalRate / 100}%)`,
    baseCalculo: totalHaberes,
    rate: params.bpsIvsPatronalRate,
    amount: aportesPatronales.bpsIvs,
    calculationDetail: { base: totalHaberes.toString(), rateBp: params.bpsIvsPatronalRate } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.APORTE_PATRONAL,
    concepto: 'FONASA_PATRONAL',
    descripcion: `FONASA/DISSE Patronal (${fonasaPatronalRate / 100}%)`,
    baseCalculo: totalHaberes,
    rate: fonasaPatronalRate,
    amount: aportesPatronales.fonasa,
    calculationDetail: { base: totalHaberes.toString(), rateBp: fonasaPatronalRate } as unknown as Prisma.JsonValue,
  });

  items.push({
    employeeId: input.employeeId,
    itemType: ItemType.APORTE_PATRONAL,
    concepto: 'FRL_PATRONAL',
    descripcion: `FRL Patronal (${params.frlPatronalRate / 100}%)`,
    baseCalculo: totalHaberes,
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
      baseCalculo: totalHaberes,
      rate: bseRate,
      amount: aportesPatronales.bse,
      calculationDetail: null,
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
    bpc: params.bpc.toString(),
    bpsJubilatorioRate: params.bpsJubilatorioRate,
    fonasaBasicRate: params.fonasaBasicRate,
    fonasaFamiliaRate: params.fonasaFamiliaRate,
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
