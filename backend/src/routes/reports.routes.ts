import { Router, Request, Response, NextFunction } from 'express';
import { ItemType, LiquidationType, LiquidationStatus } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError } from '../middleware/errorHandler';
import { toPesos } from '../utils/money';
import { generateNominaExcel } from '../services/excel.service';

export const reportsRouter = Router();

// GET /api/reports/nomina-mensual?companyId=&year=&month=
reportsRouter.get('/nomina-mensual', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (isNaN(year) || isNaN(month)) throw new AppError(400, 'year y month requeridos');

    const period = await prisma.payrollPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });

    if (!period) {
      return res.json({ period: null, liquidations: [], summary: { totalHaberes: '0', totalDescuentos: '0', totalPatronal: '0', totalLiquidoPercibir: '0', empleados: 0 } });
    }

    const liquidations = await prisma.liquidation.findMany({
      where: { periodId: period.id, type: LiquidationType.MENSUAL },
      include: {
        items: true,
        adjustments: true,
      },
      orderBy: { employeeId: 'asc' },
    });

    // Enrich with employee data
    const employeeIds = liquidations.map((l) => l.employeeId);
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, ci: true, nombre: true, apellido: true, cargo: true, categoria: true },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const nomina = liquidations.map((l) => {
      const emp = empMap.get(l.employeeId);
      return {
        empleado: emp,
        liquidacion: {
          id: l.id,
          status: l.status,
          diasTrabajados: l.diasTrabajados,
          totalHaberes: l.totalHaberes.toString(),
          totalDescuentos: l.totalDescuentos.toString(),
          totalPatronal: l.totalPatronal.toString(),
          liquidoPercibir: l.liquidoPercibir.toString(),
        },
        haberes: l.items
          .filter((i) => i.itemType === ItemType.HABER)
          .map((i) => ({ concepto: i.concepto, descripcion: i.descripcion, amount: i.amount.toString() })),
        descuentos: l.items
          .filter((i) => i.itemType === ItemType.DESCUENTO_OBRERO)
          .map((i) => ({ concepto: i.concepto, descripcion: i.descripcion, amount: i.amount.toString() })),
        patronal: l.items
          .filter((i) => i.itemType === ItemType.APORTE_PATRONAL)
          .map((i) => ({ concepto: i.concepto, descripcion: i.descripcion, amount: i.amount.toString() })),
      };
    });

    const summary = {
      totalHaberes: liquidations.reduce((s, l) => s + l.totalHaberes, 0n).toString(),
      totalDescuentos: liquidations.reduce((s, l) => s + l.totalDescuentos, 0n).toString(),
      totalPatronal: liquidations.reduce((s, l) => s + l.totalPatronal, 0n).toString(),
      totalLiquidoPercibir: liquidations.reduce((s, l) => s + l.liquidoPercibir, 0n).toString(),
      empleados: liquidations.length,
    };

    res.json({ period, nomina, summary });
  } catch (err) { next(err); }
});

