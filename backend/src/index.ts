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
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

// =============================================================
// Security middleware
// =============================================================
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

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intente nuevamente más tarde.' },
});
app.use('/api/', limiter);

// =============================================================
// General middleware
// =============================================================
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', {
  stream: { write: (message) => logger.http(message.trim()) },
}));

// =============================================================
// Routes
// =============================================================
app.use('/api/auth', authRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/liquidation', liquidationRouter);
app.use('/api/parameters', parametersRouter);
app.use('/api/reports', reportsRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

// Global error handler
app.use(errorHandler);

// =============================================================
// Start server
// =============================================================
app.listen(PORT, () => {
  logger.info(`Sueldos UY server corriendo en puerto ${PORT}`);
  logger.info(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
});

export { app };
