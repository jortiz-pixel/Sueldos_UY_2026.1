/**
 * PLANILLA DE PAGOS AL BANCO + ASIENTO CONTABLE
 *
 * - Planilla de pagos: líquidos a acreditar por persona en el período
 *   (liquidaciones CONFIRMADAS), con los datos bancarios de la ficha.
 *   Formatos: Excel genérico (aceptado por la mayoría de los bancos),
 *   CSV multipago estilo BROU y CSV genérico. El líquido se redondea al
 *   peso entero (mismo criterio que el recibo).
 * - Asiento contable: resumen Debe/Haber del devengamiento del período,
 *   agregado desde los ítems reales de las liquidaciones. Siempre balancea:
 *   retribuciones + cargas patronales = líquidos + retenciones + cargas a pagar.
 */
import * as XLSX from 'xlsx';
import { ItemType, LiquidationStatus, LiquidationType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';

// ─────────────────────────── Planilla de pagos ───────────────────────────

export interface FilaPago {
  employeeId: string;
  legajo: number | null;
  ci: string;
  nombre: string;          // "Apellido, Nombre"
  banco: string;
  sucursal: string;
  cuenta: string;
  moneda: string;
  liquidoPesos: number;    // redondeado al peso entero
  liquidaciones: number;   // cuántas liquidaciones suma (mensual, aguinaldo, etc.)
  sinCuenta: boolean;
}

export async function planillaPagos(companyId: string, year: number, month: number): Promise<{
  filas: FilaPago[];
  totalPesos: number;
  confirmadas: number;
  avisos: string[];
}> {
  const period = await prisma.payrollPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
  });
  if (!period) throw new AppError(404, 'No existe el período para esa empresa y mes');

  const liqs = await prisma.liquidation.findMany({
    where: { periodId: period.id, status: LiquidationStatus.CONFIRMADO },
    include: { employee: { select: { id: true, employeeNumber: true, ci: true, nombre: true, apellido: true, banco: true, bancoSucursal: true, bancoCuenta: true, bancoMoneda: true } } },
  });

  const porPersona = new Map<string, FilaPago & { liquidoCent: bigint }>();
  for (const l of liqs) {
    const e = l.employee;
    const row = porPersona.get(e.id) ?? {
      employeeId: e.id,
      legajo: e.employeeNumber ?? null,
      ci: e.ci,
      nombre: `${e.apellido}, ${e.nombre}`,
      banco: e.banco ?? '',
      sucursal: e.bancoSucursal ?? '',
      cuenta: e.bancoCuenta ?? '',
      moneda: e.bancoMoneda || 'UYU',
      liquidoPesos: 0,
      liquidaciones: 0,
      sinCuenta: !e.bancoCuenta,
      liquidoCent: 0n,
    };
    row.liquidoCent += l.liquidoPercibir;
    row.liquidaciones++;
    porPersona.set(e.id, row);
  }

  const filas = Array.from(porPersona.values())
    .map((r) => ({ ...r, liquidoPesos: Math.round(Number(r.liquidoCent) / 100) }))
    .filter((r) => r.liquidoPesos > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const avisos: string[] = [];
  const sinCuenta = filas.filter((f) => f.sinCuenta);
  if (sinCuenta.length) {
    avisos.push(`${sinCuenta.length} persona(s) sin cuenta bancaria cargada (${sinCuenta.slice(0, 4).map((f) => f.nombre).join(' · ')}${sinCuenta.length > 4 ? '…' : ''}). Cargala en la ficha de la persona.`);
  }
  if (!liqs.length) avisos.push('El período no tiene liquidaciones confirmadas: la planilla sale vacía. Confirmá las liquidaciones primero.');

  return {
    filas: filas.map(({ liquidoCent: _lc, ...rest }) => rest),
    totalPesos: filas.reduce((s, f) => s + f.liquidoPesos, 0),
    confirmadas: liqs.length,
    avisos,
  };
}

