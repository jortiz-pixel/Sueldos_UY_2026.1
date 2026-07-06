/**
 * GENERADOR DE DATOS DEMO
 *
 * Crea (o completa) la empresa Demo con un plantel de prueba realista:
 * personas mensuales y jornaleras, con distintas cargas FONASA (seguro de
 * salud), faltas, horas extra, licencia gozada + salario vacacional, y
 * EGRESOS a mitad de mes con las tres causales típicas (voluntario, despido,
 * término de contrato). Genera las liquidaciones de Ene–Jun 2026 usando el
 * MISMO motor que producción (nada calculado a mano), así sirve para validar
 * los cálculos contra la normativa.
 *
 * Idempotente: reejecutar no duplica personas (busca por CI en la empresa) y
 * las liquidaciones se regeneran (upsert por período+persona+tipo).
 */
import { SalaryType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { generarLiquidacionMensual, confirmarLiquidacion } from './liquidation.service';
import { calcularAguinaldo } from './aguinaldo.service';
import { calcularLiquidacionLicencia, calcularLiquidacionFinal } from './vacation.service';

interface PersonaDemo {
  ci: string;
  nombre: string;
  apellido: string;
  salaryType: SalaryType;
  salarioNominal: bigint;      // centésimos (mensual) — para jornaleros: jornal × 30
  jornal?: bigint;             // centésimos por día (solo jornaleros)
  seguroSalud: number;         // Tabla 8: 15 sin cargas · 1 hijos · 17 cónyuge · 16 ambos
  hijosACargo: number;
  conyugeACargo: boolean;
  fechaIngreso: string;        // ISO
  cargo: string;
  cuenta?: string;             // cuenta de sueldos / centro de costos
  // Situaciones especiales
  faltasFeb?: number;          // cantidad de faltas en febrero
  horasExtraMar?: number;      // horas extra diurnas en marzo
  licenciaMar?: number;        // días de licencia gozada en marzo (+ salario vacacional)
  egreso?: { dia: number; causal: number }; // egreso en junio 2026
}

const PLANTEL: PersonaDemo[] = [
  { ci: '3456789-1', nombre: 'Lucía', apellido: 'Fernández', salaryType: 'MENSUAL', salarioNominal: 3200000n, seguroSalud: 15, hijosACargo: 0, conyugeACargo: false, fechaIngreso: '2024-02-01', cargo: 'Administrativa', cuenta: 'Administración' },
  { ci: '3567891-2', nombre: 'Marcos', apellido: 'Píriz', salaryType: 'MENSUAL', salarioNominal: 4500000n, seguroSalud: 1, hijosACargo: 2, conyugeACargo: false, fechaIngreso: '2023-08-15', cargo: 'Vendedor', cuenta: 'Ventas' },
  { ci: '3678912-3', nombre: 'Sofía', apellido: 'Cabrera', salaryType: 'MENSUAL', salarioNominal: 5800000n, seguroSalud: 16, hijosACargo: 1, conyugeACargo: true, fechaIngreso: '2022-05-02', cargo: 'Contadora', cuenta: 'Administración', licenciaMar: 10 },
  { ci: '3789123-4', nombre: 'Diego', apellido: 'Núñez', salaryType: 'MENSUAL', salarioNominal: 7500000n, seguroSalud: 17, hijosACargo: 0, conyugeACargo: true, fechaIngreso: '2024-11-01', cargo: 'Técnico', cuenta: 'Producción', horasExtraMar: 8 },
  { ci: '3891234-5', nombre: 'Valentina', apellido: 'Silva', salaryType: 'MENSUAL', salarioNominal: 12000000n, seguroSalud: 15, hijosACargo: 0, conyugeACargo: false, fechaIngreso: '2021-03-01', cargo: 'Gerenta', cuenta: 'Administración' },
  { ci: '3912345-6', nombre: 'Rodrigo', apellido: 'Techera', salaryType: 'MENSUAL', salarioNominal: 2800000n, seguroSalud: 15, hijosACargo: 0, conyugeACargo: false, fechaIngreso: '2025-01-10', cargo: 'Auxiliar', cuenta: 'Producción', faltasFeb: 2 },
  { ci: '4123456-7', nombre: 'Camila', apellido: 'Olivera', salaryType: 'JORNALERO', salarioNominal: 4500000n, jornal: 150000n, seguroSalud: 1, hijosACargo: 1, conyugeACargo: false, fechaIngreso: '2024-06-01', cargo: 'Operaria', cuenta: 'Producción' },
  { ci: '4234567-8', nombre: 'Andrés', apellido: 'Morales', salaryType: 'MENSUAL', salarioNominal: 5000000n, seguroSalud: 15, hijosACargo: 0, conyugeACargo: false, fechaIngreso: '2024-04-01', cargo: 'Chofer', cuenta: 'Ventas', egreso: { dia: 15, causal: 1 } },
  { ci: '4345678-9', nombre: 'Paula', apellido: 'Giménez', salaryType: 'MENSUAL', salarioNominal: 6500000n, seguroSalud: 16, hijosACargo: 1, conyugeACargo: true, fechaIngreso: '2023-03-10', cargo: 'Analista', cuenta: 'Ventas', egreso: { dia: 20, causal: 2 } },
  { ci: '4456789-0', nombre: 'Federico', apellido: 'Acosta', salaryType: 'JORNALERO', salarioNominal: 5400000n, jornal: 180000n, seguroSalud: 15, hijosACargo: 0, conyugeACargo: false, fechaIngreso: '2025-07-01', cargo: 'Peón', cuenta: 'Producción', egreso: { dia: 10, causal: 4 } },
];

const YEAR = 2026;

export async function seedDemoData(userId: string): Promise<{
  empresa: string;
  personasCreadas: number;
  personasExistentes: number;
  liquidacionesGeneradas: number;
  aguinaldos: number;
  finales: number;
  errores: string[];
}> {
  // 1) Empresa Demo (la del seed inicial, o se crea si no está).
  let company = await prisma.company.findFirst({
    where: { OR: [{ rut: '219876543210' }, { razonSocial: { contains: 'Demo', mode: 'insensitive' } }] },
  });
  if (!company) {
    company = await prisma.company.create({
      data: {
        rut: '219876543210', razonSocial: 'Empresa Demo S.A.', nombreFantasia: 'Demo Corp',
        domicilio: 'Av. 18 de Julio 1234', localidad: 'Montevideo', departamento: 'Montevideo',
        email: 'demo@empresa.uy', numeroBps: '9999999', tipoAporte: 1, grupoActividadNum: 10,
      },
    });
  }

  const errores: string[] = [];
  let personasCreadas = 0;
  let personasExistentes = 0;
  let liquidaciones = 0;
  let aguinaldos = 0;
  let finales = 0;

  // 2) Períodos Ene–Jun 2026.
  const periodos = new Map<number, string>();
  for (let m = 1; m <= 6; m++) {
    const p = await prisma.payrollPeriod.upsert({
      where: { companyId_year_month: { companyId: company.id, year: YEAR, month: m } },
      create: { companyId: company.id, year: YEAR, month: m },
      update: {},
    });
    periodos.set(m, p.id);
  }

  // 3) Personas + contratos.
  const maxEN = await prisma.employee.aggregate({ where: { companyId: company.id }, _max: { employeeNumber: true } });
  let nextEN = (maxEN._max.employeeNumber ?? 0) + 1;

  const ids = new Map<string, string>(); // ci → employeeId
  for (const p of PLANTEL) {
    let emp = await prisma.employee.findFirst({ where: { companyId: company.id, ci: p.ci } });
    if (emp) {
      personasExistentes++;
    } else {
      emp = await prisma.employee.create({
        data: {
          companyId: company.id,
          employeeNumber: nextEN++,
          ci: p.ci,
          nombre: p.nombre,
          apellido: p.apellido,
          fechaIngreso: new Date(p.fechaIngreso),
          salaryType: p.salaryType,
          salarioNominal: p.salarioNominal,
          jornal: p.jornal ?? null,
          cargo: p.cargo,
          hijosACargo: p.hijosACargo,
          conyugeACargo: p.conyugeACargo,
          // Datos bancarios de ejemplo para la planilla de pagos.
          banco: 'BROU',
          bancoSucursal: 'eBrou',
          bancoCuenta: `00170${p.ci.replace(/[^0-9]/g, '').slice(0, 6)}-00001`,
          bancoMoneda: 'UYU',
          active: true,
        },
      });
      personasCreadas++;
    }
    ids.set(p.ci, emp.id);

    const contrato = await prisma.contrato.findFirst({ where: { employeeId: emp.id, companyId: company.id } });
    if (!contrato) {
      await prisma.contrato.create({
        data: {
          employeeId: emp.id, companyId: company.id, numero: 1,
          vigenciaDesde: new Date(p.fechaIngreso), fechaIngreso: new Date(p.fechaIngreso),
          cargo: p.cargo, salaryType: p.salaryType,
          salarioNominal: p.salarioNominal, jornal: p.jornal ?? null,
          vinculoFuncional: 12, seguroSalud: p.seguroSalud, cuentaSueldos: p.cuenta,
          computosEspeciales: 99, exoneracionAporte: 9, acumulacionLaboral: 1,
          horasSemanales: 44, moneda: 'UYU',
        },
      });
    }
  }

  // 4) Mensuales Ene–May (confirmadas, para que el aguinaldo de junio tenga base).
  for (const p of PLANTEL) {
    const employeeId = ids.get(p.ci)!;
    for (let m = 1; m <= 5; m++) {
      // El motor liquida solo si el contrato solapa el mes (altas posteriores quedan afuera).
      try {
        const valorFalta = p.salaryType === 'MENSUAL'
          ? Number(p.salarioNominal) / 30
          : Number(p.jornal ?? 0n);
        const result = await generarLiquidacionMensual({
          employeeId,
          periodId: periodos.get(m)!,
          year: YEAR,
          month: m,
          // Situaciones especiales:
          ...(m === 2 && p.faltasFeb ? {
            otrosDescuentos: [{
              concepto: 'FALTAS',
              descripcion: `Faltas ${p.faltasFeb} x ${(valorFalta / 100).toFixed(2)}`,
              amount: BigInt(Math.round(valorFalta * p.faltasFeb)),
            }],
          } : {}),
          ...(m === 3 && p.horasExtraMar ? { horasExtraDiurnas: p.horasExtraMar } : {}),
          ...(m === 3 && p.licenciaMar ? { diasLicencia: p.licenciaMar } : {}),
          userId,
        });
        await confirmarLiquidacion(result.liquidacionId, userId);
        liquidaciones++;

        // Salario vacacional aparte, el mes de la licencia gozada.
        if (m === 3 && p.licenciaMar) {
          await calcularLiquidacionLicencia({
            employeeId, periodId: periodos.get(3)!, year: YEAR, month: 3,
            diasHabilesTomar: p.licenciaMar, anticipar: true,
          });
          liquidaciones++;
        }
      } catch (e) {
        const msg = (e as Error).message;
        // Contrato que no solapa el mes: esperable para altas posteriores.
        if (!msg.includes('contrato vigente')) errores.push(`${p.apellido} ${m}/2026: ${msg}`);
      }
    }
  }

  // 5) Junio: egresos a mitad de mes (cerrar contrato → mensual prorrateada →
  //    liquidación final) y para el resto mensual + aguinaldo.
  for (const p of PLANTEL) {
    const employeeId = ids.get(p.ci)!;
    try {
      if (p.egreso) {
        const fechaEgreso = new Date(YEAR, 5, p.egreso.dia); // junio
        const contrato = await prisma.contrato.findFirst({ where: { employeeId, companyId: company.id, activo: true } });
        if (contrato) {
          await prisma.contrato.update({
            where: { id: contrato.id },
            data: { fechaFin: fechaEgreso, vigenciaHasta: fechaEgreso, causalEgresoCod: p.egreso.causal },
          });
        }
        // Mensualidad de junio prorrateada (el motor toma los días del contrato).
        await generarLiquidacionMensual({ employeeId, periodId: periodos.get(6)!, year: YEAR, month: 6, userId });
        liquidaciones++;
        // Liquidación final (aguinaldo por egreso + licencia no gozada + vacacional; IPD si causal 2).
        await calcularLiquidacionFinal(employeeId, periodos.get(6)!, fechaEgreso, userId, company.id);
        finales++;
        await prisma.employee.update({ where: { id: employeeId }, data: { active: false, fechaEgreso } });
      } else {
        await generarLiquidacionMensual({ employeeId, periodId: periodos.get(6)!, year: YEAR, month: 6, userId });
        liquidaciones++;
        await calcularAguinaldo({ employeeId, periodId: periodos.get(6)!, year: YEAR, month: 6 });
        aguinaldos++;
      }
    } catch (e) {
      errores.push(`${p.apellido} junio: ${(e as Error).message}`);
    }
  }

  return {
    empresa: company.razonSocial,
    personasCreadas,
    personasExistentes,
    liquidacionesGeneradas: liquidaciones,
    aguinaldos,
    finales,
    errores,
  };
}
