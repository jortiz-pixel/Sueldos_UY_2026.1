/**
 * SERVICIO DE LICENCIA Y SALARIO VACACIONAL
 *
 * LICENCIA ANUAL (Ley 12.590 y modificativas):
 * ─────────────────────────────────────────────
 * - 0-4 años de antigüedad:  20 días hábiles/año
 * - 5-9 años de antigüedad:  25 días hábiles/año
 * - 10+ años de antigüedad:  30 días hábiles/año
 *
 * SALARIO VACACIONAL:
 * ───────────────────
 * Se abona junto con la licencia. Equivale al 100% del jornal
 * de los días de licencia tomados (es adicional al sueldo de licencia).
 *
 * LIQUIDACIÓN DE LICENCIA:
 * ─────────────────────────
 * 1. Calcular días hábiles de licencia a tomar
 * 2. Salario de licencia = salario diario × días hábiles de licencia
 * 3. Salario vacacional = salario de licencia (100% adicional)
 * 4. Total bruto = salario licencia + salario vacacional
 * 5. Descuentos BPS + IRPF sobre el total bruto
 */

import { LiquidationType, LiquidationStatus, ItemType } from '@prisma/client';
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
  diasHabilesTomar: number;   // Días hábiles de licencia en este trámite
}

export async function calcularLiquidacionLicencia(input: LicenciaInput) {
  const asOfDate = new Date(input.year, input.month - 1, 1);
  const params = await parametersService.getPayrollParameters(asOfDate);

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    include: { company: true },
  });
  if (!employee) throw new AppError(404, 'Empleado no encontrado');

  const antiguedad = calcularAntiguedad(employee.fechaIngreso, asOfDate);
  const diasCorresponden = diasLicenciaCorrespondientes(antiguedad);

  // Verificar disponibilidad de días
  const accrual = await prisma.vacationAccrual.findUnique({
    where: { employeeId_year: { employeeId: input.employeeId, year: input.year } },
  });
  const diasDisponibles = accrual
    ? accrual.diasCorresponden - accrual.diasTomados
    : diasCorresponden;

  if (input.diasHabilesTomar > diasDisponibles) {
    throw new AppError(400, `Días insuficientes. Disponibles: ${diasDisponibles}, solicitados: ${input.diasHabilesTomar}`);
  }

  // ── Cálculo de importes ──────────────────────────────────────
  // Salario diario = salario nominal / 25 (días hábiles estándar del mes)
  const salarioDiario = multiplyFraction(employee.salarioNominal, 1, 25);

  // Salario de licencia (lo que gana durante los días de vacaciones)
  const salarioLicencia = salarioDiario * BigInt(input.diasHabilesTomar);

  // Salario vacacional (100% adicional sobre el salario de licencia)
  const salarioVacacional = salarioLicencia;

  const totalBruto = salarioLicencia + salarioVacacional;

  // Aportes obreros
  const aportesObreros = calcularAportesObreros({
    salarioNominal: totalBruto,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: employee.company.bseRate,
  });

  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: totalBruto,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: employee.company.bseRate,
  });

  // IRPF (proyección anual sobre base vacaciones)
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

  // Persistir
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
        },
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.HABER,
        concepto: 'SALARIO_VACACIONAL',
        descripcion: 'Salario vacacional (100% del salario de licencia)',
        baseCalculo: salarioLicencia,
        rate: 10000, // 100%
        amount: salarioVacacional,
        calculationDetail: null,
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
        calculationDetail: null,
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
        calculationDetail: null,
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
        calculationDetail: null,
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
        calculationDetail: null,
      }] : []),
    ],
  });

  // Actualizar accrual de vacaciones
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

