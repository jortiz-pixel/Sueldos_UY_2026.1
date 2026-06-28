import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AttachmentType } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { authenticate } from '../middleware/auth';
import { assertCompanyAccess } from '../middleware/tenancy';
import { storageService, safeFileName } from '../services/storage.service';
import { AppError, NotFoundError } from '../middleware/errorHandler';

export const attachmentsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
]);

const OWNER_TYPES = new Set(['PERSONA', 'EMPRESA', 'CONTRATO']);

// POST /api/attachments  (multipart/form-data, campo "file")
const uploadSchema = z.object({
  companyId: z.string().min(1),
  ownerType: z.string().min(1),
  ownerId: z.string().min(1),
  tipo: z.nativeEnum(AttachmentType).default(AttachmentType.OTRO),
  vencimiento: z.string().optional(),
});

attachmentsRouter.post('/', authenticate, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = uploadSchema.parse(req.body);
    if (!OWNER_TYPES.has(data.ownerType)) throw new AppError(400, 'ownerType inválido');
    await assertCompanyAccess(req, data.companyId);

    const file = req.file;
    if (!file) throw new AppError(400, 'Archivo requerido (campo "file")');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new AppError(415, 'Tipo de archivo no permitido (solo imágenes o PDF)');
    }

    const key = `${data.companyId}/${data.ownerType}/${data.ownerId}/${randomUUID()}_${safeFileName(file.originalname)}`;
    await storageService.save(key, file.buffer);

    const attachment = await prisma.attachment.create({
      data: {
        companyId: data.companyId,
        ownerType: data.ownerType,
        ownerId: data.ownerId,
        tipo: data.tipo,
        fileName: file.originalname,
        mimeType: file.mimetype,
        storageKey: key,
        tamano: file.size,
        vencimiento: data.vencimiento ? new Date(data.vencimiento) : null,
        uploadedById: req.user!.userId,
      },
    });
    res.status(201).json(attachment);
  } catch (err) { next(err); }
});

// GET /api/attachments?companyId=&ownerType=&ownerId=  → metadatos
attachmentsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const companyId = String(req.query.companyId ?? '');
    const ownerType = String(req.query.ownerType ?? '');
    const ownerId = String(req.query.ownerId ?? '');
    if (!companyId || !ownerType || !ownerId) throw new AppError(400, 'companyId, ownerType y ownerId requeridos');
    await assertCompanyAccess(req, companyId);

    const attachments = await prisma.attachment.findMany({
      where: { companyId, ownerType, ownerId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(attachments);
  } catch (err) { next(err); }
});

// GET /api/attachments/:id/download  → contenido del archivo
attachmentsRouter.get('/:id/download', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!attachment) throw new NotFoundError('Adjunto');
    await assertCompanyAccess(req, attachment.companyId);

    const buffer = await storageService.read(attachment.storageKey);
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

// DELETE /api/attachments/:id
attachmentsRouter.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!attachment) throw new NotFoundError('Adjunto');
    await assertCompanyAccess(req, attachment.companyId);

    await storageService.remove(attachment.storageKey).catch(() => { /* archivo ya ausente: continuar */ });
    await prisma.attachment.delete({ where: { id: attachment.id } });
    res.json({ message: 'Adjunto eliminado' });
  } catch (err) { next(err); }
});
