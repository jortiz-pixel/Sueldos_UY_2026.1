/**
 * SERVICIO DE AGUINALDO
 */

import { LiquidationType, LiquidationStatus, ItemType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { multiplyFraction, maxBigInt, applyRate } from '../utils/money';
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

// Meses del semestre legal del aguinaldo: el de junio (mes <= 6) cubre
// Dic(año-1)–May; el de diciembre cubre Jun–Nov.
function mesesDelSemestre(year: number, month: number): { year: number; month: number }[] {
  const meses: { year: number; month: number }[] = [];
  if (month <= 6) {
    meses.push({ year: year - 1, month: 12 });
    for (let m = 1; m <= 5; m++) meses.push({ year, month: m });
  } else {
    for (let m = 6; m <= 11; m++) meses.push({ year, month: m });
  }
  return meses;
}

// Aguinaldo bruto = (suma de haberes de las mensuales CONFIRMADAS del semestre)
// / 12. Se usa tanto para liquidar el aguinaldo como para la base del adicional
// FONASA de la mensualidad de junio/diciembre. Devuelve 0 si no hay confirmadas.
export async function calcularAguinaldoBrutoSemestre(
  employeeId: string, year: number, month: number,
): Promise<{ bruto: bigint; sumaHaberesSemestre: bigint; mesesConsiderados: number }> {
  const liquidaciones = await prisma.liquidation.findMany({
    where: {
      employeeId,
      type: LiquidationType.MENSUAL,
      status: LiquidationStatus.CONFIRMADO,
      OR: mesesDelSemestre(year, month),
    },
    select: { totalHaberes: true },
  });
  const sumaHaberesSemestre = liquidaciones.reduce((s, l) => s + l.totalHaberes, 0n);
  return {
    bruto: multiplyFraction(sumaHaberesSemestre, 1, 12),
    sumaHaberesSemestre,
    mesesConsiderados: liquidaciones.length,
  };
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

  const pagaJunio = input.month <= 6;

  // Base = haberes REALMENTE generados en las mensuales CONFIRMADAS del semestre.
  const { bruto: aguinaldoBruto, sumaHaberesSemestre, mesesConsiderados } =
    await calcularAguinaldoBrutoSemestre(input.employeeId, input.year, input.month);

  if (mesesConsiderados === 0) {
    throw new AppError(
      400,
      'No hay liquidaciones mensuales confirmadas en el semestre del aguinaldo (Dic–May para el de junio; Jun–Nov para el de diciembre). Confirmá las mensuales del semestre antes de generar el aguinaldo.',
    );
  }

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

  // FONASA sobre aguinaldo: SOLO el 3% (seguro de enfermedad). El ADICIONAL
  // (complemento por hijos/cónyuge/escalón) NO se descuenta en el aguinaldo; se
  // traslada a la mensualidad de junio/diciembre, donde se calcula sobre
  // (nominal del mes + aguinaldo). Ver recibos GNS de junio.
  const fonasaAguinaldo = applyRate(aguinaldoBruto, params.fonasaBasicRate);

  const irpf = calcularIrpfAguinaldo(
    aguinaldoBruto,
    aportesObreros.jubilatorio,
    fonasaAguinaldo,
    params,
  );

  const totalDescuentos = aportesObreros.jubilatorio + fonasaAguinaldo + aportesObreros.frl + irpf;
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
        descripcion: 'BPS Jubilatorio sobre aguinaldo',
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
        rate: params.fonasaBasicRate, // 3% (sin adicional en el aguinaldo)
        amount: fonasaAguinaldo,
        calculationDetail: { soloSeguro: true, adicionalEnMensualidad: true } as unknown as Prisma.InputJsonValue,
      },
      {
        liquidationId: liquidacion.id,
        employeeId: input.employeeId,
        itemType: ItemType.DESCUENTO_OBRERO,
        concepto: 'FRL',
        descripcion: 'Fondo de Reconversión Laboral sobre aguinaldo',
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
    fonasa: fonasaAguinaldo,
    frl: aportesObreros.frl,
    irpf,
    aguinaldoNeto,
    baseCalculo: sumaHaberesSemestre,
    mesesConsiderados,
  };
}