/**
 * LIQUIDACIÓN FINAL (Despido)
 *
 * Calcula la indemnización por despido:
 * - Indemnización: 1 mes de sueldo por año trabajado (máx 6 meses)
 * - Preaviso: según antigüedad
 * - Proporcional de aguinaldo del semestre en curso
 * - Proporcional de licencia no tomada
 */
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

  const year = fechaEgreso.getFullYear();
  const month = fechaEgreso.getMonth() + 1;

  const antiguedadMeses = calcularAntiguedadMeses(employee.fechaIngreso, fechaEgreso);
  const antiguedadAnios = Math.floor(antiguedadMeses / 12);

  // ── Indemnización ────────────────────────────────────────────
  // 1 mes de sueldo por año (máximo 6 meses según Ley)
  const mesesIndemnizacion = Math.min(antiguedadAnios, 6);
  const indemnizacion = employee.salarioNominal * BigInt(mesesIndemnizacion);

  // ── Preaviso ─────────────────────────────────────────────────
  const diasPraveiso = diasPreavisoCorrespondientes(antiguedadMeses);
  const salarioDiario = multiplyFraction(employee.salarioNominal, 1, 30);
  const preaviso = salarioDiario * BigInt(diasPraveiso);

  // ── Proporcional de aguinaldo ────────────────────────────────
  const mesInicioSemestre = month <= 6 ? 1 : 7;
  const mesesEnSemestre = month - mesInicioSemestre + 1;
  const aguinaldoProporcional = multiplyFraction(
    employee.salarioNominal * BigInt(mesesEnSemestre),
    1, 12,
  );

  // ── Proporcional de licencia no tomada ───────────────────────
  const diasLicenciaAnuales = diasLicenciaCorrespondientes(antiguedadAnios);
  const accrual = await prisma.vacationAccrual.findUnique({
    where: { employeeId_year: { employeeId, year } },
  });
  const diasTomados = accrual?.diasTomados ?? 0;
  const mesesTrabajadosAnio = month;
  const diasLicenciaProporcional = Math.round(diasLicenciaAnuales * mesesTrabajadosAnio / 12);
  const diasLicenciaPendientes = Math.max(0, diasLicenciaProporcional - diasTomados);
  const licenciaPendiente = multiplyFraction(employee.salarioNominal, diasLicenciaPendientes, 25);
  const salarioVacacionalPendiente = licenciaPendiente; // 100%

  const totalBruto = indemnizacion + preaviso + aguinaldoProporcional
    + licenciaPendiente + salarioVacacionalPendiente;

  // BPS y IRPF solo sobre rubros gravados (aguinaldo prop. + licencia)
  const baseBpsIrpf = aguinaldoProporcional + licenciaPendiente + salarioVacacionalPendiente;
  const aportesObreros = calcularAportesObreros({
    salarioNominal: baseBpsIrpf,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: employee.company.bseRate,
  });
  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: baseBpsIrpf,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: employee.company.bseRate,
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

  // Buscar o crear período
  const periodo = await prisma.payrollPeriod.upsert({
    where: { companyId_year_month: { companyId: employee.companyId, year, month } },
    create: { companyId: employee.companyId, year, month },
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
        baseCalculo: employee.salarioNominal, rate: null, amount: indemnizacion, calculationDetail: { mesesIndemnizacion, antiguedadAnios },
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'PREAVISO', descripcion: `Preaviso (${diasPraveiso} días)`,
        baseCalculo: salarioDiario, rate: null, amount: preaviso, calculationDetail: { diasPraveiso },
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'AGUINALDO_PROPORCIONAL', descripcion: `Proporcional aguinaldo (${mesesEnSemestre} meses)`,
        baseCalculo: employee.salarioNominal, rate: null, amount: aguinaldoProporcional,
        calculationDetail: { mesesEnSemestre },
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'LICENCIA_PENDIENTE', descripcion: `Licencia pendiente (${diasLicenciaPendientes} días)`,
        baseCalculo: employee.salarioNominal, rate: null, amount: licenciaPendiente,
        calculationDetail: { diasLicenciaPendientes, diasTomados },
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'SALARIO_VACACIONAL', descripcion: 'Salario vacacional sobre licencia pendiente',
        baseCalculo: licenciaPendiente, rate: 10000, amount: salarioVacacionalPendiente, calculationDetail: null,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'BPS_JUBILATORIO', descripcion: 'BPS Jubilatorio',
        baseCalculo: baseBpsIrpf, rate: params.bpsJubilatorioRate, amount: aportesObreros.jubilatorio, calculationDetail: null,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FONASA', descripcion: 'FONASA/DISSE',
        baseCalculo: baseBpsIrpf, rate: params.fonasaBasicRate, amount: aportesObreros.fonasaTotal, calculationDetail: null,
      },
      {
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FRL', descripcion: 'FRL',
        baseCalculo: baseBpsIrpf, rate: params.frlObreroRate, amount: aportesObreros.frl, calculationDetail: null,
      },
      ...(irpfResult.retencionMensual > 0n ? [{
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'IRPF', descripcion: 'IRPF',
        baseCalculo: baseBpsIrpf, rate: null, amount: irpfResult.retencionMensual, calculationDetail: null,
      }] : []),
    ],
  });

  // Actualizar fecha de egreso
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
