import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
dotenv.config(); // also check current directory

import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import path from 'path';

import { setIO } from './socket';
import { logger } from './lib/logger';
import authRoutes from './routes/auth';
import studentRoutes from './routes/students';
import teacherRoutes from './routes/teachers';
import templateRoutes from './routes/templates';
import logRoutes from './routes/logs';
import exitRoutes from './routes/exits';
import whatsappRoutes from './routes/whatsapp';
import settingsRoutes from './routes/settings';
import { getWhatsAppService } from './services/whatsapp.service';
import { loadTemplates } from './services/template.service';
import { startScheduler } from './services/scheduler.service';

const app = express();
const server = http.createServer(app);

const io = new IOServer(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173'],
    methods: ['GET', 'POST'],
  },
});

setIO(io);

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
}));
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/exits', exitRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/settings', settingsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Socket.IO connection
io.on('connection', (socket) => {
  logger.debug({ socketId: socket.id }, 'socket client connected');
  socket.on('disconnect', () => {
    logger.debug({ socketId: socket.id }, 'socket client disconnected');
  });
});

const PORT = parseInt(process.env.PORT || '3000');

async function start() {
  logger.info(
    {
      port: PORT,
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL ? 'set' : 'NOT SET',
    },
    'starting server',
  );

  server.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'server listening');
  });

  // Load message templates into cache (non-blocking)
  try {
    await loadTemplates();
    logger.info('templates loaded');
  } catch (error) {
    logger.error({ err: error }, 'failed to load templates');
  }

  // Connect WhatsApp (non-blocking)
  try {
    const wa = getWhatsAppService();
    wa.connect().catch(err => logger.error({ err }, 'whatsapp initial connection error'));
  } catch (error) {
    logger.error({ err: error }, 'whatsapp startup error');
  }

  // Start reminder/escalation scheduler
  startScheduler();
}

start().catch(err => logger.fatal({ err }, 'server startup failed'));
