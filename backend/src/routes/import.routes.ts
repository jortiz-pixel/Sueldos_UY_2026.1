import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { UserRole, SalaryType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { AppError } from '../middleware/errorHandler';
import { parsePersonasExcel, validateRows } from '../services/import.service';
import { soloDigitos } from '../utils/cedula';

export const importRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

    const existing = await prisma.employee.findMany({ select: { ci: true } });
    const existingCIs = new Set(existing.map((e) => soloDigitos(e.ci)));
    validateRows(rows, existingCIs);

    const validas = rows.filter((r) => r.errores.length === 0);
    const resumen = { total: rows.length, validas: validas.length, conErrores: rows.length - validas.length };

    if (!commit) {
      res.json({ dryRun: true, headers, mapeo, resumen, filas: rows });
      return;
    }

    let creadas = 0;
    for (const row of validas) {
      const d = row.datos;
      const fechaIngreso = new Date(d.fechaIngreso!);
      const salarioCent = BigInt(Math.round((d.salarioNominal as number) * 100));
      try {
        await prisma.$transaction(async (tx) => {
          const emp = await tx.employee.create({
            data: {
              ci: soloDigitos(d.ci),
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
