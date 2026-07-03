/**
 * NÓMINA BPS (declaración nominada)
 *
 * Etapa A: checklist de completitud — qué datos faltan para poder generar el
 * archivo de nómina de una empresa. Etapa B agregará la generación del archivo.
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { generarNominaBps, importarNominaAtyr, generarRectificativaBps, registrarDeclaracion } from '../services/nomina.service';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const nominaRouter = Router();

function parsePeriodo(req: Request): { companyId: string; year: number; month: number } {
  const companyId = String(req.query.companyId ?? '');
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!companyId) throw new AppError(400, 'companyId requerido');
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new AppError(400, 'year inválido');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new AppError(400, 'month inválido');
  return { companyId, year, month };
}

// GET /api/nomina/preview?companyId&year&month
// Vista previa de la nómina BPS: personas, conceptos, montos, errores y advertencias.
nominaRouter.get('/preview', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { companyId, year, month } = parsePeriodo(req);
    await assertCompanyAccess(req, companyId);
    const nomina = await generarNominaBps(companyId, year, month);
    res.json({
      filename: nomina.filename,
      montoTotal: nomina.montoTotal,
      personas: nomina.personas,
      errores: nomina.errores,
      advertencias: nomina.advertencias,
      lineas: nomina.errores.length === 0 ? nomina.contenido.trimEnd().split('\n') : [],
    });
  } catch (err) { next(err); }
});

// GET /api/nomina/archivo?companyId&year&month  → descarga el archivo ATYR
nominaRouter.get('/archivo', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { companyId, year, month } = parsePeriodo(req);
    await assertCompanyAccess(req, companyId);
    const nomina = await generarNominaBps(companyId, year, month);
    if (nomina.errores.length > 0) {
      throw new AppError(409, `La nómina tiene errores: ${nomina.errores.join(' · ')}`);
    }

    // Registrar la "foto" de lo declarado (base de futuras rectificativas).
    const resumen: Record<string, { r5: string; r6?: string; conceptos: Record<string, string> }> = {};
    for (const linea of nomina.contenido.trimEnd().split('\n')) {
      const f = linea.split('|');
      if (f[0] === '5') resumen[f[3]] = { r5: linea, conceptos: {} };
      else if (f[0] === '6' && resumen[f[4]]) resumen[f[4]].r6 = linea;
      else if (f[0] === '7' && resumen[f[4]]) {
        const prev = BigInt(resumen[f[4]].conceptos[f[6]] ?? '0');
        resumen[f[4]].conceptos[f[6]] = (prev + BigInt(Math.round(Number(f[7]) * 100))).toString();
      }
    }
    await registrarDeclaracion(
      companyId, year, month, 'N', nomina.filename, resumen,
      BigInt(Math.round(Number(nomina.montoTotal) * 100)), req.user!.userId,
    );

    res.setHeader('Content-Type', 'text/plain; charset=ascii');
    res.setHeader('Content-Disposition', `attachment; filename="${nomina.filename}"`);
    res.send(nomina.contenido);
  } catch (err) { next(err); }
});

// GET /api/nomina/rectificativa/preview?companyId&year&month
// Diferencias entre lo declarado (última N + rectificativas) y el estado actual.
nominaRouter.get('/rectificativa/preview', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { companyId, year, month } = parsePeriodo(req);
    await assertCompanyAccess(req, companyId);
    const rect = await generarRectificativaBps(companyId, year, month);
    res.json({
      filename: rect.filename,
      montoTotal: rect.montoTotal,
      declaradaAt: rect.declaradaAt,
      rectificativasPrevias: rect.rectificativasPrevias,
      diferencias: rect.diferencias,
      errores: rect.errores,
      advertencias: rect.advertencias,
      lineas: rect.errores.length === 0 && rect.diferencias.length > 0 ? rect.contenido.trimEnd().split('\n') : [],
    });
  } catch (err) { next(err); }
});

// GET /api/nomina/rectificativa/archivo?companyId&year&month → descarga la R
nominaRouter.get('/rectificativa/archivo', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { companyId, year, month } = parsePeriodo(req);
    await assertCompanyAccess(req, companyId);
    const rect = await generarRectificativaBps(companyId, year, month);
    if (rect.errores.length > 0) throw new AppError(409, rect.errores.join(' · '));
    if (rect.diferencias.length === 0) throw new AppError(409, 'No hay diferencias con lo declarado: no corresponde rectificativa.');

    // Registrar la rectificativa emitida (deltas con signo) para acumularla
    // como parte de lo declarado en futuras rectificativas.
    await registrarDeclaracion(
      companyId, year, month, 'R', rect.filename, rect.resumenDeltas,
      BigInt(Math.round(Number(rect.montoTotal) * 100)), req.user!.userId,
    );

    res.setHeader('Content-Type', 'text/plain; charset=ascii');
    res.setHeader('Content-Disposition', `attachment; filename="${rect.filename}"`);
    res.send(rect.contenido);
  } catch (err) { next(err); }
});

// GET /api/nomina/declaraciones?companyId=  → última declaración presentada + historial
nominaRouter.get('/declaraciones', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.query.companyId ?? '');
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const declaraciones = await prisma.nominaDeclaracion.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, year: true, month: true, tipo: true, filename: true, montoTotal: true, createdAt: true },
    });
    res.json({
      ultima: declaraciones[0]
        ? { ...declaraciones[0], montoTotal: declaraciones[0].montoTotal.toString() }
        : null,
      historial: declaraciones.map((d) => ({ ...d, montoTotal: d.montoTotal.toString() })),
    });
  } catch (err) { next(err); }
});

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

// POST /api/nomina/import  (multipart: file, commit)
//   Importa empresa + personas + contratos desde un archivo de nómina ATYR
//   (migración desde GNS u otro software). commit != 'true' → solo previsualiza.
nominaRouter.post('/import', authenticate, requireRole(UserRole.ADMIN), upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError(400, 'Archivo requerido (campo "file")');
    const commit = String(req.body.commit ?? '') === 'true';
    const contenido = req.file.buffer.toString('utf8');
    if (!contenido.trim().startsWith('1|')) {
      throw new AppError(400, 'El archivo no parece una nómina ATYR (debe empezar con el registro de empresa "1|N|...").');
    }
    const plan = await importarNominaAtyr(contenido, commit);
    res.json({ dryRun: !commit, ...plan });
  } catch (err) { next(err); }
});
