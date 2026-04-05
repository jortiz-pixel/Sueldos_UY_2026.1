/**
 * SERVICIO DE GENERACIÓN DE EXCEL
 * Genera nóminas en formato XLSX.
 */

import * as XLSX from 'xlsx';
import { ItemType, LiquidationType, LiquidationStatus } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { toPesos } from '../utils/money';
import { AppError } from '../middleware/errorHandler';

const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export async function generateNominaExcel(
  companyId: string,
  year: number,
  month: number,
): Promise<Buffer> {
  const period = await prisma.payrollPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
    include: { company: true },
  });
  if (!period) throw new AppError(404, 'Período no encontrado');

  const liquidations = await prisma.liquidation.findMany({
    where: { periodId: period.id, type: LiquidationType.MENSUAL },
    include: { items: true },
  });

  const employeeIds = liquidations.map((l) => l.employeeId);
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true, ci: true, nombre: true, apellido: true, cargo: true, categoria: true },
  });
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const wb = XLSX.utils.book_new();

  // ── Hoja 1: Nómina completa ─────────────────────────────────
  const nominaData: (string | number)[][] = [
    [`NÓMINA MENSUAL — ${MESES[month]} ${year}`],
    [`Empresa: ${(period as any).company?.razonSocial ?? ''}`],
    [`Estado: ${period.status}`],
    [],
    [
      'CI', 'Apellido y Nombre', 'Cargo', 'Categoría',
      'Días Trab.', 'Total Haberes', 'BPS Jubilatorio', 'FONASA', 'FRL', 'IRPF',
      'Total Descuentos', 'Líquido Percibir', 'BPS IVS Patronal', 'FONASA Patronal', 'Total Patronal',
      'Estado Liq.',
    ],
  ];

  for (const liq of liquidations) {
    const emp = empMap.get(liq.employeeId);
    const getItem = (concepto: string) => toPesos(liq.items.find((i) => i.concepto === concepto)?.amount ?? 0n);

    nominaData.push([
      emp?.ci ?? '',
      emp ? `${emp.apellido}, ${emp.nombre}` : '',
      emp?.cargo ?? '',
      emp?.categoria ?? '',
      liq.diasTrabajados,
      toPesos(liq.totalHaberes),
      getItem('BPS_JUBILATORIO'),
      getItem('FONASA'),
      getItem('FRL'),
      getItem('IRPF'),
      toPesos(liq.totalDescuentos),
      toPesos(liq.liquidoPercibir),
      getItem('BPS_IVS_PATRONAL'),
      getItem('FONASA_PATRONAL'),
      toPesos(liq.totalPatronal),
      liq.status,
    ]);
  }

  // Totals row
  if (liquidations.length > 0) {
    nominaData.push([
      '', 'TOTALES', '', '',
      '',
      toPesos(liquidations.reduce((s, l) => s + l.totalHaberes, 0n)),
      '', '', '', '',
      toPesos(liquidations.reduce((s, l) => s + l.totalDescuentos, 0n)),
      toPesos(liquidations.reduce((s, l) => s + l.liquidoPercibir, 0n)),
      '', '',
      toPesos(liquidations.reduce((s, l) => s + l.totalPatronal, 0n)),
      '',
    ]);
  }

  const wsNomina = XLSX.utils.aoa_to_sheet(nominaData);
  wsNomina['!cols'] = [
    { width: 12 }, { width: 30 }, { width: 18 }, { width: 15 },
    { width: 10 }, { width: 14 }, { width: 16 }, { width: 12 }, { width: 10 }, { width: 12 },
    { width: 16 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsNomina, 'Nómina');

  // ── Hoja 2: BPS C1 ──────────────────────────────────────────
  const bpsData: (string | number)[][] = [
    [`DECLARACIÓN BPS (C1) — ${MESES[month]} ${year}`],
    [],
    ['CI', 'Nro BPS', 'Apellido y Nombre', 'Salario Nominal', 'Jubilatorio Obrero', 'FONASA Obrero', 'FRL Obrero', 'IVS Patronal', 'FONASA Patronal', 'FRL Patronal'],
  ];

  for (const liq of liquidations) {
    const emp = empMap.get(liq.employeeId);
    const getItem = (concepto: string) => toPesos(liq.items.find((i) => i.concepto === concepto)?.amount ?? 0n);
    const employee = await prisma.employee.findUnique({ where: { id: liq.employeeId }, select: { bpsNumero: true } });
    bpsData.push([
      emp?.ci ?? '',
      employee?.bpsNumero ?? '',
      emp ? `${emp.apellido}, ${emp.nombre}` : '',
      toPesos(liq.totalHaberes),
      getItem('BPS_JUBILATORIO'),
      getItem('FONASA'),
      getItem('FRL'),
      getItem('BPS_IVS_PATRONAL'),
      getItem('FONASA_PATRONAL'),
      getItem('FRL_PATRONAL'),
    ]);
  }

  const wsBps = XLSX.utils.aoa_to_sheet(bpsData);
  wsBps['!cols'] = [
    { width: 12 }, { width: 14 }, { width: 30 }, { width: 14 },
    { width: 16 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 16 }, { width: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsBps, 'BPS C1');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return buffer;
}
