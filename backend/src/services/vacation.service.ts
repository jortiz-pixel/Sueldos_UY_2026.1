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
import { resolverContratoVigente } from './contract.service';
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

  // Base de licencia = promedio mensual de los haberes reales de los últimos 12 meses
  // trabajados (liquidaciones MENSUALES confirmadas). Sin historial, cae al nominal.
  const ultimas = await prisma.liquidation.findMany({
    where: { employeeId: input.employeeId, type: LiquidationType.MENSUAL, status: LiquidationStatus.CONFIRMADO },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 12,
    select: { totalHaberes: true },
  });
  const mesesPromedio = ultimas.length;
  const baseLicencia = mesesPromedio > 0
    ? ultimas.reduce((s, l) => s + l.totalHaberes, 0n) / BigInt(mesesPromedio)
    : employee.salarioNominal;

  // Importe de licencia (GRAVADO) = base / 30 × días tomados.
  const jornalBruto = multiplyFraction(baseLicencia, 1, 30);
  const importeLicencia = multiplyFraction(baseLicencia, input.diasHabilesTomar, 30);

  // Aportes SOLO sobre la licencia (el salario vacacional es EXENTO de CESS).
  const aportesObreros = calcularAportesObreros({
    salarioNominal: importeLicencia,
    hijosACargo: employee.hijosACargo,
    conyugeACargo: employee.conyugeACargo,
    params,
    bseRateEmpresa: bseRate,
  });

  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: importeLicencia,
    hijosACargo: employee.hijosACargo,
    conyugeACargo: employee.conyugeACargo,
    params,
    bseRateEmpresa: bseRate,
  });

  // Salario vacacional = 100% del jornal LÍQUIDO de vacaciones (licencia − aportes personales). Exento de CESS.
  const salarioVacacional = maxBigInt(0n, importeLicencia - aportesObreros.total);

  const totalBruto = importeLicencia + salarioVacacional;

  // IRPF: tanto la licencia gozada como el salario vacacional son renta gravada por IRPF.
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
        descripcion: `Salario de licencia (${input.diasHabilesTomar} días · base prom. ${mesesPromedio || 'nominal'} ${mesesPromedio ? 'm/30' : ''})`,
        baseCalculo: jornalBruto,
        rate: null,
        amount: importeLicencia,
        calculationDetail: {
          baseLicencia: baseLicencia.toString(),
          jornalBruto: jornalBruto.toString(),
          mesesPromedio,
          diasHabiles: input.diasHabilesTomar,
          formula: 'promedio_haberes_12m / 30 * dias',
        } as unknown as Prisma.InputJsonValue,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.HABER,
        concepto: 'SALARIO_VACACIONAL',
        descripcion: 'Salario vacacional (jornal líquido de vacaciones · exento de aportes)',
        baseCalculo: importeLicencia,
        rate: null,
        amount: salarioVacacional,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'BPS_JUBILATORIO',
        descripcion: 'BPS Jubilatorio sobre licencia',
        baseCalculo: importeLicencia,
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
        baseCalculo: importeLicencia,
        rate: params.fonasaBasicRate,
        amount: aportesObreros.fonasaTotal,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FRL',
        descripcion: 'Fondo de Reconversión Laboral sobre licencia',
        baseCalculo: importeLicencia,
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
    salarioLicencia: importeLicencia,
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
  companyIdParam?: string,
) {
  const params = await parametersService.getPayrollParameters(fechaEgreso);

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { company: true },
  });
  if (!employee) throw new AppError(404, 'Empleado no encontrado');
  const companyId = companyIdParam ?? employee.companyId;
  if (!companyId) throw new AppError(400, 'La persona no tiene empresa asociada para la liquidación final');
  // Empresa y contrato vigente a la fecha de egreso: la base se toma del CONTRATO
  // de esa empresa (no del dato global), para que sea correcto en multiempresa.
  const company = companyId === employee.companyId
    ? employee.company
    : await prisma.company.findUnique({ where: { id: companyId } });
  const bseRate = company?.bseRate ?? 0;
  const contrato = await resolverContratoVigente(employeeId, fechaEgreso, companyId);
  const salarioBase = contrato?.salarioNominal ?? employee.salarioNominal;

  const year = fechaEgreso.getFullYear();
  const month = fechaEgreso.getMonth() + 1;

  const antiguedadMeses = calcularAntiguedadMeses(employee.fechaIngreso, fechaEgreso);
  const antiguedadAnios = Math.floor(antiguedadMeses / 12);

  const mesesIndemnizacion = Math.min(antiguedadAnios, 6);
  const indemnizacion = salarioBase * BigInt(mesesIndemnizacion);

  const diasPraveiso = diasPreavisoCorrespondientes(antiguedadMeses);
  const salarioDiario = multiplyFraction(salarioBase, 1, 30);
  const preaviso = salarioDiario * BigInt(diasPraveiso);

  const mesInicioSemestre = month <= 6 ? 1 : 7;
  const mesesEnSemestre = month - mesInicioSemestre + 1;
  const aguinaldoProporcional = multiplyFraction(
    salarioBase * BigInt(mesesEnSemestre),
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
  const licenciaPendiente = multiplyFraction(salarioBase, diasLicenciaPendientes, 25);
  const salarioVacacionalPendiente = licenciaPendiente;

  const totalBruto = indemnizacion + preaviso + aguinaldoProporcional
    + licenciaPendiente + salarioVacacionalPendiente;

  const baseBpsIrpf = aguinaldoProporcional + licenciaPendiente + salarioVacacionalPendiente;
  const aportesObreros = calcularAportesObreros({
    salarioNominal: baseBpsIrpf,
    hijosACargo: employee.hijosACargo,
    conyugeACargo: employee.conyugeACargo,
    params,
    bseRateEmpresa: bseRate,
  });
  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: baseBpsIrpf,
    hijosACargo: employee.hijosACargo,
    conyugeACargo: employee.conyugeACargo,
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
        baseCalculo: salarioBase, rate: null, amount: indemnizacion,
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
        baseCalculo: salarioBase, rate: null, amount: aguinaldoProporcional,
        calculationDetail: { mesesEnSemestre } as unknown as Prisma.InputJsonValue,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'LICENCIA_PENDIENTE', descripcion: `Licencia pendiente (${diasLicenciaPendientes} días)`,
        baseCalculo: salarioBase, rate: null, amount: licenciaPendiente,
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
        concepto: 'FONASA', descripcion: 'FONASA',
        baseCalculo: baseBpsIrpf, rate: params.fonasaBasicRate, amount: aportesObreros.fonasaTotal,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FRL', descripcion: 'Fondo de Reconversión Laboral',
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

  // Nota: la desvinculación de la persona (inactivar / fechaEgreso) la maneja
  // el endpoint de baja según si le quedan contratos vigentes en otras empresas.

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