// GET /api/reports/bps-nomina?companyId=&year=&month= — Datos para declaración BPS (C1)
reportsRouter.get('/bps-nomina', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (isNaN(year) || isNaN(month)) throw new AppError(400, 'year y month requeridos');

    const period = await prisma.payrollPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
    });
    if (!period) return res.json({ bpsData: [], totals: {} });

    const liquidations = await prisma.liquidation.findMany({
      where: { periodId: period.id, type: LiquidationType.MENSUAL, status: LiquidationStatus.CONFIRMADO },
      include: {
        items: {
          where: { concepto: { in: ['BPS_JUBILATORIO', 'FONASA', 'FRL', 'BPS_IVS_PATRONAL', 'FONASA_PATRONAL', 'FRL_PATRONAL', 'BSE'] } },
        },
      },
    });

    const employeeIds = liquidations.map((l) => l.employeeId);
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, ci: true, nombre: true, apellido: true, bpsNumero: true },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const bpsData = liquidations.map((l) => {
      const emp = empMap.get(l.employeeId);
      const getItem = (concepto: string) => l.items.find((i) => i.concepto === concepto)?.amount ?? 0n;
      return {
        ci: emp?.ci,
        nombre: emp ? `${emp.apellido} ${emp.nombre}` : '',
        bpsNumero: emp?.bpsNumero,
        salarioNominal: l.totalHaberes.toString(),
        jubilatorioObrero: getItem('BPS_JUBILATORIO').toString(),
        fonasaObrero: getItem('FONASA').toString(),
        frlObrero: getItem('FRL').toString(),
        ivsPatronal: getItem('BPS_IVS_PATRONAL').toString(),
        fonasaPatronal: getItem('FONASA_PATRONAL').toString(),
        frlPatronal: getItem('FRL_PATRONAL').toString(),
        bse: getItem('BSE').toString(),
        totalObrero: (getItem('BPS_JUBILATORIO') + getItem('FONASA') + getItem('FRL')).toString(),
        totalPatronal: (getItem('BPS_IVS_PATRONAL') + getItem('FONASA_PATRONAL') + getItem('FRL_PATRONAL') + getItem('BSE')).toString(),
      };
    });

    const totals = bpsData.reduce((acc, row) => ({
      salarioNominal: (BigInt(acc.salarioNominal) + BigInt(row.salarioNominal)).toString(),
      jubilatorioObrero: (BigInt(acc.jubilatorioObrero) + BigInt(row.jubilatorioObrero)).toString(),
      fonasaObrero: (BigInt(acc.fonasaObrero) + BigInt(row.fonasaObrero)).toString(),
      ivsPatronal: (BigInt(acc.ivsPatronal) + BigInt(row.ivsPatronal)).toString(),
      fonasaPatronal: (BigInt(acc.fonasaPatronal) + BigInt(row.fonasaPatronal)).toString(),
    }), { salarioNominal: '0', jubilatorioObrero: '0', fonasaObrero: '0', ivsPatronal: '0', fonasaPatronal: '0' });

    res.json({ period, bpsData, totals });
  } catch (err) { next(err); }
});

// GET /api/reports/irpf-summary?companyId=&year= — Resumen IRPF anual
reportsRouter.get('/irpf-summary', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const year = parseInt(req.query.year as string || String(new Date().getFullYear()));

    const items = await prisma.payrollItem.findMany({
      where: {
        concepto: 'IRPF',
        employee: { companyId },
        liquidation: {
          year,
          status: LiquidationStatus.CONFIRMADO,
        },
      },
      include: {
        employee: { select: { ci: true, nombre: true, apellido: true } },
        liquidation: { select: { month: true, type: true } },
      },
    });

    // Group by employee
    const byEmployee = new Map<string, { employee: typeof items[0]['employee']; months: Record<number, bigint>; total: bigint }>();

    for (const item of items) {
      const key = item.employeeId;
      if (!byEmployee.has(key)) {
        byEmployee.set(key, { employee: item.employee, months: {}, total: 0n });
      }
      const entry = byEmployee.get(key)!;
      const month = item.liquidation.month;
      entry.months[month] = (entry.months[month] ?? 0n) + item.amount;
      entry.total += item.amount;
    }

    const summary = Array.from(byEmployee.values()).map((entry) => ({
      ci: entry.employee.ci,
      nombre: `${entry.employee.apellido} ${entry.employee.nombre}`,
      retencionesMensuales: entry.months,
      totalAnual: entry.total.toString(),
      totalAnualPesos: toPesos(entry.total),
    }));

    const totalRetenido = items.reduce((s, i) => s + i.amount, 0n);

    res.json({
      year,
      summary,
      totalRetenido: totalRetenido.toString(),
      totalRetenidoPesos: toPesos(totalRetenido),
    });
  } catch (err) { next(err); }
});

// GET /api/reports/nomina-excel?companyId=&year=&month= — Excel export
reportsRouter.get('/nomina-excel', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);

    const buffer = await generateNominaExcel(companyId, year, month);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="nomina_${year}_${String(month).padStart(2, '0')}.xlsx"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────
