import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { divRoundHalfUp } from '../utils/money';
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
        valorJornal: v.valorJornal.toString(),
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
// body: { effectiveDate, valores: [{ categoria, recuadro, valorJornalPesos }] }
// El JORNAL (valor diario del acta) es el valor autoritativo; la hora se deriva
// = round(jornal/8) y se guarda en valorHora para el motor.
construccionRouter.put('/jornales', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      effectiveDate: z.string().min(1),
      valores: z.array(z.object({
        categoria: z.string().min(1),
        recuadro: z.enum(['INCLUIDOS', 'NO_INCLUIDOS']),
        valorJornalPesos: z.number().min(0),
      })),
    });
    const { effectiveDate, valores } = schema.parse(req.body);
    const fecha = new Date(effectiveDate);

    let guardados = 0;
    for (const v of valores) {
      if (v.valorJornalPesos <= 0) continue;
      const valorJornal = BigInt(Math.round(v.valorJornalPesos * 100));
      const valorHora = divRoundHalfUp(valorJornal, 8n); // hora = jornal / 8 (redondeo)
      await prisma.jornalConstruccion.upsert({
        where: { categoria_recuadro_effectiveDate: { categoria: v.categoria, recuadro: v.recuadro, effectiveDate: fecha } },
        create: { categoria: v.categoria, recuadro: v.recuadro, effectiveDate: fecha, valorJornal, valorHora },
        update: { valorJornal, valorHora },
      });
      guardados++;
    }

    // Derivar ropa/transporte/herramientas del ½ Oficial Albañil (incluidos).
    const partidasActualizadas = await refrescarPartidasDesdeJornal(fecha);

    await recordAudit({ action: 'PARAMETER_CHANGE', entity: 'parameter', newData: { tipo: 'jornales_construccion', effectiveDate, guardados, partidasActualizadas }, req });
    res.json({ guardados, partidasActualizadas });
  } catch (err) { next(err); }
});

// POST /api/construccion/jornales/ajuste — aplica un aumento % a TODAS las
// categorías del laudo (ambos recuadros) y crea una vigencia NUEVA con los
// valores multiplicados por (1 + %/100). Las vigencias anteriores no se tocan.
// El % rige para todas las empresas (la tabla de jornales es global); lo que
// depende de cada empresa es qué categoría/recuadro usa cada contrato.
// body: { porcentaje, effectiveDate }
construccionRouter.post('/jornales/ajuste', authenticate, requireRole(UserRole.ADMIN, UserRole.OPERATOR), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      porcentaje: z.number().gt(-100),
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const { porcentaje, effectiveDate } = schema.parse(req.body);
    const fecha = new Date(`${effectiveDate}T00:00:00Z`);

    // Tomar la última vigencia ANTERIOR a la fecha nueva (día previo), así el
    // ajuste parte de los valores hoy vigentes sin verse a sí mismo.
    const base = new Date(fecha.getTime() - 24 * 60 * 60 * 1000);
    const vigentes = await jornalesVigentes(base);
    if (vigentes.length === 0) throw new AppError(400, 'No hay jornales cargados para aplicar el ajuste. Cargá primero una vigencia.');

    const factor = 1 + porcentaje / 100;
    let guardados = 0;
    for (const v of vigentes) {
      // Se ajusta el JORNAL (valor autoritativo) y se re-deriva la hora = jornal/8.
      const nuevoJornal = BigInt(Math.round(Number(v.valorJornal) * factor));
      if (nuevoJornal <= 0n) continue;
      const nuevaHora = divRoundHalfUp(nuevoJornal, 8n);
      await prisma.jornalConstruccion.upsert({
        where: { categoria_recuadro_effectiveDate: { categoria: v.categoria, recuadro: v.recuadro, effectiveDate: fecha } },
        create: { categoria: v.categoria, recuadro: v.recuadro as 'INCLUIDOS' | 'NO_INCLUIDOS', effectiveDate: fecha, valorJornal: nuevoJornal, valorHora: nuevaHora },
        update: { valorJornal: nuevoJornal, valorHora: nuevaHora },
      });
      guardados++;
    }

    // Derivar ropa/transporte/herramientas del nuevo ½ Oficial Albañil.
    const partidasActualizadas = await refrescarPartidasDesdeJornal(fecha);

    await recordAudit({ action: 'PARAMETER_CHANGE', entity: 'parameter', newData: { tipo: 'jornales_construccion_ajuste', porcentaje, effectiveDate, guardados, partidasActualizadas }, req });
    res.json({ guardados, partidasActualizadas, porcentaje });
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
