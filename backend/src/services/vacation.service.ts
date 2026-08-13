/**
 * SERVICIO DE LICENCIA Y SALARIO VACACIONAL
 */

import { LiquidationType, LiquidationStatus, ItemType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { multiplyFraction, maxBigInt } from '../utils/money';
import { calcularAportesObreros, calcularAportesPatronales, fonasaCargasDeSeguroSalud } from './bps.service';
import { calcularIrpfMensual } from './irpf.service';
import { parametersService } from './parameters.service';
import {
  diasLicenciaCorrespondientes,
  calcularAntiguedad,
  calcularAntiguedadMeses,
} from '../utils/date';
import { resolverContratoVigente, datosLaboralesEfectivos } from './contract.service';
import { AppError } from '../middleware/errorHandler';

// Conceptos HABER que NO integran el concepto 1 (monto imponible): no gravados y
// partidas exentas del laudo de construcción (codBps 5). El resto de los haberes
// (básico, prima, horas extra, presentismos gravados, faltas negativas…) sí.
const NO_IMPONIBLE = new Set([
  'SALARIO_VACACIONAL', 'AJUSTE_NO_GRAVADO', 'REINTEGRO_GASTOS', 'VIATICOS',
  'MEDIAS_HORAS', 'DESGASTE_ROPA', 'GASTOS_TRANSPORTE', 'DESGASTE_HERRAMIENTAS',
]);

function imponibleDeLiquidacion(items: { itemType: ItemType; concepto: string; amount: bigint }[]): bigint {
  return items
    .filter((i) => i.itemType === ItemType.HABER && !NO_IMPONIBLE.has(i.concepto))
    .reduce((s, i) => s + i.amount, 0n);
}

// Base imponible del SALARIO VACACIONAL: PROMEDIO del concepto 1 (monto imponible
// mensual) de las ÚLTIMAS 6 mensualidades anteriores al período. Ese imponible
// incluye la prima por antigüedad y demás partidas gravadas, por eso no coincide
// con el solo básico. Si no hay historia (cliente recién migrado, sin
// mensualidades en el sistema), cae al sueldo básico del contrato.
async function baseVacacionalPromedio(
  employeeId: string, year: number, month: number, companyId: string | undefined, basicoFallback: bigint,
): Promise<{ base: bigint; meses: number }> {
  const mensuales = await prisma.liquidation.findMany({
    where: {
      employeeId,
      type: LiquidationType.MENSUAL,
      status: { not: LiquidationStatus.ANULADO },
      ...(companyId ? { period: { is: { companyId } } } : {}),
      OR: [{ year: { lt: year } }, { year, month: { lt: month } }],
    },
    include: { items: { select: { itemType: true, concepto: true, amount: true } } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 6,
  });
  const imponibles = mensuales.map((l) => imponibleDeLiquidacion(l.items)).filter((v) => v > 0n);
  if (imponibles.length === 0) return { base: basicoFallback, meses: 0 };
  const suma = imponibles.reduce((s, v) => s + v, 0n);
  return { base: suma / BigInt(imponibles.length), meses: imponibles.length };
}

export interface LicenciaInput {
  employeeId: string;
  periodId: string;
  year: number;
  month: number;
  diasHabilesTomar: number;
  anticipar?: boolean; // permite tomar más días que los disponibles (anticipo)
}

// Días de licencia que le CORRESPONDEN al empleado en un año y cuántos tiene
// DISPONIBLES (corresponden − tomados). Sirve para prellenar los "días a gozar"
// del salario vacacional (editable: si no se toma toda la licencia, se baja).
export async function vacacionalesDisponibles(
  employeeId: string, year: number, month = 12, companyId?: string,
): Promise<{
  diasCorresponden: number; diasTomados: number; diasDisponibles: number;
  jornalNominal: string; jornalLiquido: string;
}> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError(404, 'Empleado no encontrado');
  const asOfDate = new Date(year, month - 1, 1);
  const correspondenAntiguedad = diasLicenciaCorrespondientes(calcularAntiguedad(employee.fechaIngreso, asOfDate));
  const accrual = await prisma.vacationAccrual.findUnique({
    where: { employeeId_year: { employeeId, year } },
  });
  const diasCorresponden = accrual?.diasCorresponden ?? correspondenAntiguedad;
  const diasTomados = accrual?.diasTomados ?? 0;

  // Jornal del día (nominal y líquido) con el MISMO criterio que el salario
  // vacacional: base = sueldo básico del contrato vigente; jornal = base/30;
  // líquido = (base − aportes personales)/30. Sirve para mostrar en vivo
  // "días × jornal = total" y de ahí el salario vacacional.
  const cId = companyId ?? employee.companyId ?? undefined;
  const bseRate = cId
    ? (await prisma.company.findUnique({ where: { id: cId }, select: { bseRate: true } }))?.bseRate ?? 0
    : 0;
  const params = await parametersService.getPayrollParameters(asOfDate);
  const contrato = await resolverContratoVigente(employeeId, asOfDate, cId);
  const labor = datosLaboralesEfectivos(employee, contrato);
  const basico = labor.salaryType === 'MENSUAL' ? labor.salarioNominal : (labor.jornal ?? 0n) * 30n;
  // Base del vacacional = promedio del concepto 1 de las últimas 6 mensualidades.
  const { base: baseLicencia } = await baseVacacionalPromedio(employeeId, year, month, cId, basico);
  const aportes = calcularAportesObreros({
    salarioNominal: baseLicencia,
    hijosACargo: employee.hijosACargo,
    conyugeACargo: employee.conyugeACargo,
    params,
    bseRateEmpresa: bseRate,
  });
  const jornalNominal = multiplyFraction(baseLicencia, 1, 30);
  const jornalLiquido = multiplyFraction(maxBigInt(0n, baseLicencia - aportes.total), 1, 30);

  return {
    diasCorresponden, diasTomados, diasDisponibles: Math.max(0, diasCorresponden - diasTomados),
    jornalNominal: jornalNominal.toString(), jornalLiquido: jornalLiquido.toString(),
  };
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
  const basico = labor.salaryType === 'MENSUAL'
    ? labor.salarioNominal
    : (labor.jornal ?? 0n) * 30n;
  // Base del vacacional = PROMEDIO del concepto 1 (imponible) de las últimas 6
  // mensualidades (incluye prima y demás partidas gravadas). Sin historia → básico.
  const { base: baseLicencia, meses: mesesPromedio } = await baseVacacionalPromedio(
    input.employeeId, input.year, input.month, period?.companyId, basico,
  );

  // El salario vacacional se paga con el JORNAL LÍQUIDO (imponible del día menos
  // los aportes personales de seguridad social), EXENTO de aportes (Ley 16.101).
  // GNS lo emite en una liquidación aparte, 100% líquido: la licencia gozada (con
  // sus aportes) va en la mensualidad, desglosada en días de jornal + licencia.
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
        mesesPromedio: mesesPromedio,
        formula: mesesPromedio > 0
          ? `promedio concepto 1 de ${mesesPromedio} mes(es); (promedio - aportes_seg_social) / 30 * dias · exento`
          : '(basico - aportes_seg_social) / 30 * dias · exento (sin historia para promediar)',
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
  diasLicenciaOverride?: number, // días de licencia a pagar (edita el automático)
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

  // Jornal nominal (básico / 30): base de la licencia no gozada y del salario
  // vacacional por egreso (ambos EXENTOS en la liquidación final).
  const jornalNominal = multiplyFraction(salarioBase, 1, 30);
  const jornalTxt = (Number(jornalNominal) / 100).toFixed(2);

  // Causal de egreso (Tabla 9): solo el DESPIDO (2) genera indemnización (IPD).
  // En Uruguay NO aplica preaviso (no existe esa partida). El retiro voluntario,
  // término de contrato, etc. no llevan IPD.
  const causal = contrato?.causalEgresoCod ?? null;
  const generaIndemnizacion = causal === 2;

  const antiguedadMeses = calcularAntiguedadMeses(employee.fechaIngreso, fechaEgreso);
  const antiguedadAnios = Math.floor(antiguedadMeses / 12);

  const mesesIndemnizacion = generaIndemnizacion ? Math.min(antiguedadAnios, 6) : 0;
  const indemnizacion = salarioBase * BigInt(mesesIndemnizacion);

  // Días de licencia NO GOZADA: proporcional al tiempo trabajado en el año del
  // egreso (días de licencia/año × días trabajados / 360), menos los ya tomados.
  const diasLicenciaAnuales = diasLicenciaCorrespondientes(antiguedadAnios);
  const inicioAnio = new Date(year, 0, 1);
  const desdeLic = employee.fechaIngreso > inicioAnio ? employee.fechaIngreso : inicioAnio;
  const diasTrabajadosAnio = Math.max(0, Math.round((fechaEgreso.getTime() - desdeLic.getTime()) / 86400000));
  const accrual = await prisma.vacationAccrual.findUnique({
    where: { employeeId_year: { employeeId, year } },
  });
  const diasTomados = accrual?.diasTomados ?? 0;
  // Se redondea a 2 decimales (criterio GNS: los días redondeados se multiplican
  // por el jornal, ej. 4,72 × 1036,48).
  const diasNoGozadas = diasLicenciaOverride != null
    ? Math.max(0, Math.round(diasLicenciaOverride * 100) / 100)
    : Math.max(0, Math.round(((diasLicenciaAnuales * diasTrabajadosAnio) / 360 - diasTomados) * 100) / 100);
  const diasNoGozadasTxt = diasNoGozadas.toFixed(2);
  const licenciaNoGozada = BigInt(Math.round(Number(jornalNominal) * diasNoGozadas));
  const salarioVacacionalEgreso = licenciaNoGozada; // por egreso: mismo importe, exento

  // Aguinaldo por egreso: 1/12 de los haberes de las mensuales del semestre EN
  // CURSO (aún no aguinaldado) hasta el mes de egreso. El aguinaldo del semestre
  // ya cerrado se pagó en su mes (junio/diciembre) y no se vuelve a incluir.
  const mesesAg: { year: number; month: number }[] = [];
  if (month >= 6 && month <= 11) {
    for (let m = 6; m <= month; m++) mesesAg.push({ year, month: m });
  } else if (month === 12) {
    mesesAg.push({ year, month: 12 });
  } else {
    mesesAg.push({ year: year - 1, month: 12 });
    for (let m = 1; m <= month; m++) mesesAg.push({ year, month: m });
  }
  const liqsSemestre = await prisma.liquidation.findMany({
    where: {
      employeeId, type: LiquidationType.MENSUAL,
      status: { in: [LiquidationStatus.BORRADOR, LiquidationStatus.CONFIRMADO] },
      OR: mesesAg,
    },
    select: { totalHaberes: true },
  });
  const haberesSemestre = liqsSemestre.reduce((s, l) => s + l.totalHaberes, 0n);
  const aguinaldoEgreso = multiplyFraction(haberesSemestre, 1, 12);

  const totalBruto = indemnizacion + aguinaldoEgreso
    + licenciaNoGozada + salarioVacacionalEgreso;

  // Solo el aguinaldo integra la base de aportes/IRPF. La indemnización, la
  // licencia no gozada y el salario vacacional van EXENTOS.
  const baseBpsIrpf = aguinaldoEgreso;

  // FONASA adicional según el seguro de salud del contrato (respaldo: empleado).
  const cargasFonasa = fonasaCargasDeSeguroSalud(contrato?.seguroSalud);
  const fonasaHijos = cargasFonasa ? (cargasFonasa.hijos ? 1 : 0) : employee.hijosACargo;
  const fonasaConyuge = cargasFonasa ? cargasFonasa.conyuge : employee.conyugeACargo;

  const aportesObreros = calcularAportesObreros({
    salarioNominal: baseBpsIrpf,
    hijosACargo: fonasaHijos,
    conyugeACargo: fonasaConyuge,
    params,
    bseRateEmpresa: bseRate,
    topeJubilatorioMedio: true, // la base gravada de la final es aguinaldo → tope/2
  });
  const aportesPatronales = calcularAportesPatronales({
    salarioNominal: baseBpsIrpf,
    hijosACargo: fonasaHijos,
    conyugeACargo: fonasaConyuge,
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
      diasTrabajados: diasTrabajadosAnio,
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
      // HABERES. Indemnización (IPD) solo por despido; EXENTA. Sin preaviso (no aplica en Uruguay).
      ...(indemnizacion > 0n ? [{
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'INDEMNIZACION', descripcion: `Indemnización por despido (${mesesIndemnizacion} meses)`,
        baseCalculo: salarioBase, rate: null, amount: indemnizacion,
        calculationDetail: { mesesIndemnizacion, antiguedadAnios } as unknown as Prisma.InputJsonValue,
      }] : []),
      // Licencia no gozada + salario vacacional por egreso: días × jornal nominal, EXENTOS.
      ...(licenciaNoGozada > 0n ? [{
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'LICENCIA_NO_GOZADA', descripcion: `Lic. No Gozada ${diasNoGozadasTxt} x ${jornalTxt}`,
        baseCalculo: jornalNominal, rate: null, amount: licenciaNoGozada,
        calculationDetail: { diasNoGozadas, diasTomados, exento: true } as unknown as Prisma.InputJsonValue,
      }] : []),
      ...(salarioVacacionalEgreso > 0n ? [{
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'SALARIO_VACACIONAL', descripcion: `Salario Vacacional x Egreso ${diasNoGozadasTxt} x ${jornalTxt}`,
        baseCalculo: jornalNominal, rate: null, amount: salarioVacacionalEgreso,
        calculationDetail: { diasNoGozadas, exento: true } as unknown as Prisma.InputJsonValue,
      }] : []),
      // Aguinaldo por egreso (GRAVADO): 1/12 de los haberes del semestre en curso.
      ...(aguinaldoEgreso > 0n ? [{
        liquidationId: liquidacion.id, employeeId, itemType: ItemType.HABER,
        concepto: 'AGUINALDO', descripcion: 'Aguinaldo',
        baseCalculo: null, rate: null, amount: aguinaldoEgreso,
        calculationDetail: { haberesSemestre: haberesSemestre.toString(), formula: 'haberes_semestre_en_curso/12' } as unknown as Prisma.InputJsonValue,
      }] : []),
      // DESCUENTOS: solo sobre el aguinaldo (única partida gravada de la final).
      ...(aguinaldoEgreso > 0n ? [
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
        {
          // SIEMPRE figura, aun en 0 ("Adicional Fonasa 0%", estilo GNS).
          liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
          concepto: 'FONASA_ADICIONAL', descripcion: 'Adicional FONASA',
          baseCalculo: baseBpsIrpf, rate: aportesObreros.detail.fonasaAdicionalRate, amount: aportesObreros.fonasaFamilia,
          calculationDetail: Prisma.DbNull,
        },
        {
          liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
          concepto: 'FRL', descripcion: 'Fondo de Reconversión Laboral',
          baseCalculo: baseBpsIrpf, rate: params.frlObreroRate, amount: aportesObreros.frl,
          calculationDetail: Prisma.DbNull,
        },
        {
          // El IRPF figura SIEMPRE, aun en 0,00 (estilo GNS).
          liquidationId: liquidacion.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
          concepto: 'IRPF', descripcion: 'IRPF',
          baseCalculo: baseBpsIrpf, rate: null, amount: irpfResult.retencionMensual,
          calculationDetail: Prisma.DbNull,
        },
      ] : []),
    ],
  });

  // Nota: la desvinculación de la persona (inactivar / fechaEgreso) la maneja
  // el endpoint de baja según si le quedan contratos vigentes en otras empresas.

  return {
    liquidacionId: liquidacion.id,
    indemnizacion,
    aguinaldoEgreso,
    licenciaNoGozada,
    salarioVacacionalEgreso,
    diasNoGozadas,
    totalBruto,
    totalDescuentos,
    liquidoPercibir,
    antiguedadAnios,
    antiguedadMeses,
    mesesIndemnizacion,
  };
}
