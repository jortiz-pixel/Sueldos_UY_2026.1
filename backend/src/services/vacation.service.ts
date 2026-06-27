/**
 * SERVICIO DE LICENCIA Y SALARIO VACACIONAL
 */

import { LiquidationType, LiquidationStatus, ItemType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { multiplyFraction, maxBigInt } from '../utils/money';
import { calcularAportesObreros, calcularAportesPatronales } from './bps.service';
import { calcularIrpfMensual } from './irpf.service';
import { parametersService } from './parameters.service';
import {
  diasLicenciaCorrespondientes,
  calcularAntiguedad,
  calcularAntiguedadMeses,
  diasPreavisoCorrespondientes,
} from '../utils/date';
import { AppError } from '../middleware/errorHandler';

export interface LicenciaInput {
  employeeId: string;
  periodId: string;
  year: number;
  month: number;
  diasHabilesTomar: number;
}

export async function calcularLiquidacionLicencia(input: LicenciaInput) {
  const asOfDate = new Date(input.year, input.month - 1, 1);
  const params = await parametersService.getPayrollParameters(asOfDate);

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    include: { company: true },
  });
  if (!employee) throw new AppError(404, 'Empleado no encontrado');
  const bseRate = employee.company?.bseRate ?? 0;

  const antiguedad = calcularAntiguedad(employee.fechaIngreso, asOfDate);
  const diasCorresponden = diasLicenciaCorrespondientes(antiguedad);

  const accrual = await prisma.vacationAccrual.findUnique({
    where: { employeeId_year: { employeeId: input.employeeId, year: input.year } },
  });
  const diasDisponibles = accrual
    ? accrual.diasCorresponden - accrual.diasTomados
    : diasCorresponden;

  if (input.diasHabilesTomar > diasDisponibles) {
    throw new AppError(400, `Días insuficientes. Disponibles: ${diasDisponibles}, solicitados: ${input.diasHabilesTomar}`);
  }

  const salarioDiario = multiplyFraction(employee.salarioNominal, 1, 25);
  const salarioLicencia = salarioDiario * BigInt(input.diasHabilesTomar);
  const salarioVacacional = salarioLicencia;
  const totalBruto = salarioLicencia + salarioVacacional;

  const aportesObreros = calcularAportesObreros({
    salarioNominal: totalBruto,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: bseRate,
  });

  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: totalBruto,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: bseRate,
  });

  const irpfResult = calcularIrpfMensual({
    salarioNominal: totalBruto,
    fonasaMensual: aportesObreros.fonasaTotal,
    bpsMensual: aportesObreros.jubilatorio,
    hijosACargo: employee.hijosACargo,
    hijosDiscapacitados: employee.hijosDiscapacitados,
    conyugeACargo: employee.conyugeACargo,
    params,
  });

  const totalDescuentos = aportesObreros.total + irpfResult.retencionMensual;
  const liquidoPercibir = maxBigInt(0n, totalBruto - totalDescuentos);

  const liquidacion = await prisma.liquidation.upsert({
    where: {
      periodId_employeeId_type: {
        periodId: input.periodId,
        employeeId: input.employeeId,
        type: LiquidationType.LICENCIA,
      },
    },
    create: {
      periodId: input.periodId,
      employeeId: input.employeeId,
      type: LiquidationType.LICENCIA,
      status: LiquidationStatus.BORRADOR,
      year: input.year,
      month: input.month,
      diasTrabajados: input.diasHabilesTomar,
      diasHabiles: input.diasHabilesTomar,
      totalHaberes: totalBruto,
      totalDescuentos,
      totalPatronal: aportesPatronales.total,
      liquidoPercibir,
      parametersSnapshot: { bpc: params.bpc.toString() },
    },
    update: {
      status: LiquidationStatus.BORRADOR,
      diasTrabajados: input.diasHabilesTomar,
      diasHabiles: input.diasHabilesTomar,
      totalHaberes: totalBruto,
      totalDescuentos,
      totalPatronal: aportesPatronales.total,
      liquidoPercibir,
    },
  });

  await prisma.payrollItem.deleteMany({ where: { liquidationId: liquidacion.id } });
  await prisma.payrollItem.createMany({
    data: [
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.HABER,
        concepto: 'SALARIO_LICENCIA',
        descripcion: `Salario de licencia (${input.diasHabilesTomar} días hábiles)`,
        baseCalculo: salarioDiario,
        rate: null,
        amount: salarioLicencia,
        calculationDetail: {
          salarioDiario: salarioDiario.toString(),
          diasHabiles: input.diasHabilesTomar,
        } as unknown as Prisma.InputJsonValue,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.HABER,
        concepto: 'SALARIO_VACACIONAL',
        descripcion: 'Salario vacacional (100% del salario de licencia)',
        baseCalculo: salarioLicencia,
        rate: 10000,
        amount: salarioVacacional,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'BPS_JUBILATORIO',
        descripcion: 'BPS Jubilatorio sobre licencia',
        baseCalculo: totalBruto,
        rate: params.bpsJubilatorioRate,
        amount: aportesObreros.jubilatorio,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FONASA',
        descripcion: 'FONASA sobre licencia',
        baseCalculo: totalBruto,
        rate: params.fonasaBasicRate,
        amount: aportesObreros.fonasaTotal,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FRL',
        descripcion: 'FRL sobre licencia',
        baseCalculo: totalBruto,
        rate: params.frlObreroRate,
        amount: aportesObreros.frl,
        calculationDetail: Prisma.DbNull,
      },
      ...(irpfResult.retencionMensual > 0n ? [{
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'IRPF',
        descripcion: 'IRPF sobre licencia',
        baseCalculo: totalBruto,
        rate: null,
        amount: irpfResult.retencionMensual,
        calculationDetail: Prisma.DbNull,
      }] : []),
    ],
  });

  await prisma.vacationAccrual.upsert({
    where: { employeeId_year: { employeeId: input.employeeId, year: input.year } },
    create: {
      employeeId: input.employeeId,
      year: input.year,
      diasCorresponden: diasCorresponden,
      diasTomados: input.diasHabilesTomar,
      diasPendientes: diasCorresponden - input.diasHabilesTomar,
    },
    update: {
      diasTomados: { increment: input.diasHabilesTomar },
      diasPendientes: { decrement: input.diasHabilesTomar },
    },
  });

  return {
    liquidacionId: liquidacion.id,
    salarioLicencia,
    salarioVacacional,
    totalBruto,
    totalDescuentos,
    liquidoPercibir,
    diasCorresponden,
    diasDisponibles,
    diasTomados: input.diasHabilesTomar,
  };
}

