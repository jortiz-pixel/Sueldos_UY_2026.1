/**
 * SEED SCRIPT — Datos iniciales para demostración
 */

import { PrismaClient, UserRole, SalaryType, EstadoCivil, ItemType, ModuleKey, EntitlementStatus, MembershipRole, MembershipStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...\n');

  // Tabla 1 del codificador BPS (aportación). La migración codificador_bps las
  // mantiene actualizadas en producción; acá se alinean para un seed limpio.
  const tiposAporte = [
    { codigo: 1, nombre: 'IC — Industria y Comercio' }, { codigo: 2, nombre: 'CI — Civil' },
    { codigo: 3, nombre: 'RU — Rural' }, { codigo: 4, nombre: 'CT — Construcción' },
    { codigo: 5, nombre: 'Notarial' }, { codigo: 6, nombre: 'Bancaria' },
    { codigo: 7, nombre: 'TD — Trabajo a Domicilio' }, { codigo: 8, nombre: 'Escolar' },
    { codigo: 11, nombre: 'Servicios Personales' }, { codigo: 12, nombre: 'Militar' },
    { codigo: 13, nombre: 'Policial' }, { codigo: 14, nombre: 'Unión Postal' },
    { codigo: 48, nombre: 'Servicio Doméstico' },
  ];
  for (const t of tiposAporte) await prisma.tipoAporte.upsert({ where: { codigo: t.codigo }, update: { nombre: t.nombre }, create: t });

  const tiposContribuyente = [
    { codigo: 2, nombre: 'SRL — Sociedad de Responsabilidad Limitada' }, { codigo: 3, nombre: 'SA — Sociedad Anónima' },
    { codigo: 4, nombre: 'Sociedad de hecho' }, { codigo: 5, nombre: 'Sociedad Colectiva' },
    { codigo: 6, nombre: 'Sociedad en Comandita' }, { codigo: 7, nombre: 'Capital e Industria' },
    { codigo: 8, nombre: 'Sociedad Civil' }, { codigo: 9, nombre: 'Asociación Civil' },
    { codigo: 10, nombre: 'Cooperativa' }, { codigo: 84, nombre: 'SAS — Sociedad por Acciones Simplificada (con dependientes)' },
  ];
  for (const t of tiposContribuyente) await prisma.tipoContribuyente.upsert({ where: { codigo: t.codigo }, update: { nombre: t.nombre }, create: t });

  const grupos = [
    { numero: 1, nombre: 'Procesamiento y conservación de alimentos, bebidas y tabaco' },
    { numero: 2, nombre: 'Industria frigorífica' }, { numero: 3, nombre: 'Pesca' },
    { numero: 4, nombre: 'Industria química, del medicamento, farmacéutica, combustibles y anexos' },
    { numero: 5, nombre: 'Industria de la construcción y actividades complementarias' },
    { numero: 6, nombre: 'Industria de la madera, celulosa y papel' },
    { numero: 7, nombre: 'Industria del vidrio, cerámica, caucho, plástico y minerales no metálicos' },
    { numero: 8, nombre: 'Industria metalúrgica, productos metálicos, maquinarias y equipos' },
    { numero: 9, nombre: 'Industria de la vestimenta, textil, cuero y calzado' },
    { numero: 10, nombre: 'Comercio en general' }, { numero: 11, nombre: 'Comercio minorista de la alimentación' },
    { numero: 12, nombre: 'Hoteles, restoranes y bares' }, { numero: 13, nombre: 'Transporte y almacenamiento' },
    { numero: 14, nombre: 'Intermediación financiera, seguros y pensiones' },
    { numero: 15, nombre: 'Servicios de salud, anexos y conexos' },
    { numero: 16, nombre: 'Servicios culturales, de esparcimiento y comunicaciones' },
    { numero: 17, nombre: 'Industria gráfica' },
    { numero: 18, nombre: 'Servicios profesionales, técnicos, especializados y no incluidos en otros grupos' },
    { numero: 19, nombre: 'Servicios de enseñanza' }, { numero: 20, nombre: 'Entidades gremiales, sociales y deportivas' },
  ];
  for (const g of grupos) await prisma.grupoActividad.upsert({ where: { numero: g.numero }, update: { nombre: g.nombre }, create: g });

  const subgrupos = [
    { grupoNumero: 12, numero: 1, nombre: 'Hoteles, apart hoteles y moteles' },
    { grupoNumero: 12, numero: 2, nombre: 'Restoranes, parrilladas y rotiserías' },
    { grupoNumero: 12, numero: 7, nombre: 'Cafés, bares y pubs' },
  ];
  for (const s of subgrupos) await prisma.subgrupoActividad.upsert({ where: { grupoNumero_numero: { grupoNumero: s.grupoNumero, numero: s.numero } }, update: { nombre: s.nombre }, create: s });
  console.log(`✅ Catálogos cargados: ${tiposAporte.length} tipos de aporte, ${tiposContribuyente.length} tipos de contribuyente, ${grupos.length} grupos`);

  const company = await prisma.company.upsert({
    where: { rut: '219876543210' },
    update: {},
    create: {
      rut: '219876543210', razonSocial: 'Empresa Demo S.A.', nombreFantasia: 'Demo Corp',
      domicilio: 'Av. 18 de Julio 1234, Montevideo', localidad: 'Montevideo', departamento: 'Montevideo',
      email: 'demo@empresa.uy', telefono: '2901 0000', actividadPrincipal: 'Servicios informáticos',
      grupoActividad: 'Grupo 10 — Comercio', bseRate: 25, tipoAporte: 1, tipoContribuyente: 3,
      grupoActividadNum: 10, naturalezaJuridica: 'Sociedad Anónima', numeroBps: 'BPS-EMP-001',
    },
  });
  console.log(`✅ Empresa: ${company.razonSocial} (${company.id})`);

  const adminPass = await bcrypt.hash('Admin1234!', 12);
  const opPass = await bcrypt.hash('Operator1234!', 12);
  const admin = await prisma.user.upsert({ where: { email: 'admin@sueldos.uy' }, update: {}, create: { email: 'admin@sueldos.uy', passwordHash: adminPass, nombre: 'Administrador', apellido: 'Sistema', role: UserRole.ADMIN } });
  const operator = await prisma.user.upsert({ where: { email: 'liquidador@empresa.uy' }, update: {}, create: { email: 'liquidador@empresa.uy', passwordHash: opPass, nombre: 'Liquidador', apellido: 'Demo', role: UserRole.OPERATOR, companyId: company.id } });
  const viewer = await prisma.user.upsert({ where: { email: 'consulta@empresa.uy' }, update: {}, create: { email: 'consulta@empresa.uy', passwordHash: await bcrypt.hash('Viewer1234!', 12), nombre: 'Consulta', apellido: 'Demo', role: UserRole.VIEWER, companyId: company.id } });
  console.log(`✅ Usuarios: ${admin.email}, ${operator.email}, ${viewer.email}`);

  // F1: backbone de plataforma — membresías + entitlements
  await prisma.entitlement.upsert({
    where: { companyId_module: { companyId: company.id, module: ModuleKey.SUELDOS } },
    update: {},
    create: { companyId: company.id, module: ModuleKey.SUELDOS, plan: 'basico', estado: EntitlementStatus.ACTIVO },
  });
  await prisma.membership.upsert({
    where: { userId_companyId: { userId: operator.id, companyId: company.id } },
    update: {},
    create: { userId: operator.id, companyId: company.id, role: MembershipRole.OPERATOR, estado: MembershipStatus.ACTIVA },
  });
  await prisma.membership.upsert({
    where: { userId_companyId: { userId: viewer.id, companyId: company.id } },
    update: {},
    create: { userId: viewer.id, companyId: company.id, role: MembershipRole.VIEWER, estado: MembershipStatus.ACTIVA },
  });
  console.log('✅ Membresías + entitlement SUELDOS');

  const effectiveDate2024 = new Date('2024-01-01T00:00:00.000Z');
  const effectiveDate2025 = new Date('2025-01-01T00:00:00.000Z');
  const params2024 = [
    { key: 'BPC', value: '6756', description: 'BPC 2024' },
    { key: 'BPS_JUBILATORIO_RATE_BP', value: '1500', description: 'BPS jubilatorio obrero 15%' },
    { key: 'FONASA_BASIC_RATE_BP', value: '300', description: 'FONASA base 3% (<= 2.5 BPC)' },
    { key: 'FONASA_BASIC_HIGH_RATE_BP', value: '450', description: 'FONASA base 4.5% (> 2.5 BPC)' },
    { key: 'FONASA_THRESHOLD_BPC', value: '2.5', description: 'Umbral FONASA en BPC' },
    { key: 'FONASA_HIJOS_RATE_BP', value: '150', description: 'FONASA +1.5% hijos' },
    { key: 'FONASA_CONYUGE_RATE_BP', value: '200', description: 'FONASA +2% cónyuge' },
    { key: 'FONASA_FAMILIA_RATE_BP', value: '200', description: '(compat) FONASA familia 2%' },
    { key: 'FRL_OBRERO_RATE_BP', value: '10', description: 'FRL obrero 0.10%' },
    { key: 'FRL_PATRONAL_RATE_BP', value: '10', description: 'FRL patronal 0.10%' },
    { key: 'BPS_IVS_PATRONAL_RATE_BP', value: '750', description: 'BPS IVS patronal 7.5%' },
    { key: 'IRPF_HIJOS_BPC', value: '13', description: 'Deducción IRPF hijo 13 BPC' },
    { key: 'IRPF_HIJOS_DISCAPACITADOS_BPC', value: '26', description: 'Deducción IRPF hijo discapacitado 26 BPC' },
    { key: 'IRPF_CONYUGE_BPC', value: '6', description: 'Deducción IRPF cónyuge 6 BPC' },
  ];
  for (const p of params2024) await prisma.payrollParameter.upsert({ where: { id: `seed_2024_${p.key}` }, update: { value: p.value, description: p.description }, create: { id: `seed_2024_${p.key}`, key: p.key, value: p.value, description: p.description, effectiveDate: effectiveDate2024, companyId: null } });
  await prisma.payrollParameter.upsert({ where: { id: 'seed_2025_BPC' }, update: { value: '7622' }, create: { id: 'seed_2025_BPC', key: 'BPC', value: '7622', description: 'BPC 2025', effectiveDate: effectiveDate2025, companyId: null } });
  // FRL 0,10% con vigencia desde diciembre 2025 (paridad con la migración 20260709120000).
  const effectiveDateDic2025 = new Date('2025-12-01T00:00:00.000Z');
  await prisma.payrollParameter.upsert({ where: { id: 'frl_2025_12_obrero' }, update: { value: '10' }, create: { id: 'frl_2025_12_obrero', key: 'FRL_OBRERO_RATE_BP', value: '10', description: 'FRL obrero 0,10% (desde 12/2025)', effectiveDate: effectiveDateDic2025, companyId: null } });
  await prisma.payrollParameter.upsert({ where: { id: 'frl_2025_12_patronal' }, update: { value: '10' }, create: { id: 'frl_2025_12_patronal', key: 'FRL_PATRONAL_RATE_BP', value: '10', description: 'FRL patronal 0,10% (desde 12/2025)', effectiveDate: effectiveDateDic2025, companyId: null } });
  console.log(`✅ Parámetros BPS/IRPF cargados`);

  await prisma.irpfBracket.deleteMany({ where: { effectiveDate: effectiveDate2024 } });
  await prisma.irpfBracket.createMany({
    data: [
      { fromBpc: 0, toBpc: 84, rate: 0, effectiveDate: effectiveDate2024 },
      { fromBpc: 84, toBpc: 120, rate: 1000, effectiveDate: effectiveDate2024 },
      { fromBpc: 120, toBpc: 180, rate: 1500, effectiveDate: effectiveDate2024 },
      { fromBpc: 180, toBpc: 360, rate: 2400, effectiveDate: effectiveDate2024 },
      { fromBpc: 360, toBpc: 600, rate: 2500, effectiveDate: effectiveDate2024 },
      { fromBpc: 600, toBpc: 900, rate: 2700, effectiveDate: effectiveDate2024 },
      { fromBpc: 900, toBpc: 1380, rate: 3100, effectiveDate: effectiveDate2024 },
      { fromBpc: 1380, toBpc: null, rate: 3600, effectiveDate: effectiveDate2024 },
    ],
  });
  console.log(`✅ Escala IRPF cargada (8 tramos, escala oficial)`);

  const paramsIrpf = [
    { key: 'IRPF_HIJOS_BPC', value: '20', description: 'Deducción anual por hijo a cargo (BPC)' },
    { key: 'IRPF_HIJOS_DISCAPACITADOS_BPC', value: '40', description: 'Deducción anual por hijo con discapacidad (BPC)' },
    { key: 'IRPF_CONYUGE_BPC', value: '0', description: 'IRPF no tiene deducción por cónyuge' },
    { key: 'IRPF_TASA_DEDUCCION_BAJA_BP', value: '1400', description: 'Tasa deducciones si nominal mensual <= 15 BPC (14%)' },
    { key: 'IRPF_TASA_DEDUCCION_ALTA_BP', value: '800', description: 'Tasa deducciones si nominal mensual > 15 BPC (8%)' },
    { key: 'IRPF_UMBRAL_DEDUCCION_BPC', value: '180', description: 'Umbral anual para la tasa de deducciones (15 BPC/mes x 12)' },
  ];
  for (const p of paramsIrpf) await prisma.payrollParameter.upsert({ where: { id: `seed_irpf_${p.key}` }, update: { value: p.value, description: p.description }, create: { id: `seed_irpf_${p.key}`, key: p.key, value: p.value, description: p.description, effectiveDate: effectiveDate2024, companyId: null } });

  await prisma.laudo.upsert({ where: { id: 'seed_laudo_1' }, update: {}, create: { id: 'seed_laudo_1', companyId: company.id, grupoActividad: 'Grupo 10', subgrupo: 'Subgrupo 3', categoria: 'Empleado', nivel: 'A', descripcion: 'Empleado administrativo nivel A', salarioMinimo: BigInt(3000000), effectiveDate: effectiveDate2024 } });

  const conceptosDemo = [
    { codigo: 'PRES', nombre: 'Presentismo', orden: 50, tipoOperacion: ItemType.HABER, tipoCalculo: 'PORCENTAJE', baseCalculo: 'SUELDO_BASICO', valorRate: 500, valorFijo: null, gravado: true, codBps: 1, activo: false },
    { codigo: 'VIAT', nombre: 'Viático no gravado', orden: 60, tipoOperacion: ItemType.HABER, tipoCalculo: 'VALOR_FIJO', baseCalculo: null, valorRate: null, valorFijo: BigInt(200000), gravado: false, codBps: null, activo: false },
    { codigo: 'ADEL', nombre: 'Adelanto de sueldo', orden: 210, tipoOperacion: ItemType.DESCUENTO_OBRERO, tipoCalculo: 'VALOR_FIJO', baseCalculo: null, valorRate: null, valorFijo: BigInt(0), gravado: false, codBps: null, activo: false },
  ];
  for (const c of conceptosDemo) await prisma.concepto.upsert({ where: { companyId_codigo: { companyId: company.id, codigo: c.codigo } }, update: {}, create: { ...c, companyId: company.id } });
  console.log(`✅ Conceptos de ejemplo (inactivos): ${conceptosDemo.map((c) => c.codigo).join(', ')}`);

  const empleados = [
    { ci: '12345678', nombre: 'Ana', apellido: 'García', estadoCivil: EstadoCivil.SOLTERO, fechaIngreso: new Date('2015-03-01'), cargo: 'Gerente de Sistemas', salaryType: SalaryType.MENSUAL, salarioNominal: BigInt(8000000), jornal: null, conyugeACargo: false, hijosACargo: 0, fonasaFamilia: false, bpsNumero: 'BPS001234' },
    { ci: '23456789', nombre: 'Carlos', apellido: 'López', estadoCivil: EstadoCivil.CASADO, fechaIngreso: new Date('2020-06-15'), cargo: 'Analista Senior', salaryType: SalaryType.MENSUAL, salarioNominal: BigInt(4500000), jornal: null, conyugeACargo: true, hijosACargo: 2, fonasaFamilia: true, bpsNumero: 'BPS002345' },
    { ci: '34567890', nombre: 'María', apellido: 'Rodríguez', estadoCivil: EstadoCivil.SOLTERO, fechaIngreso: new Date('2023-01-10'), cargo: 'Operaria', salaryType: SalaryType.JORNALERO, salarioNominal: BigInt(150000), jornal: BigInt(150000), conyugeACargo: false, hijosACargo: 1, fonasaFamilia: true, bpsNumero: 'BPS003456' },
  ];
  for (const e of empleados) {
    const emp = await prisma.employee.upsert({
      where: { ci: e.ci },
      update: {},
      create: {
        companyId: company.id, ci: e.ci, nombre: e.nombre, apellido: e.apellido, estadoCivil: e.estadoCivil,
        fechaIngreso: e.fechaIngreso, cargo: e.cargo, categoria: 'Empleado', nivel: 'A',
        salaryType: e.salaryType, salarioNominal: e.salarioNominal, jornal: e.jornal,
        conyugeACargo: e.conyugeACargo, hijosACargo: e.hijosACargo, hijosDiscapacitados: 0,
        irpfMetodo: 'PROYECCION', fonasaFamilia: e.fonasaFamilia, bpsNumero: e.bpsNumero,
      },
    });
    const tieneContrato = await prisma.contrato.findFirst({ where: { employeeId: emp.id } });
    if (!tieneContrato) {
      await prisma.contrato.create({
        data: {
          employeeId: emp.id, companyId: company.id, numero: 1,
          vigenciaDesde: emp.fechaIngreso, fechaIngreso: emp.fechaIngreso,
          cargo: emp.cargo, categoria: emp.categoria, nivel: emp.nivel,
          salaryType: emp.salaryType, salarioNominal: emp.salarioNominal, jornal: emp.jornal,
        },
      });
    }
    const currentYear = new Date().getFullYear();
    const antiguedad = Math.floor((new Date().getTime() - emp.fechaIngreso.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    const diasLicencia = antiguedad >= 10 ? 30 : antiguedad >= 5 ? 25 : 20;
    await prisma.vacationAccrual.upsert({ where: { employeeId_year: { employeeId: emp.id, year: currentYear } }, update: {}, create: { employeeId: emp.id, year: currentYear, diasCorresponden: diasLicencia, diasTomados: 0, diasPendientes: diasLicencia } });
  }
  console.log(`✅ Empleados y contratos demo creados (García, López, Rodríguez)`);

  console.log('\n🎉 Seed completado!');
  console.log('📋 admin@sueldos.uy / Admin1234!  ·  liquidador@empresa.uy / Operator1234!  ·  consulta@empresa.uy / Viewer1234!');
}

main()
  .catch((e) => { console.error('❌ Error en seed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
