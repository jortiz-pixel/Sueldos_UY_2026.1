/**
 * NÓMINA BPS (declaración nominada)
 *
 * Etapa A: checklist de completitud — qué datos faltan para poder generar el
 * archivo de nómina de una empresa. Etapa B agregará la generación del archivo.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';

export const nominaRouter = Router();

// GET /api/nomina/checklist?companyId=...
// Valida empresa, personas y contratos contra los datos que exige la nominada.
nominaRouter.get('/checklist', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.query.companyId ?? '');
    if (!companyId) throw new AppError(400, 'companyId requerido');
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundError('Empresa');
    await assertCompanyAccess(req, companyId);

    // Empresa (registro 1 y 4 del archivo)
    const faltantesEmpresa: string[] = [];
    if (!company.numeroBps) faltantesEmpresa.push('Nº de empresa BPS');
    if (!company.rut) faltantesEmpresa.push('RUT');
    if (company.tipoAporte == null) faltantesEmpresa.push('Tipo de aporte (Tabla 1)');
    if (company.tipoContribuyente == null) faltantesEmpresa.push('Tipo de contribuyente (Tabla 1)');
    if (!company.domicilio) faltantesEmpresa.push('Domicilio');

    // Personas + su contrato más reciente en esta empresa (registros 5 y 6)
    const employees = await prisma.employee.findMany({
      where: { companyId, active: true },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
      include: {
        contratos: {
          where: { companyId, activo: true },
          orderBy: { vigenciaDesde: 'desc' },
          take: 1,
        },
      },
    });

    const personas = employees.map((e) => {
      const c = e.contratos[0];
      const faltantes: string[] = [];
      if (!e.ci) faltantes.push('Cédula de identidad');
      if (!e.fechaNacimiento) faltantes.push('Fecha de nacimiento');
      if (!e.sexo) faltantes.push('Sexo');
      if (!c) faltantes.push('Contrato vigente');
      else {
        if (c.vinculoFuncional == null) faltantes.push('Vínculo funcional (Tabla 3)');
        if (c.seguroSalud == null) faltantes.push('Seguro de salud (Tabla 8)');
        if (c.horasSemanales == null) faltantes.push('Horas semanales');
        if (c.computosEspeciales == null) faltantes.push('Cómputos especiales (Tabla 12)');
        if (c.exoneracionAporte == null) faltantes.push('Exoneración de aportes (Tabla 10)');
      }
      return {
        id: e.id,
        employeeNumber: e.employeeNumber,
        ci: e.ci,
        nombre: [e.nombre, e.nombre2].filter(Boolean).join(' '),
        apellido: [e.apellido, e.apellido2].filter(Boolean).join(' '),
        contratoId: c?.id ?? null,
        faltantes,
      };
    });

    const incompletas = personas.filter((p) => p.faltantes.length > 0);
    res.json({
      empresa: { id: company.id, razonSocial: company.razonSocial, faltantes: faltantesEmpresa },
      personas: incompletas,
      totalPersonas: personas.length,
      totalIncompletas: incompletas.length,
      listaParaNomina: faltantesEmpresa.length === 0 && incompletas.length === 0,
    });
  } catch (err) { next(err); }
});
