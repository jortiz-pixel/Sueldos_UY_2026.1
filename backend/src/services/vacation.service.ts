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
import { resolverContratoVigente, datosLaboralesEfectivos } from './contract.service';
import { AppError } from '../middleware/errorHandler';

export interface LicenciaInput {
  employeeId: string;
  periodId: string;
  year: number;
  month: number;
  diasHabilesTomar: number;
  anticipar?: boolean; // permite tomar más días que los disponibles (anticipo)
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

  // Sin saldo suficiente se bloquea, salvo que se pida explícitamente como
  // anticipo (el saldo puede quedar negativo, igual que en el calendario).
  if (input.diasHabilesTomar > diasDisponibles && !input.anticipar) {
    throw new AppError(400, `Días insuficientes. Disponibles: ${diasDisponibles}, solicitados: ${input.diasHabilesTomar}. Marcá "anticipar" para tomarlos igual.`);
  }

  // Base de licencia = SUELDO BÁSICO mensual (el jornal nominal es básico/30).
  // Mensual: el nominal del contrato vigente. Jornalero: jornal × 30. Es la misma
  // base que usa la licencia gozada en la mensualidad, para que el líquido de
  // ambos conceptos coincida.
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: input.periodId }, select: { companyId: true },
  });
  const contrato = await resolverContratoVigente(input.employeeId, asOfDate, period?.companyId);
  const labor = datosLaboralesEfectivos(employee, contrato);
  const baseLicencia = labor.salaryType === 'MENSUAL'
    ? labor.salarioNominal
    : (labor.jornal ?? 0n) * 30n;

  // El salario vacacional se paga con el JORNAL LÍQUIDO (nominal del día menos
  // los aportes personales), EXENTO de aportes (Ley 16.101). GNS lo emite en una
  // liquidación aparte, 100% líquido: la licencia gozada (con sus aportes) va en
  // la mensualidad, desglosada en días de jornal + días de licencia.
  const jornalBruto = multiplyFraction(baseLicencia, 1, 30);
  const aportesMes = calcularAportesObreros({
    salarioNominal: baseLicencia,
    hijosACargo: employee.hijosACargo,
    conyugeACargo: employee.conyugeACargo,
    params,
    bseRateEmpresa: bseRate,
  });
  const jornalLiquido = multiplyFraction(maxBigInt(0n, baseLicencia - aportesMes.total), 1, 30);
  // Días pueden ser fraccionados (ej. 8,33): se multiplica el jornal líquido por
  // la cantidad de días y se redondea al centésimo.
  const salarioVacacional = BigInt(Math.round(Number(jornalLiquido) * input.diasHabilesTomar));
  const jornalLiquidoTxt = (Number(jornalLiquido) / 100).toFixed(2);

  const totalBruto = salarioVacacional;
  const totalDescuentos = 0n;             // exento: sin descuentos
  const totalPatronal = 0n;               // exento de aportes patronales
  const liquidoPercibir = salarioVacacional;

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
      totalPatronal,
      liquidoPercibir,
      parametersSnapshot: { bpc: params.bpc.toString() },
    },
    update: {
      status: LiquidationStatus.BORRADOR,
      diasTrabajados: input.diasHabilesTomar,
      diasHabiles: input.diasHabilesTomar,
      totalHaberes: totalBruto,
      totalDescuentos,
      totalPatronal,
      liquidoPercibir,
    },
  });

  await prisma.payrollItem.deleteMany({ where: { liquidationId: liquidacion.id } });
  await prisma.payrollItem.create({
    data: {
      liquidationId: liquidacion.id,
      employeeId: input.employeeId,
      itemType: ItemType.HABER,
      concepto: 'SALARIO_VACACIONAL',
      descripcion: `Salario Vacacional ${input.diasHabilesTomar} x ${jornalLiquidoTxt}`,
      baseCalculo: jornalBruto,
      rate: null,
      amount: salarioVacacional,
      calculationDetail: {
        baseLicencia: baseLicencia.toString(),
        jornalBruto: jornalBruto.toString(),
        jornalLiquido: jornalLiquido.toString(),
        aportesMes: aportesMes.total.toString(),
        diasHabiles: input.diasHabilesTomar,
        formula: '(base - aportes_personales) / 30 * dias · exento',
      } as unknown as Prisma.InputJsonValue,
    },
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
        concepto: 'FONASA', descripcion: 'FONASA (Seguro por Enfermedad)',
        baseCalculo: baseBpsIrpf, rate: aportesObreros.detail.fonasaSeguroRate, amount: aportesObreros.fonasaBasico,
        calculationDetail: Prisma.DbNull,
      },
      ...(aportesObreros.fonasaFamilia > 0n ? [{
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FONASA_ADICIONAL', descripcion: 'Adicional FONASA',
        baseCalculo: baseBpsIrpf, rate: aportesObreros.detail.fonasaAdicionalRate, amount: aportesObreros.fonasaFamilia,
        calculationDetail: Prisma.DbNull,
      }] : []),
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
