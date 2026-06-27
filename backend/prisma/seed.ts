/**
 * SEED SCRIPT — Datos iniciales para demostración
 *
 * Crea:
 * - Catálogos BPS/MTSS (tipo de aporte, tipo de contribuyente, grupos de actividad)
 * - 1 empresa (industria y comercio)
 * - Parámetros BPS/IRPF vigentes 2024
 * - Escala IRPF 2024 (8 tramos, Categoría II)
 * - 3 empleados con situaciones familiares diferentes
 * - Usuario admin + usuario operator + viewer
 */

import { PrismaClient, UserRole, SalaryType, EstadoCivil } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...\n');

  // ── 0. Catálogos BPS / MTSS ───────────────────────────────────
  const tiposAporte = [
    { codigo: 1, nombre: 'Industria y Comercio' },
    { codigo: 2, nombre: 'Civil' },
    { codigo: 3, nombre: 'Rural' },
    { codigo: 4, nombre: 'Construcción' },
    { codigo: 5, nombre: 'Notarial' },
    { codigo: 6, nombre: 'Bancaria' },
    { codigo: 7, nombre: 'Trabajo a domicilio' },
    { codigo: 11, nombre: 'Profesional' },
    { codigo: 13, nombre: 'Caja Policial' },
    { codigo: 48, nombre: 'Servicio doméstico' },
  ];
  for (const t of tiposAporte) {
    await prisma.tipoAporte.upsert({ where: { codigo: t.codigo }, update: { nombre: t.nombre }, create: t });
  }

  const tiposContribuyente = [
    { codigo: 2, nombre: 'SRL — Sociedad de Responsabilidad Limitada' },
    { codigo: 3, nombre: 'SA — Sociedad Anónima' },
    { codigo: 4, nombre: 'Sociedad de hecho' },
    { codigo: 5, nombre: 'Sociedad Colectiva' },
    { codigo: 6, nombre: 'Sociedad en Comandita' },
    { codigo: 7, nombre: 'Capital e Industria' },
    { codigo: 8, nombre: 'Sociedad Civil' },
    { codigo: 9, nombre: 'Asociación Civil' },
    { codigo: 10, nombre: 'Cooperativa' },
    { codigo: 84, nombre: 'SAS — Sociedad por Acciones Simplificada (con dependientes)' },
  ];
  for (const t of tiposContribuyente) {
    await prisma.tipoContribuyente.upsert({ where: { codigo: t.codigo }, update: { nombre: t.nombre }, create: t });
  }

  // Grupos de actividad (Consejos de Salarios MTSS-BPS) — lista base, editable
  const grupos = [
    { numero: 1, nombre: 'Procesamiento y conservación de alimentos, bebidas y tabaco' },
    { numero: 2, nombre: 'Industria frigorífica' },
    { numero: 3, nombre: 'Pesca' },
    { numero: 4, nombre: 'Industria química, del medicamento, farmacéutica, combustibles y anexos' },
    { numero: 5, nombre: 'Industria de la construcción y actividades complementarias' },
    { numero: 6, nombre: 'Industria de la madera, celulosa y papel' },
    { numero: 7, nombre: 'Industria del vidrio, cerámica, caucho, plástico y minerales no metálicos' },
    { numero: 8, nombre: 'Industria metalúrgica, productos metálicos, maquinarias y equipos' },
    { numero: 9, nombre: 'Industria de la vestimenta, textil, cuero y calzado' },
    { numero: 10, nombre: 'Comercio en general' },
    { numero: 11, nombre: 'Comercio minorista de la alimentación' },
    { numero: 12, nombre: 'Hoteles, restoranes y bares' },
    { numero: 13, nombre: 'Transporte y almacenamiento' },
    { numero: 14, nombre: 'Intermediación financiera, seguros y pensiones' },
    { numero: 15, nombre: 'Servicios de salud, anexos y conexos' },
    { numero: 16, nombre: 'Servicios culturales, de esparcimiento y comunicaciones' },
    { numero: 17, nombre: 'Industria gráfica' },
    { numero: 18, nombre: 'Servicios profesionales, técnicos, especializados y no incluidos en otros grupos' },
    { numero: 19, nombre: 'Servicios de enseñanza' },
    { numero: 20, nombre: 'Entidades gremiales, sociales y deportivas' },
  ];
  for (const g of grupos) {
    await prisma.grupoActividad.upsert({ where: { numero: g.numero }, update: { nombre: g.nombre }, create: g });
  }

  // Subgrupos de ejemplo (Grupo 12 — Hoteles, restoranes y bares)
  const subgrupos = [
    { grupoNumero: 12, numero: 1, nombre: 'Hoteles, apart hoteles y moteles' },
    { grupoNumero: 12, numero: 2, nombre: 'Restoranes, parrilladas y rotiserías' },
    { grupoNumero: 12, numero: 7, nombre: 'Cafés, bares y pubs' },
  ];
  for (const s of subgrupos) {
    await prisma.subgrupoActividad.upsert({
      where: { grupoNumero_numero: { grupoNumero: s.grupoNumero, numero: s.numero } },
      update: { nombre: s.nombre },
      create: s,
    });
  }

  console.log(`✅ Catálogos cargados: ${tiposAporte.length} tipos de aporte, ${tiposContribuyente.length} tipos de contribuyente, ${grupos.length} grupos de actividad`);

  // ── 1. Empresa ────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { rut: '219876543210' },
    update: {},
    create: {
      rut: '219876543210',
      razonSocial: 'Empresa Demo S.A.',
      nombreFantasia: 'Demo Corp',
      domicilio: 'Av. 18 de Julio 1234, Montevideo',
      localidad: 'Montevideo',
      departamento: 'Montevideo',
      email: 'demo@empresa.uy',
      telefono: '2901 0000',
      actividadPrincipal: 'Servicios informáticos',
      grupoActividad: 'Grupo 10 — Comercio',
      bseRate: 25,  // 0.25% BSE
      tipoAporte: 1,         // Industria y Comercio
      tipoContribuyente: 3,  // SA
      grupoActividadNum: 10, // Comercio en general
      naturalezaJuridica: 'Sociedad Anónima',
      numeroBps: 'BPS-EMP-001',
    },
  });
  console.log(`✅ Empresa: ${company.razonSocial} (${company.id})`);

  // ── 2. Usuarios ───────────────────────────────────────────────
  const adminPass = await bcrypt.hash('Admin1234!', 12);
  const opPass = await bcrypt.hash('Operator1234!', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@sueldos.uy' },
    update: {},
    create: {
      email: 'admin@sueldos.uy',
      passwordHash: adminPass,
      nombre: 'Administrador',
      apellido: 'Sistema',
      role: UserRole.ADMIN,
    },
  });

  const operator = await prisma.user.upsert({
    where: { email: 'liquidador@empresa.uy' },
    update: {},
    create: {
      email: 'liquidador@empresa.uy',
      passwordHash: opPass,
      nombre: 'Liquidador',
      apellido: 'Demo',
      role: UserRole.OPERATOR,
      companyId: company.id,
    },
  });

  const viewer = await prisma.user.upsert({
    where: { email: 'consulta@empresa.uy' },
    update: {},
    create: {
      email: 'consulta@empresa.uy',
      passwordHash: await bcrypt.hash('Viewer1234!', 12),
      nombre: 'Consulta',
      apellido: 'Demo',
      role: UserRole.VIEWER,
      companyId: company.id,
    },
  });

  console.log(`✅ Usuarios: ${admin.email}, ${operator.email}, ${viewer.email}`);

  // ── 3. Parámetros BPS/IRPF 2024 ──────────────────────────────
  const effectiveDate2024 = new Date('2024-01-01T00:00:00.000Z');
  const effectiveDate2025 = new Date('2025-01-01T00:00:00.000Z');

  const params2024 = [
    { key: 'BPC', value: '6756', description: 'Base Prestaciones y Contribuciones 2024 (en pesos)' },
    { key: 'BPS_JUBILATORIO_RATE_BP', value: '1500', description: 'Tasa BPS jubilatorio obrero (15%) en basis points' },
    { key: 'FONASA_BASIC_RATE_BP', value: '300', description: 'FONASA base obrero (3%) — ingreso <= 2.5 BPC' },
    { key: 'FONASA_BASIC_HIGH_RATE_BP', value: '450', description: 'FONASA base obrero (4.5%) — ingreso > 2.5 BPC' },
    { key: 'FONASA_THRESHOLD_BPC', value: '2.5', description: 'Umbral de ingreso (en BPC) para tasa FONASA básica vs. alta' },
    { key: 'FONASA_HIJOS_RATE_BP', value: '150', description: 'FONASA adicional por hijos a cargo (+1.5%)' },
    { key: 'FONASA_CONYUGE_RATE_BP', value: '200', description: 'FONASA adicional por cónyuge a cargo (+2%)' },
    { key: 'FONASA_FAMILIA_RATE_BP', value: '200', description: '(compat) FONASA familia adicional (2%) en basis points' },
    { key: 'FRL_OBRERO_RATE_BP', value: '12.5', description: 'Tasa FRL obrero (0.125%) en basis points' },
    { key: 'FRL_PATRONAL_RATE_BP', value: '2.5', description: 'Tasa FRL patronal (0.025%) en basis points' },
    { key: 'BPS_IVS_PATRONAL_RATE_BP', value: '750', description: 'Tasa BPS IVS patronal (7.5%) en basis points' },
    { key: 'IRPF_HIJOS_BPC', value: '13', description: 'Deducción IRPF por hijo a cargo (13 BPC anuales)' },
    { key: 'IRPF_HIJOS_DISCAPACITADOS_BPC', value: '26', description: 'Deducción IRPF por hijo discapacitado (26 BPC anuales)' },
    { key: 'IRPF_CONYUGE_BPC', value: '6', description: 'Deducción IRPF por cónyuge a cargo (6 BPC anuales)' },
  ];

  const params2025 = [
    { key: 'BPC', value: '7622', description: 'BPC 2025 (en pesos) — actualizar con valor oficial' },
  ];

  for (const p of params2024) {
    await prisma.payrollParameter.upsert({
      where: { id: `seed_2024_${p.key}` },
      update: { value: p.value, description: p.description },
      create: {
        id: `seed_2024_${p.key}`,
        key: p.key,
        value: p.value,
        description: p.description,
        effectiveDate: effectiveDate2024,
        companyId: null,
      },
    });
  }

  for (const p of params2025) {
    await prisma.payrollParameter.upsert({
      where: { id: `seed_2025_${p.key}` },
      update: { value: p.value, description: p.description },
      create: {
        id: `seed_2025_${p.key}`,
        key: p.key,
        value: p.value,
        description: p.description,
        effectiveDate: effectiveDate2025,
        companyId: null,
      },
    });
  }

  console.log(`✅ Parámetros BPS/IRPF 2024-2025 cargados`);

  // ── 4. Escala IRPF — Categoría II (Uruguay 2024/2025) ─────────
  // Eliminar escala anterior si existe (incluye versiones previas con tasas erróneas)
  await prisma.irpfBracket.deleteMany({ where: { effectiveDate: effectiveDate2024 } });

  await prisma.irpfBracket.createMany({
    data: [
      //  fromBpc toBpc   rate (bp)
      { fromBpc: 0,    toBpc: 84,   rate: 0,    effectiveDate: effectiveDate2024 },  // 0%
      { fromBpc: 84,   toBpc: 120,  rate: 1000, effectiveDate: effectiveDate2024 },  // 10%
      { fromBpc: 120,  toBpc: 180,  rate: 1500, effectiveDate: effectiveDate2024 },  // 15%
      { fromBpc: 180,  toBpc: 600,  rate: 2400, effectiveDate: effectiveDate2024 },  // 24%
      { fromBpc: 600,  toBpc: 900,  rate: 2500, effectiveDate: effectiveDate2024 },  // 25%
      { fromBpc: 900,  toBpc: 1380, rate: 2700, effectiveDate: effectiveDate2024 },  // 27%
      { fromBpc: 1380, toBpc: 2100, rate: 3100, effectiveDate: effectiveDate2024 },  // 31%
      { fromBpc: 2100, toBpc: null, rate: 3600, effectiveDate: effectiveDate2024 },  // 36%
    ],
  });

  console.log(`✅ Escala IRPF 2024 cargada (8 tramos: 0/10/15/24/25/27/31/36%)`);

  // ── 5. Laudo ──────────────────────────────────────────────────
  await prisma.laudo.upsert({
    where: { id: 'seed_laudo_1' },
    update: {},
    create: {
      id: 'seed_laudo_1',
      companyId: company.id,
      grupoActividad: 'Grupo 10',
      subgrupo: 'Subgrupo 3',
      categoria: 'Empleado',
      nivel: 'A',
      descripcion: 'Empleado administrativo nivel A',
      salarioMinimo: BigInt(3000000),  // $30,000.00 (en centésimos)
      effectiveDate: effectiveDate2024,
    },
  });

  console.log(`✅ Laudo mínimo cargado`);

  // ── 6. Empleados ──────────────────────────────────────────────

  // Empleado 1: Ana García — mensual, $80,000, sin cargas, alto IRPF
  const emp1 = await prisma.employee.upsert({
    where: { companyId_ci: { companyId: company.id, ci: '12345678' } },
    update: {},
    create: {
      companyId: company.id,
      ci: '12345678',
      nombre: 'Ana',
      apellido: 'García',
      estadoCivil: EstadoCivil.SOLTERO,
      fechaIngreso: new Date('2015-03-01'),
      cargo: 'Gerente de Sistemas',
      categoria: 'Empleado',
      nivel: 'A',
      salaryType: SalaryType.MENSUAL,
      salarioNominal: BigInt(8000000),   // $80,000.00
      conyugeACargo: false,
      hijosACargo: 0,
      hijosDiscapacitados: 0,
      irpfMetodo: 'PROYECCION',
      fonasaFamilia: false,
      bpsNumero: 'BPS001234',
    },
  });

  // Empleado 2: Carlos López — mensual, $45,000, con cónyuge + 2 hijos
  const emp2 = await prisma.employee.upsert({
    where: { companyId_ci: { companyId: company.id, ci: '23456789' } },
    update: {},
    create: {
      companyId: company.id,
      ci: '23456789',
      nombre: 'Carlos',
      apellido: 'López',
      estadoCivil: EstadoCivil.CASADO,
      fechaIngreso: new Date('2020-06-15'),
      cargo: 'Analista Senior',
      categoria: 'Empleado',
      nivel: 'A',
      salaryType: SalaryType.MENSUAL,
      salarioNominal: BigInt(4500000),   // $45,000.00
      conyugeACargo: true,
      hijosACargo: 2,
      hijosDiscapacitados: 0,
      irpfMetodo: 'PROYECCION',
      fonasaFamilia: true,
      bpsNumero: 'BPS002345',
    },
  });

  // Empleado 3: María Rodríguez — jornalera, jornal $1,500/día, 1 hijo
  const emp3 = await prisma.employee.upsert({
    where: { companyId_ci: { companyId: company.id, ci: '34567890' } },
    update: {},
    create: {
      companyId: company.id,
      ci: '34567890',
      nombre: 'María',
      apellido: 'Rodríguez',
      estadoCivil: EstadoCivil.SOLTERO,
      fechaIngreso: new Date('2023-01-10'),
      cargo: 'Operaria',
      categoria: 'Empleado',
      nivel: 'A',
      salaryType: SalaryType.JORNALERO,
      salarioNominal: BigInt(150000),    // Equivalente mensual $1,500/día × 25
      jornal: BigInt(150000),            // $1,500 por día
      conyugeACargo: false,
      hijosACargo: 1,
      hijosDiscapacitados: 0,
      irpfMetodo: 'PROYECCION',
      fonasaFamilia: true,               // tiene 1 hijo a cargo
      bpsNumero: 'BPS003456',
    },
  });

  console.log(`✅ Empleados creados:`);
  console.log(`   - ${emp1.apellido}, ${emp1.nombre}: $${Number(emp1.salarioNominal) / 100} mensual`);
  console.log(`   - ${emp2.apellido}, ${emp2.nombre}: $${Number(emp2.salarioNominal) / 100} mensual (2 hijos, cónyuge)`);
  console.log(`   - ${emp3.apellido}, ${emp3.nombre}: $${Number(emp3.jornal ?? 0) / 100}/día jornalero`);

  // Accrual de vacaciones
  const currentYear = new Date().getFullYear();
  for (const emp of [emp1, emp2, emp3]) {
    const antiguedad = Math.floor(
      (new Date().getTime() - emp.fechaIngreso.getTime()) / (1000 * 60 * 60 * 24 * 365.25),
    );
    const diasLicencia = antiguedad >= 10 ? 30 : antiguedad >= 5 ? 25 : 20;
    await prisma.vacationAccrual.upsert({
      where: { employeeId_year: { employeeId: emp.id, year: currentYear } },
      update: {},
      create: {
        employeeId: emp.id,
        year: currentYear,
        diasCorresponden: diasLicencia,
        diasTomados: 0,
        diasPendientes: diasLicencia,
      },
    });
  }

  console.log(`✅ Accruals de vacaciones inicializados`);

  // ── Resumen ───────────────────────────────────────────────────
  console.log('\n🎉 Seed completado exitosamente!\n');
  console.log('📋 CREDENCIALES DE ACCESO:');
  console.log('   Admin:    admin@sueldos.uy      / Admin1234!');
  console.log('   Operator: liquidador@empresa.uy / Operator1234!');
  console.log('   Viewer:   consulta@empresa.uy   / Viewer1234!');
  console.log('\n📊 EMPLEADOS DE PRUEBA:');
  console.log('   Ana García     (CI: 12345678) — $80,000/mes, sin cargas');
  console.log('   Carlos López   (CI: 23456789) — $45,000/mes, cónyuge + 2 hijos');
  console.log('   María Rodríguez(CI: 34567890) — $1,500/día jornalera, 1 hijo');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
