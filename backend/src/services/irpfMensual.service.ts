/**
 * IRPF MENSUAL ACUMULADO POR TRABAJADOR
 *
 * El IRPF (Cat. II) se calcula por TRABAJADOR y MES, no por recibo. Un trabajador
 * puede tener en el mismo mes varios recibos (mensual, salario vacacional,
 * liquidación final por egreso): si el IRPF se calculara de cada uno por separado
 * podría dar $0 en todos aunque, sumadas las partidas del mes, sí corresponda
 * retención. Este servicio:
 *   1. junta la renta gravada por IRPF de todos los recibos del mes (sueldo,
 *      comisiones, licencia no gozada, salario vacacional y demás partidas
 *      gravadas por IRPF — codBps 1 y 5), EXCLUYENDO el aguinaldo (tratamiento
 *      separado), la indemnización y las partidas no gravadas;
 *   2. calcula el IRPF total del mes UNA sola vez (proyección anual + franjas +
 *      deducciones sobre los aportes reales del mes);
 *   3. lo reparte PROPORCIONALMENTE entre los recibos según su renta gravada;
 *   4. al recibo de egreso le suma, además, el IRPF propio del aguinaldo por
 *      egreso (que mantiene su tratamiento separado);
 *   5. actualiza el ítem IRPF y los totales de cada recibo.
 * Se dispara automáticamente al generar/editar/recalcular/borrar cualquier recibo.
 */
