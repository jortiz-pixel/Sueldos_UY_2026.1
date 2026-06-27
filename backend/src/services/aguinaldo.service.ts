/**
 * SERVICIO DE AGUINALDO
 */

import { LiquidationType, LiquidationStatus, ItemType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { multiplyFraction, maxBigInt } from '../utils/money';
import { calcularAportesObreros, calcularAportesPatronales } from './bps.service';
import { calcularIrpfAguinaldo } from './irpf.service';
import { parametersService } from './parameters.service';
import { AppError } from '../middleware/errorHandler';

export interface AguinaldoInput {
  employeeId: string;
  periodId: string;
  year: number;
  month: number;
  mesesTrabajados?: number;
}

export async function calcularAguinaldo(input: AguinaldoInput): Promise<{
  liquidacionId: string;
  aguinaldoBruto: bigint;
  bpsObrero: bigint;
  fonasa: bigint;
  frl: bigint;
  irpf: bigint;
  aguinaldoNeto: bigint;
  baseCalculo: bigint;
  mesesConsiderados: number;
}> {
  const asOfDate = new Date(input.year, input.month - 1, 1);
  const params = await parametersService.getPayrollParameters(asOfDate);

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    include: { company: true },
  });
  if (!employee) throw new AppError(404, 'Empleado no encontrado');
  const bseRate = employee.company?.bseRate ?? 0;

  const esPrimerSemestre = input.month <= 6;
  const mesInicioSemestre = esPrimerSemestre ? 1 : 7;
  const mesFinSemestre = esPrimerSemestre ? 6 : 12;

  let mesesTrabajados = input.mesesTrabajados;
  if (!mesesTrabajados) {
    const fechaIngreso = employee.fechaIngreso;
    const inicioSemestre = new Date(input.year, mesInicioSemestre - 1, 1);
    const finSemestre = new Date(input.year, mesFinSemestre - 1, 31);
    const inicio = fechaIngreso > inicioSemestre ? fechaIngreso : inicioSemestre;
    const fin = (employee.fechaEgreso && employee.fechaEgreso < finSemestre)
      ? employee.fechaEgreso
      : finSemestre;

    if (inicio > fin) {
      mesesTrabajados = 0;
    } else {
      mesesTrabajados = Math.round(
        (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
      );
      mesesTrabajados = Math.min(6, Math.max(0, mesesTrabajados));
    }
  }

  if (mesesTrabajados === 0) {
    throw new AppError(400, 'El empleado no tiene meses trabajados en el semestre');
  }

  const liquidacionesSemestre = await prisma.liquidation.findMany({
    where: {
      employeeId: input.employeeId,
      type: LiquidationType.MENSUAL,
      year: input.year,
      month: { gte: mesInicioSemestre, lte: mesFinSemestre },
      status: LiquidationStatus.CONFIRMADO,
    },
    include: {
      items: {
        where: {
          itemType: ItemType.HABER,
          concepto: { in: ['SUELDO_BASICO', 'HORAS_EXTRA_DIURNAS', 'HORAS_EXTRA_NOCTURNAS', 'COMISIONES'] },
        },
      },
    },
  });

  let sumaHaberesSemestre: bigint;
  if (liquidacionesSemestre.length > 0) {
    sumaHaberesSemestre = liquidacionesSemestre.reduce((sum, liq) => {
      const haberesLiq = liq.items.reduce((s, item) => s + item.amount, 0n);
      return sum + haberesLiq;
    }, 0n);
  } else {
    sumaHaberesSemestre = employee.salarioNominal * BigInt(mesesTrabajados);
  }

  const aguinaldoBruto = multiplyFraction(sumaHaberesSemestre, 1, 12);

  const aportesObreros = calcularAportesObreros({
    salarioNominal: aguinaldoBruto,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: bseRate,
  });

  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: aguinaldoBruto,
    fonasaFamilia: employee.fonasaFamilia,
    params,
    bseRateEmpresa: bseRate,
  });

  const irpf = calcularIrpfAguinaldo(
    aguinaldoBruto,
    aportesObreros.jubilatorio,
    aportesObreros.fonasaTotal,
    params,
  );

  const totalDescuentos = aportesObreros.jubilatorio + aportesObreros.fonasaTotal + aportesObreros.frl + irpf;
  const aguinaldoNeto = maxBigInt(0n, aguinaldoBruto - totalDescuentos);

  const liquidacion = await prisma.liquidation.upsert({
    where: {
      periodId_employeeId_type: {
        periodId: input.periodId,
        employeeId: input.employeeId,
        type: LiquidationType.AGUINALDO,
      },
    },
    create: {
      periodId: input.periodId,
      employeeId: input.employeeId,
      type: LiquidationType.AGUINALDO,
      status: LiquidationStatus.BORRADOR,
      year: input.year,
      month: input.month,
      diasTrabajados: mesesTrabajados * 30,
      totalHaberes: aguinaldoBruto,
      totalDescuentos,
      totalPatronal: aportesPatronales.total,
      liquidoPercibir: aguinaldoNeto,
      parametersSnapshot: {
        bpc: params.bpc.toString(),
        mesesTrabajados,
        sumaHaberesSemestre: sumaHaberesSemestre.toString(),
      },
    },
    update: {
      status: LiquidationStatus.BORRADOR,
      totalHaberes: aguinaldoBruto,
      totalDescuentos,
      totalPatronal: aportesPatronales.total,
      liquidoPercibir: aguinaldoNeto,
    },
  });

  await prisma.payrollItem.deleteMany({ where: { liquidationId: liquidacion.id } });
  await prisma.payrollItem.createMany({
    data: [
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.HABER,
        concepto: 'AGUINALDO',
        descripcion: `Aguinaldo ${esPrimerSemestre ? '1er' : '2do'} semestre ${input.year} (${mesesTrabajados} meses)`,
        baseCalculo: sumaHaberesSemestre,
        rate: null,
        amount: aguinaldoBruto,
        calculationDetail: {
          sumaHaberesSemestre: sumaHaberesSemestre.toString(),
          mesesTrabajados,
          formula: 'suma_haberes / 12',
        } as unknown as Prisma.InputJsonValue,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'BPS_JUBILATORIO',
        descripcion: `BPS Jubilatorio sobre aguinaldo (${params.bpsJubilatorioRate / 100}%)`,
        baseCalculo: aguinaldoBruto,
        rate: params.bpsJubilatorioRate,
        amount: aportesObreros.jubilatorio,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FONASA',
        descripcion: 'FONASA sobre aguinaldo',
        baseCalculo: aguinaldoBruto,
        rate: params.fonasaBasicRate + (employee.fonasaFamilia ? params.fonasaFamiliaRate : 0),
        amount: aportesObreros.fonasaTotal,
        calculationDetail: Prisma.DbNull,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FRL',
        descripcion: 'FRL sobre aguinaldo',
        baseCalculo: aguinaldoBruto,
        rate: params.frlObreroRate,
        amount: aportesObreros.frl,
        calculationDetail: Prisma.DbNull,
      },
      ...(irpf > 0n ? [{
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'IRPF',
        descripcion: 'IRPF sobre aguinaldo',
        baseCalculo: aguinaldoBruto,
        rate: null,
        amount: irpf,
        calculationDetail: Prisma.DbNull,
      }] : []),
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.APORTE_PATRONAL,
        concepto: 'BPS_IVS_PATRONAL',
        descripcion: 'BPS IVS Patronal sobre aguinaldo',
        baseCalculo: aguinaldoBruto,
        rate: params.bpsIvsPatronalRate,
        amount: aportesPatronales.bpsIvs,
        calculationDetail: Prisma.DbNull,
      },
    ],
  });

  return {
    liquidacionId: liquidacion.id,
    aguinaldoBruto,
    bpsObrero: aportesObreros.jubilatorio,
    fonasa: aportesObreros.fonasaTotal,
    frl: aportesObreros.frl,
    irpf,
    aguinaldoNeto,
    baseCalculo: sumaHaberesSemestre,
    mesesConsiderados: mesesTrabajados,
  };
}