// Helpers de agregación por período (liquidaciones CONFIRMADAS de
// TODOS los tipos: mensual + aguinaldo + licencia + final).
// ───────────────────────────────────────────────────────────────────
async function liquidacionesConfirmadas(companyId: string, year: number, month: number) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
  });
  if (!period) return { period: null, liqs: [] as Awaited<ReturnType<typeof prisma.liquidation.findMany>> };
  const liqs = await prisma.liquidation.findMany({
    where: { periodId: period.id, status: LiquidationStatus.CONFIRMADO },
    include: { items: true },
  });
  return { period, liqs };
}

type LiqConItems = { items: { itemType: ItemType; concepto: string; amount: bigint }[]; liquidoPercibir: bigint; totalHaberes: bigint };

function resumenPagos(liqs: LiqConItems[]) {
  const suma = (pred: (i: { itemType: ItemType; concepto: string }) => boolean) =>
    liqs.reduce((s, l) => s + l.items.filter(pred).reduce((x, i) => x + i.amount, 0n), 0n);

  const liquidos = liqs.reduce((s, l) => s + l.liquidoPercibir, 0n);
  const obreroJubilatorio = suma((i) => i.itemType === ItemType.DESCUENTO_OBRERO && i.concepto === 'BPS_JUBILATORIO');
  const obreroFonasa = suma((i) => i.itemType === ItemType.DESCUENTO_OBRERO && i.concepto === 'FONASA');
  const obreroFrl = suma((i) => i.itemType === ItemType.DESCUENTO_OBRERO && i.concepto === 'FRL');
  const irpf = suma((i) => i.itemType === ItemType.DESCUENTO_OBRERO && i.concepto === 'IRPF');
  const otrasRetenciones = suma((i) => i.itemType === ItemType.DESCUENTO_OBRERO
    && !['BPS_JUBILATORIO', 'FONASA', 'FRL', 'IRPF'].includes(i.concepto));

  const patronalJubilatorio = suma((i) => i.itemType === ItemType.APORTE_PATRONAL && i.concepto === 'BPS_IVS_PATRONAL');
  const patronalFonasa = suma((i) => i.itemType === ItemType.APORTE_PATRONAL && i.concepto === 'FONASA_PATRONAL');
  const patronalFrl = suma((i) => i.itemType === ItemType.APORTE_PATRONAL && i.concepto === 'FRL_PATRONAL');
  const bse = suma((i) => i.itemType === ItemType.APORTE_PATRONAL && i.concepto === 'BSE');

  const bpsObrero = obreroJubilatorio + obreroFonasa + obreroFrl;
  const bpsPatronal = patronalJubilatorio + patronalFonasa + patronalFrl;
  const totalBps = bpsObrero + bpsPatronal;
  const totalDesembolso = liquidos + totalBps + irpf + bse;

  const str = (v: bigint) => v.toString();
  return {
    liquidos: str(liquidos),
    bps: {
      obrero: { jubilatorio: str(obreroJubilatorio), fonasa: str(obreroFonasa), frl: str(obreroFrl), total: str(bpsObrero) },
      patronal: { jubilatorio: str(patronalJubilatorio), fonasa: str(patronalFonasa), frl: str(patronalFrl), total: str(bpsPatronal) },
      total: str(totalBps),
    },
    irpf: str(irpf),
    bse: str(bse),
    otrasRetenciones: str(otrasRetenciones),
    totalDesembolso: str(totalDesembolso),
    empleados: new Set((liqs as Array<LiqConItems & { employeeId?: string }>).map((l) => l.employeeId)).size,
  };
}

// GET /api/reports/pagos-mes?companyId=&year=&month=
// "¿Cuánto pago este mes y a quién?": líquidos + BPS + DGI + BSE, con
// comparativo contra el mes anterior.
reportsRouter.get('/pagos-mes', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (isNaN(year) || isNaN(month)) throw new AppError(400, 'year y month requeridos');

    const { period, liqs } = await liquidacionesConfirmadas(companyId, year, month);
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const { liqs: liqsPrev } = await liquidacionesConfirmadas(companyId, prevYear, prevMonth);

    res.json({
      period: period ? { year, month, status: period.status } : null,
      actual: resumenPagos(liqs as unknown as LiqConItems[]),
      anterior: { year: prevYear, month: prevMonth, ...resumenPagos(liqsPrev as unknown as LiqConItems[]) },
      liquidacionesConfirmadas: liqs.length,
    });
  } catch (err) { next(err); }
});