/** Excel genérico: lo aceptan la mayoría de los bancos como planilla de pagos. */
export function planillaPagosXlsx(filas: FilaPago[], empresa: string, year: number, month: number): Buffer {
  const data = [
    [`Planilla de pagos de sueldos — ${empresa} — ${String(month).padStart(2, '0')}/${year}`],
    [],
    ['Legajo', 'Cédula', 'Apellido y nombre', 'Banco', 'Sucursal', 'Nº de cuenta', 'Moneda', 'Importe'],
    ...filas.map((f) => [f.legajo ?? '', f.ci, f.nombre, f.banco, f.sucursal, f.cuenta, f.moneda, f.liquidoPesos]),
    [],
    ['', '', '', '', '', '', 'TOTAL', filas.reduce((s, f) => s + f.liquidoPesos, 0)],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 32 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 8 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pagos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * CSV multipago estilo BROU (pago de haberes): una línea por crédito con
 * cuenta;moneda;importe;documento;nombre;referencia. Si el banco exige un
 * layout exacto, se ajusta contra la plantilla real (como la nómina BPS).
 */
export function planillaPagosBrou(filas: FilaPago[], year: number, month: number): string {
  const ref = `SUELDOS ${String(month).padStart(2, '0')}${year}`;
  const lineas = filas
    .filter((f) => f.cuenta)
    .map((f) => [
      f.cuenta.replace(/[^0-9]/g, ''),
      f.moneda === 'USD' ? 'USD' : 'UYU',
      f.liquidoPesos.toFixed(2),
      f.ci.replace(/[^0-9]/g, ''),
      f.nombre.toUpperCase().slice(0, 40),
      ref,
    ].join(';'));
  return lineas.join('\r\n') + '\r\n';
}

/** CSV genérico (separado por ;) con encabezados. */
export function planillaPagosCsv(filas: FilaPago[]): string {
  const head = 'legajo;cedula;nombre;banco;sucursal;cuenta;moneda;importe';
  const lineas = filas.map((f) =>
    [f.legajo ?? '', f.ci, `"${f.nombre}"`, f.banco, f.sucursal, f.cuenta, f.moneda, f.liquidoPesos.toFixed(2)].join(';'));
  return [head, ...lineas].join('\r\n') + '\r\n';
}

// ─────────────────────────── Asiento contable ───────────────────────────

export interface LineaAsiento {
  cuenta: string;
  debe: string;   // centésimos como string (BigInt serializado)
  haber: string;
}

const CERO = 0n;

export async function asientoContable(companyId: string, year: number, month: number): Promise<{
  lineas: LineaAsiento[];
  totalDebe: string;
  totalHaber: string;
  balanceado: boolean;
  liquidaciones: number;
}> {
  const period = await prisma.payrollPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
  });
  if (!period) throw new AppError(404, 'No existe el período para esa empresa y mes');

  const liqs = await prisma.liquidation.findMany({
    where: { periodId: period.id, status: LiquidationStatus.CONFIRMADO },
    include: { items: true },
  });

  // ── DEBE (pérdidas/devengamientos) ──
  let sueldos = CERO;        // haberes de mensuales (ya netos de faltas)
  let aguinaldo = CERO;      // aguinaldos + aguinaldo por egreso
  let licencias = CERO;      // salario vacacional + licencia no gozada (finales y especiales)
  let ipd = CERO;            // indemnización por despido
  let patronalBps = CERO;    // IVS + FONASA + FRL patronales
  let patronalBse = CERO;

  // ── HABER (pasivos) ──
  let liquidos = CERO;       // remuneraciones a pagar
  let bpsObrero = CERO;      // jubilatorio + FONASA + adicional + FRL retenidos
  let irpf = CERO;
  let otrasRet = CERO;       // adelantos y otros descuentos manuales

  for (const l of liqs) {
    liquidos += l.liquidoPercibir;
    for (const it of l.items) {
      if (it.itemType === ItemType.HABER) {
        if (it.concepto.startsWith('AGUINALDO')) aguinaldo += it.amount;
        else if (it.concepto === 'SALARIO_VACACIONAL' || it.concepto === 'LICENCIA_NO_GOZADA') licencias += it.amount;
        else if (it.concepto === 'INDEMNIZACION') ipd += it.amount;
        else sueldos += it.amount; // incluye FALTAS (negativo), licencia gozada, HE, comisiones, etc.
      } else if (it.itemType === ItemType.DESCUENTO_OBRERO) {
        if (['BPS_JUBILATORIO', 'FONASA', 'FONASA_ADICIONAL', 'FRL'].includes(it.concepto)) bpsObrero += it.amount;
        else if (it.concepto === 'IRPF') irpf += it.amount;
        else otrasRet += it.amount;
      } else if (it.itemType === ItemType.APORTE_PATRONAL) {
        if (it.concepto === 'BSE') patronalBse += it.amount;
        else patronalBps += it.amount;
      }
    }
  }

  const lineas: LineaAsiento[] = [];
  const push = (cuenta: string, debe: bigint, haber: bigint) => {
    if (debe !== CERO || haber !== CERO) lineas.push({ cuenta, debe: debe.toString(), haber: haber.toString() });
  };

  // Debe
  push('Sueldos y jornales', sueldos, CERO);
  push('Aguinaldo', aguinaldo, CERO);
  push('Licencias y salario vacacional', licencias, CERO);
  push('Indemnizaciones por despido (IPD)', ipd, CERO);
  push('Cargas sociales patronales — BPS', patronalBps, CERO);
  push('Cargas sociales — BSE', patronalBse, CERO);
  // Haber
  push('Remuneraciones a pagar', CERO, liquidos);
  push('BPS a pagar (aportes obreros retenidos)', CERO, bpsObrero);
  push('BPS a pagar (aportes patronales)', CERO, patronalBps);
  push('BSE a pagar', CERO, patronalBse);
  push('IRPF a pagar (retenciones)', CERO, irpf);
  push('Otras retenciones a pagar', CERO, otrasRet);

  const totalDebe = lineas.reduce((s, x) => s + BigInt(x.debe), CERO);
  const totalHaber = lineas.reduce((s, x) => s + BigInt(x.haber), CERO);

  return {
    lineas,
    totalDebe: totalDebe.toString(),
    totalHaber: totalHaber.toString(),
    balanceado: totalDebe === totalHaber,
    liquidaciones: liqs.length,
  };
}

export function asientoXlsx(
  lineas: LineaAsiento[], totalDebe: string, totalHaber: string,
  empresa: string, year: number, month: number,
): Buffer {
  const p = (v: string) => Number(BigInt(v)) / 100;
  const data = [
    [`Asiento contable de sueldos — ${empresa} — ${String(month).padStart(2, '0')}/${year}`],
    [],
    ['Cuenta', 'Debe', 'Haber'],
    ...lineas.map((l) => [l.cuenta, p(l.debe) || '', p(l.haber) || '']),
    ['TOTALES', p(totalDebe), p(totalHaber)],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 42 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asiento');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
