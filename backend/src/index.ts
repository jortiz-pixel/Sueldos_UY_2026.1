import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { authRouter } from './routes/auth.routes';
import { companiesRouter } from './routes/companies.routes';
import { employeesRouter } from './routes/employees.routes';
import { liquidationRouter } from './routes/liquidation.routes';
import { parametersRouter } from './routes/parameters.routes';
import { reportsRouter } from './routes/reports.routes';
import { catalogsRouter } from './routes/catalogs.routes';
import { conceptsRouter } from './routes/concepts.routes';
import { contractsRouter } from './routes/contracts.routes';
import { membershipsRouter, entitlementsRouter } from './routes/memberships.routes';
import { attachmentsRouter } from './routes/attachments.routes';
import { calendarRouter } from './routes/calendar.routes';
import { importRouter } from './routes/import.routes';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intente nuevamente más tarde.' },
});
app.use('/api/', limiter);

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', {
  stream: { write: (message) => logger.http(message.trim()) },
}));

app.use('/api/auth', authRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/contracts', contractsRouter);
app.use('/api/liquidation', liquidationRouter);
app.use('/api/parameters', parametersRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/catalogs', catalogsRouter);
app.use('/api/concepts', conceptsRouter);
app.use('/api/memberships', membershipsRouter);
app.use('/api/entitlements', entitlementsRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/import', importRouter);

const APP_VERSION = process.env.APP_VERSION || 'dev';
const APP_BUILT_AT = process.env.APP_BUILT_AT || null;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: APP_VERSION, builtAt: APP_BUILT_AT });
});

// Versión desplegada (pública, sin auth) para el indicador del frontend.
app.get('/api/version', (_req, res) => {
  res.json({ version: APP_VERSION, builtAt: APP_BUILT_AT });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Sueldos UY server corriendo en puerto ${PORT}`);
  logger.info(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
});

export { app };
