import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { UserRole, SalaryType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError } from '../middleware/errorHandler';
import { parsePersonasExcel, validateRows, buildPlantillaPersonas } from '../services/import.service';
import { soloDigitos } from '../utils/cedula';

export const importRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/import/personas/plantilla  → Excel de ejemplo descargable
importRouter.get('/personas/plantilla', authenticate, (_req: Request, res: Response) => {
  const buffer = buildPlantillaPersonas();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_personas.xlsx"');
  res.send(buffer);
});

// POST /api/import/personas  (multipart: file, companyId, commit)
//   commit != 'true'  → dry-run: parsea y valida sin escribir.
//   commit == 'true'  → crea persona + primer contrato por cada fila válida.
importRouter.post('/personas', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.body.companyId ?? '');
    if (!companyId) throw new AppError(400, 'companyId requerido');
    await assertCompanyAccess(req, companyId);
    const commit = String(req.body.commit ?? '') === 'true';

    if (!req.file) throw new AppError(400, 'Archivo requerido (campo "file")');

    const { headers, mapeo, rows } = parsePersonasExcel(req.file.buffer);
    if (rows.length === 0) throw new AppError(400, 'El archivo no tiene filas de datos');

    // El CI es único POR EMPRESA: solo se valida contra los CI de ESTA empresa.
    const existing = await prisma.employee.findMany({ where: { companyId }, select: { ci: true } });
    const existingCIs = new Set(existing.map((e) => soloDigitos(e.ci)));
    validateRows(rows, existingCIs);

    const validas = rows.filter((r) => r.errores.length === 0);
    const resumen = { total: rows.length, validas: validas.length, conErrores: rows.length - validas.length };

    if (!commit) {
      res.json({ dryRun: true, headers, mapeo, resumen, filas: rows });
      return;
    }

    // Legajo automático: arranca en el máximo de la empresa + 1 y se incrementa.
    const maxEN = await prisma.employee.aggregate({ where: { companyId }, _max: { employeeNumber: true } });
    let nextEN = (maxEN._max.employeeNumber ?? 0) + 1;

    let creadas = 0;
    for (const row of validas) {
      const d = row.datos;
      const fechaIngreso = new Date(d.fechaIngreso!);
      const salarioCent = BigInt(Math.round((d.salarioNominal as number) * 100));
      try {
        const enAsignado = nextEN++;
        await prisma.$transaction(async (tx) => {
          const emp = await tx.employee.create({
            data: {
              ci: soloDigitos(d.ci),
              employeeNumber: enAsignado,
              nombre: d.nombre,
              apellido: d.apellido,
              fechaNacimiento: d.fechaNacimiento ? new Date(d.fechaNacimiento) : undefined,
              email: d.email,
              telefono: d.telefono,
              companyId,
              fechaIngreso,
              cargo: d.cargo,
              salaryType: SalaryType.MENSUAL,
              salarioNominal: salarioCent,
            },
          });
          await tx.contrato.create({
            data: {
              employeeId: emp.id,
              companyId,
              numero: 1,
              vigenciaDesde: fechaIngreso,
              fechaIngreso,
              cargo: d.cargo,
              salaryType: SalaryType.MENSUAL,
              salarioNominal: salarioCent,
            },
          });
        });
        creadas++;
      } catch (e) {
        row.errores.push('Error al crear: ' + (e as Error).message);
      }
    }

    res.json({ dryRun: false, resumen: { ...resumen, creadas }, filas: rows });
  } catch (err) { next(err); }
});
