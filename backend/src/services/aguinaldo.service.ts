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

  // Semestre legal del aguinaldo: el de junio cubre Dic(año-1)–May; el de diciembre cubre Jun–Nov.
  const pagaJunio = input.month <= 6;
  const meses: { year: number; month: number }[] = [];
  if (pagaJunio) {
    meses.push({ year: input.year - 1, month: 12 });
    for (let m = 1; m <= 5; m++) meses.push({ year: input.year, month: m });
  } else {
    for (let m = 6; m <= 11; m++) meses.push({ year: input.year, month: m });
  }

  // Base = haberes REALMENTE generados en las liquidaciones MENSUALES CONFIRMADAS del semestre.
  const liquidacionesSemestre = await prisma.liquidation.findMany({
    where: {
      employeeId: input.employeeId,
      type: LiquidationType.MENSUAL,
      status: LiquidationStatus.CONFIRMADO,
      OR: meses,
    },
    select: { totalHaberes: true },
  });

  if (liquidacionesSemestre.length === 0) {
    throw new AppError(
      400,
      'No hay liquidaciones mensuales confirmadas en el semestre del aguinaldo (Dic–May para el de junio; Jun–Nov para el de diciembre). Confirmá las mensuales del semestre antes de generar el aguinaldo.',
    );
  }

  const sumaHaberesSemestre = liquidacionesSemestre.reduce((s, l) => s + l.totalHaberes, 0n);
  const mesesConsiderados = liquidacionesSemestre.length;
  const aguinaldoBruto = multiplyFraction(sumaHaberesSemestre, 1, 12);

  const aportesObreros = calcularAportesObreros({
    salarioNominal: aguinaldoBruto,
    hijosACargo: employee.hijosACargo,
    conyugeACargo: employee.conyugeACargo,
    params,
    bseRateEmpresa: bseRate,
  });

  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: aguinaldoBruto,
    hijosACargo: employee.hijosACargo,
    conyugeACargo: employee.conyugeACargo,
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
      diasTrabajados: mesesConsiderados * 30,
      totalHaberes: aguinaldoBruto,
      totalDescuentos,
      totalPatronal: aportesPatronales.total,
      liquidoPercibir: aguinaldoNeto,
      parametersSnapshot: {
        bpc: params.bpc.toString(),
        mesesConsiderados,
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
        descripcion: `Aguinaldo ${pagaJunio ? '1er' : '2do'} semestre ${input.year} (${mesesConsiderados} ${mesesConsiderados === 1 ? 'mes' : 'meses'} confirmados)`,
        baseCalculo: sumaHaberesSemestre,
        rate: null,
        amount: aguinaldoBruto,
        calculationDetail: {
          sumaHaberesSemestre: sumaHaberesSemestre.toString(),
          mesesConsiderados,
          formula: 'suma_haberes_semestre / 12',
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
        rate: aportesObreros.detail.fonasaRateEfectivo,
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
    mesesConsiderados,
  };
}
