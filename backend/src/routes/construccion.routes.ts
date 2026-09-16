import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { CATEGORIAS_CONSTRUCCION, jornalesVigentes, refrescarPartidasDesdeJornal, CONVENIO_VIGENTE_HASTA, MTSS_URL } from '../services/construccion.service';
import { storageService, safeFileName } from '../services/storage.service';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { recordAudit } from '../services/audit.service';

export const construccionRouter = Router();

// Los convenios del MTSS pueden ser PDF escaneados grandes → límite 25 MB.
const uploadLaudo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// GET /api/construccion/jornales → jornales vigentes por categoría y recuadro.
construccionRouter.get('/jornales', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : new Date();
    const vigentes = await jornalesVigentes(fecha);
    // Aviso de vencimiento: el convenio rige hasta CONVENIO_VIGENTE_HASTA. Si ya
    // pasó y no se cargó ninguna vigencia posterior, avisar que hay que buscar
    // el acta nueva en la web del MTSS.
    const hayVigenciaNueva = vigentes.some((v) => v.effectiveDate > new Date(CONVENIO_VIGENTE_HASTA));
    const vencido = new Date() > new Date(CONVENIO_VIGENTE_HASTA) && !hayVigenciaNueva;
    res.json({
      categorias: CATEGORIAS_CONSTRUCCION,
      jornales: vigentes.map((v) => ({
        categoria: v.categoria,
        recuadro: v.recuadro,
        valorHora: v.valorHora.toString(),
        effectiveDate: v.effectiveDate,
      })),
      convenioVigenteHasta: CONVENIO_VIGENTE_HASTA,
      vencido,
      mtssUrl: MTSS_URL,
    });
  } catch (err) { next(err); }
});

// PUT /api/construccion/jornales — guarda una vigencia de jornales (por ronda).
// body: { effectiveDate, valores: [{ categoria, recuadro, valorHoraPesos }] }
construccionRouter.put('/jornales', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      effectiveDate: z.string().min(1),
      valores: z.array(z.object({
        categoria: z.string().min(1),
        recuadro: z.enum(['INCLUIDOS', 'NO_INCLUIDOS']),
        valorHoraPesos: z.number().min(0),
      })),
    });
    const { effectiveDate, valores } = schema.parse(req.body);
    const fecha = new Date(effectiveDate);

    let guardados = 0;
    for (const v of valores) {
      if (v.valorHoraPesos <= 0) continue;
      await prisma.jornalConstruccion.upsert({
        where: { categoria_recuadro_effectiveDate: { categoria: v.categoria, recuadro: v.recuadro, effectiveDate: fecha } },
        create: { categoria: v.categoria, recuadro: v.recuadro, effectiveDate: fecha, valorHora: BigInt(Math.round(v.valorHoraPesos * 100)) },
        update: { valorHora: BigInt(Math.round(v.valorHoraPesos * 100)) },
      });
      guardados++;
    }

    // Derivar ropa/transporte/herramientas del ½ Oficial Albañil (incluidos).
    const partidasActualizadas = await refrescarPartidasDesdeJornal(fecha);

    await recordAudit({ action: 'PARAMETER_CHANGE', entity: 'parameter', newData: { tipo: 'jornales_construccion', effectiveDate, guardados, partidasActualizadas }, req });
    res.json({ guardados, partidasActualizadas });
  } catch (err) { next(err); }
});

// ── Convenios del laudo (PDF de respaldo por vigencia) ─────────────────────
// GET /api/construccion/laudos — lista los convenios adjuntos (metadatos).
construccionRouter.get('/laudos', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const docs = await prisma.laudoDocumento.findMany({ orderBy: { effectiveDate: 'desc' } });
    res.json(docs.map((d) => ({
      id: d.id, effectiveDate: d.effectiveDate, nombre: d.nombre,
      filename: d.filename, mime: d.mime, size: d.size, createdAt: d.createdAt,
    })));
  } catch (err) { next(err); }
});

// POST /api/construccion/laudos — adjunta el PDF del convenio (multipart: file,
// effectiveDate, nombre). Solo guarda el archivo; los valores se cargan aparte.
construccionRouter.post('/laudos', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), uploadLaudo.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    if (!file) throw new AppError(400, 'Adjuntá el archivo del convenio.');
    const { effectiveDate, nombre } = z.object({
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      nombre: z.string().min(1),
    }).parse(req.body);
    const doc = await prisma.laudoDocumento.create({
      data: {
        effectiveDate: new Date(`${effectiveDate}T00:00:00Z`),
        nombre,
        filename: file.originalname.slice(-150),
        mime: file.mimetype,
        size: file.size,
        storageKey: '', // se completa abajo con el id
        createdBy: req.user!.userId,
      },
    });
    const key = `laudos/${doc.id}-${safeFileName(file.originalname)}`;
    await storageService.save(key, file.buffer);
    await prisma.laudoDocumento.update({ where: { id: doc.id }, data: { storageKey: key } });
    await recordAudit({ action: 'PARAMETER_CHANGE', entity: 'parameter', entityId: doc.id, newData: { tipo: 'laudo_convenio', nombre, effectiveDate }, req });
    res.status(201).json({ id: doc.id, effectiveDate: doc.effectiveDate, nombre, filename: doc.filename, size: doc.size });
  } catch (err) { next(err); }
});

// GET /api/construccion/laudos/:id/download — descarga el PDF.
construccionRouter.get('/laudos/:id/download', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.laudoDocumento.findUnique({ where: { id: req.params.id } });
    if (!doc || !doc.storageKey) throw new NotFoundError('Convenio');
    const buf = await storageService.read(doc.storageKey);
    res.setHeader('Content-Type', doc.mime || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// DELETE /api/construccion/laudos/:id — elimina el convenio adjunto.
construccionRouter.delete('/laudos/:id', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.laudoDocumento.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new NotFoundError('Convenio');
    if (doc.storageKey) { try { await storageService.remove(doc.storageKey); } catch { /* ignora si ya no está */ } }
    await prisma.laudoDocumento.delete({ where: { id: doc.id } });
    res.json({ message: 'Convenio eliminado' });
  } catch (err) { next(err); }
});