import { LiquidationType, LiquidationStatus, ItemType, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { calcularIrpfMensual } from './irpf.service';
import { parametersService } from './parameters.service';

// Haberes que NO integran la base ORDINARIA de IRPF del mes.
const IRPF_EXENTO = new Set([
  'AGUINALDO',        // tratamiento separado (se suma aparte al recibo de egreso)
  'INDEMNIZACION',    // IPD por despido: exenta de IRPF
  'PREAVISO',         // no aplica en Uruguay
  'REINTEGRO_GASTOS', // no gravado
  'VIATICOS',         // no gravado (VIATICOS_GRAVADOS sí integra)
  'AJUSTE_NO_GRAVADO',
]);

type ItemLite = { concepto: string; itemType: ItemType; amount: bigint };
const sum = (items: ItemLite[], pred: (i: ItemLite) => boolean) =>
  items.filter(pred).reduce((s, i) => s + i.amount, 0n);

const TIPOS_IRPF = [LiquidationType.MENSUAL, LiquidationType.LICENCIA, LiquidationType.LIQUIDACION_FINAL];

export async function recalcularIrpfMensual(
  employeeId: string, year: number, month: number, companyId?: string,
): Promise<void> {
  const liqs = await prisma.liquidation.findMany({
    where: {
      employeeId, year, month,
      type: { in: TIPOS_IRPF },
      status: { not: LiquidationStatus.ANULADO },
      ...(companyId ? { period: { is: { companyId } } } : {}),
    },
    include: { items: true },
  });
  if (liqs.length === 0) return;

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return;
  const params = await parametersService.getPayrollParameters(new Date(year, month - 1, 1));

  // Renta IRPF por recibo + aportes deducibles del mes (los del sueldo; los de la
  // final son sobre el aguinaldo y NO integran la deducción ordinaria).
  let rentaTotal = 0n, dedJub = 0n, dedFonasa = 0n, dedFrl = 0n;
  const filas = liqs.map((l) => {
    const items = l.items as ItemLite[];
    const rentaIrpf = sum(items, (i) => i.itemType === ItemType.HABER && !IRPF_EXENTO.has(i.concepto));
    rentaTotal += rentaIrpf;
    if (l.type === LiquidationType.MENSUAL) {
      dedJub += sum(items, (i) => i.concepto === 'BPS_JUBILATORIO');
      dedFonasa += sum(items, (i) => i.concepto === 'FONASA' || i.concepto === 'FONASA_ADICIONAL');
      dedFrl += sum(items, (i) => i.concepto === 'FRL');
    }
    // IRPF propio del aguinaldo por egreso (tratamiento separado), recalculado
    // desde los ítems de ESTE recibo (aguinaldo + sus aportes).
    const aguinaldo = sum(items, (i) => i.itemType === ItemType.HABER && i.concepto === 'AGUINALDO');
    let irpfAguinaldo = 0n;
    if (aguinaldo > 0n) {
      irpfAguinaldo = calcularIrpfMensual({
        salarioNominal: aguinaldo,
        bpsMensual: sum(items, (i) => i.concepto === 'BPS_JUBILATORIO'),
        fonasaMensual: sum(items, (i) => i.concepto === 'FONASA' || i.concepto === 'FONASA_ADICIONAL'),
        frlMensual: sum(items, (i) => i.concepto === 'FRL'),
        hijosACargo: employee.hijosACargo,
        hijosDiscapacitados: employee.hijosDiscapacitados,
        conyugeACargo: employee.conyugeACargo,
        params,
      }).retencionMensual;
    }
    const irpfItem = l.items.find((i) => i.concepto === 'IRPF');
    return { liq: l, rentaIrpf, irpfAguinaldo, irpfItemId: irpfItem?.id ?? null, irpfActual: irpfItem?.amount ?? 0n };
  });

  // IRPF ordinario total del mes (una sola vez) sobre la renta acumulada.
  const irpfOrdinarioMes = rentaTotal > 0n
    ? calcularIrpfMensual({
        salarioNominal: rentaTotal,
        bpsMensual: dedJub, fonasaMensual: dedFonasa, frlMensual: dedFrl,
        hijosACargo: employee.hijosACargo,
        hijosDiscapacitados: employee.hijosDiscapacitados,
        conyugeACargo: employee.conyugeACargo,
        params,
      }).retencionMensual
    : 0n;

  // Reparto PROPORCIONAL por renta gravada, con el resto de redondeo al mayor.
  let asignado = 0n;
  const shares = filas.map((f) => {
    const share = rentaTotal > 0n ? (irpfOrdinarioMes * f.rentaIrpf) / rentaTotal : 0n;
    asignado += share;
    return share;
  });
  const resto = irpfOrdinarioMes - asignado;
  if (resto > 0n && filas.length > 0) {
    let idx = 0;
    for (let i = 1; i < filas.length; i++) if (filas[i].rentaIrpf > filas[idx].rentaIrpf) idx = i;
    shares[idx] += resto;
  }

  // Aplicar a cada recibo: IRPF = parte ordinaria + IRPF del aguinaldo propio.
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const nuevoIrpf = shares[i] + f.irpfAguinaldo;
    const detalle = {
      metodo: 'IRPF mensual acumulado (proporcional)',
      rentaMesIrpf: rentaTotal.toString(),
      irpfOrdinarioMes: irpfOrdinarioMes.toString(),
      rentaRecibo: f.rentaIrpf.toString(),
      parteOrdinaria: shares[i].toString(),
      irpfAguinaldo: f.irpfAguinaldo.toString(),
    } as unknown as Prisma.InputJsonValue;

    if (f.irpfItemId) {
      await prisma.payrollItem.update({
        where: { id: f.irpfItemId },
        data: { amount: nuevoIrpf, baseCalculo: f.rentaIrpf, calculationDetail: detalle },
      });
    } else {
      await prisma.payrollItem.create({
        data: {
          liquidationId: f.liq.id, employeeId, itemType: ItemType.DESCUENTO_OBRERO,
          concepto: 'IRPF', descripcion: 'IRPF', baseCalculo: f.rentaIrpf, rate: null,
          amount: nuevoIrpf, calculationDetail: detalle,
        },
      });
    }
    const delta = nuevoIrpf - f.irpfActual;
    if (delta !== 0n) {
      await prisma.liquidation.update({
        where: { id: f.liq.id },
        data: {
          totalDescuentos: f.liq.totalDescuentos + delta,
          liquidoPercibir: f.liq.liquidoPercibir - delta,
        },
      });
    }
  }
}