export async function calcularLiquidacionFinal(
  employeeId: string,
  periodId: string,
  fechaEgreso: Date,
  userId?: string,
) {
  const params = await parametersService.getPayrollParameters(fechaEgreso);

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { company: true },
  });
  if (!employee) throw new AppError(404, 'Empleado no encontrado');
  const companyId = employee.companyId;
  if (!companyId) throw new AppError(400, 'La persona no tiene empresa asociada para la liquidación final');
  const bseRate = employee.company?.bseRate ?? 0;

  const year = fechaEgreso.getFullYear();
  const month = fechaEgreso.getMonth() + 1;

  const antiguedadMeses = calcularAntiguedadMeses(employee.fechaIngreso, fechaEgreso);
  const antiguedadAnios = Math.floor(antiguedadMeses / 12);

  const mesesIndemnizacion = Math.min(antiguedadAnios, 6);
  const indemnizacion = employee.salarioNominal * BigInt(mesesIndemnizacion);

  const diasPraveiso = diasPreavisoCorrespondientes(antiguedadMeses);
  const salarioDiario = multiplyFraction(employee.salarioNominal, 1, 30);
  const preaviso = salarioDiario * BigInt(diasPraveiso);

  const mesInicioSemestre = month <= 6 ? 1 : 7;
  const mesesEnSemestre = month - mesInicioSemestre + 1;
  const aguinaldoProporcional = multiplyFraction(
    employee.salarioNominal * BigInt(mesesEnSemestre),
    1, 12,
  );

  const diasLicenciaAnuales = diasLicenciaCorrespondientes(antiguedadAnios);
  const accrual = await prisma.vacationAccrual.findUnique({
    where: { employeeId_year: { employeeId, year } },
  });
  const diasTomados = accrual?.diasTomados ?? 0;
  const mesesTrabajadosAnio = month;
  const diasLicenciaProporcional = Math.round(diasLicenciaAnuales * mesesTrabajadosAnio / 12);
  const diasLicenciaPendientes = Math.max(0, diasLicenciaProporcional - diasTomados);
  const licenciaPendiente = multiplyFraction(employee.salarioNominal, diasLicenciaPendientes, 25);
  const salarioVacacionalPendiente = licenciaPendiente;

  const totalBruto = indemnizacion + preaviso + aguinaldoProporcional
    + licenciaPendiente + salarioVacacionalPendiente;

  const baseBpsIrpf = aguinaldoProporcional + licenciaPendiente + salarioVacacionalPendiente;
  const aportesObreros = calcularAportesObreros({
    salarioNominal: baseBpsIrpf,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: bseRate,
  });
  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: baseBpsIrpf,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: bseRate,
  });

  const irpfResult = calcularIrpfMensual({
    salarioNominal: baseBpsIrpf,
    fonasaMensual: aportesObreros.fonasaTotal,
    bpsMensual: aportesObreros.jubilatorio,
    hijosACargo: employee.hijosACargo,
    hijosDiscapacitados: employee.hijosDiscapacitados,
    conyugeACargo: employee.conyugeACargo,
    params,
  });

  const totalDescuentos = aportesObreros.total + irpfResult.retencionMensual;
  const liquidoPercibir = maxBigInt(0n, totalBruto - totalDescuentos);

  const periodo = await prisma.payrollPeriod.upsert({
    where: { companyId_year_month: { companyId, year, month } },
    create: { companyId, year, month },
    update: {},
  });

  const liquidacion = await prisma.liquidation.upsert({
    where: {
      periodId_employeeId_type: {
        periodId: periodo.id,
        employeeId,
        type: LiquidationType.LIQUIDACION_FINAL,
      },
    },
    create: {
      periodId: periodo.id,
      employeeId,
      type: LiquidationType.LIQUIDACION_FINAL,
      status: LiquidationStatus.BORRADOR,
      year,
      month,
      diasTrabajados: mesesTrabajadosAnio * 30,
      totalHaberes: totalBruto,
      totalDescuentos,
      totalPatronal: aportesPatronales.total,
      liquidoPercibir,
      parametersSnapshot: { bpc: params.bpc.toString(), fechaEgreso: fechaEgreso.toISOString() },
    },
    update: {
      status: LiquidationStatus.BORRADOR,
      totalHaberes: totalBruto,
      totalDescuentos,
      totalPatronal: aportesPatronales.total,
      liquidoPercibir,
    },
  });

  await prisma.payrollItem.deleteMany({ where: { liquidationId: liquidacion.id } });
  await prisma.payrollItem.createMany({
    data: [
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'INDEMNIZACION', descripcion: `Indemnización por despido (${mesesIndemnizacion} meses)`,
        baseCalculo: employee.salarioNominal, rate: null, amount: indemnizacion,
        calculationDetail: { mesesIndemnizacion, antiguedadAnios } as unknown as Prisma.InputJsonValue,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'PREAVISO', descripcion: `Preaviso (${diasPraveiso} días)`,
        baseCalculo: salarioDiario, rate: null, amount: preaviso,
        calculationDetail: { diasPraveiso } as unknown as Prisma.InputJsonValue,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'AGUINALDO_PROPORCIONAL', descripcion: `Proporcional aguinaldo (${mesesEnSemestre} meses)`,
        baseCalculo: employee.salarioNominal, rate: null, amount: aguinaldoProporcional,
        calculationDetail: { mesesEnSemestre } as unknown as Prisma.InputJsonValue,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'LICENCIA_PENDIENTE', descripcion: `Licencia pendiente (${diasLicenciaPendientes} días)`,
        baseCalculo: employee.salarioNominal, rate: null, amount: licenciaPendiente,
        calculationDetail: { diasLicenciaPendientes, diasTomados } as unknown as Prisma.InputJsonValue,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'SALARIO_VACACIONAL', descripcion: 'Salario vacacional sobre licencia pendiente',
        baseCalculo: licenciaPendiente, rate: 10000, amount: salarioVacacionalPendiente,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'BPS_JUBILATORIO', descripcion: 'BPS Jubilatorio',
        baseCalculo: baseBpsIrpf, rate: params.bpsJubilatorioRate, amount: aportesObreros.jubilatorio,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FONASA', descripcion: 'FONASA/DISSE',
        baseCalculo: baseBpsIrpf, rate: params.fonasaBasicRate, amount: aportesObreros.fonasaTotal,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FRL', descripcion: 'FRL',
        baseCalculo: baseBpsIrpf, rate: params.frlObreroRate, amount: aportesObreros.frl,
        calculationDetail: Prisma.DbNull,
      },
      ...(irpfResult.retencionMensual > 0n ? [{
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'IRPF', descripcion: 'IRPF',
        baseCalculo: baseBpsIrpf, rate: null, amount: irpfResult.retencionMensual,
        calculationDetail: Prisma.DbNull,
      }] : []),
    ],
  });

  await prisma.employee.update({
    where: { id: employeeId },
    data: { fechaEgreso, active: false },
  });

  return {
    liquidacionId: liquidacion.id,
    indemnizacion,
    preaviso,
    aguinaldoProporcional,
    licenciaPendiente,
    salarioVacacionalPendiente,
    totalBruto,
    totalDescuentos,
    liquidoPercibir,
    antiguedadAnios,
    antiguedadMeses,
    diasPraveiso,
    mesesIndemnizacion,
  };
}