// GET /api/reports/costo-personal?companyId=&year=&month=
// Costo total de cada empleado: haberes + aportes patronales + provisiones
// (aguinaldo 8,33% del gravado, patronal s/aguinaldo, salario vacacional).
reportsRouter.get('/costo-personal', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = (req.query.companyId as string) || req.user!.companyId;
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (isNaN(year) || isNaN(month)) throw new AppError(400, 'year y month requeridos');

    const { period, liqs } = await liquidacionesConfirmadas(companyId, year, month);
    if (!period) return res.json({ period: null, filas: [], totales: null });

    const employeeIds = [...new Set(liqs.map((l) => l.employeeId))];
    const employees = await prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, ci: true, nombre: true, apellido: true, cargo: true },
    });
    const empMap = new Map(employees.map((e) => [e.id, e]));

    const filas = employeeIds.map((empId) => {
      const liqsEmp = liqs.filter((l) => l.employeeId === empId);
      const items = liqsEmp.flatMap((l) => l.items);
      const haberes = liqsEmp.reduce((s, l) => s + l.totalHaberes, 0n);
      const liquido = liqsEmp.reduce((s, l) => s + l.liquidoPercibir, 0n);
      const patronales = items
        .filter((i) => i.itemType === ItemType.APORTE_PATRONAL)
        .reduce((s, i) => s + i.amount, 0n);

      // Base gravada CESS del mes (la de los aportes jubilatorios).
      const gravado = items
        .filter((i) => i.itemType === ItemType.DESCUENTO_OBRERO && i.concepto === 'BPS_JUBILATORIO')
        .reduce((s, i) => s + (i.baseCalculo ?? 0n), 0n);

      // Provisiones mensuales (criterio GNS "Costo de empleado"):
      //  - Aguinaldo: 8,33% del gravado (1/12).
      //  - Aporte patronal s/aguinaldo: jubilatorio 7,5% + FRL 0,1% (el aguinaldo
      //    no genera FONASA patronal).
      //  - Salario vacacional: 4,45% (jornal líquido de licencia, 20 días/año).
      const provAguinaldo = gravado / 12n;
      const provPatronalAguinaldo = (provAguinaldo * 760n) / 10000n;
      const provSalarioVacacional = (gravado * 445n) / 10000n;

      const costoTotal = haberes + patronales + provAguinaldo + provPatronalAguinaldo + provSalarioVacacional;
      const e = empMap.get(empId);
      return {
        empleado: e ? { id: e.id, ci: e.ci, nombre: e.nombre, apellido: e.apellido, cargo: e.cargo } : null,
        haberes: haberes.toString(),
        liquido: liquido.toString(),
        patronales: patronales.toString(),
        provisiones: {
          aguinaldo: provAguinaldo.toString(),
          patronalAguinaldo: provPatronalAguinaldo.toString(),
          salarioVacacional: provSalarioVacacional.toString(),
        },
        costoTotal: costoTotal.toString(),
      };
    }).sort((a, b) => (a.empleado?.apellido ?? '').localeCompare(b.empleado?.apellido ?? ''));

    const sum = (fn: (f: typeof filas[number]) => string) =>
      filas.reduce((s, f) => s + BigInt(fn(f)), 0n).toString();

    res.json({
      period: { year, month, status: period.status },
      filas,
      totales: {
        haberes: sum((f) => f.haberes),
        liquido: sum((f) => f.liquido),
        patronales: sum((f) => f.patronales),
        provisiones: sum((f) => (BigInt(f.provisiones.aguinaldo) + BigInt(f.provisiones.patronalAguinaldo) + BigInt(f.provisiones.salarioVacacional)).toString()),
        costoTotal: sum((f) => f.costoTotal),
      },
    });
  } catch (err) { next(err); }
});
