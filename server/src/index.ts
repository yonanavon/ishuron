import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import path from 'path';

import { setIO } from './socket';
import authRoutes from './routes/auth';
import studentRoutes from './routes/students';
import teacherRoutes from './routes/teachers';
import templateRoutes from './routes/templates';
import logRoutes from './routes/logs';
import exitRoutes from './routes/exits';
import whatsappRoutes from './routes/whatsapp';
import { getWhatsAppService } from './services/whatsapp.service';
import { loadTemplates } from './services/template.service';

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
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = parseInt(process.env.PORT || '3000');

async function start() {
  // Load message templates into cache
  await loadTemplates();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Connect WhatsApp (non-blocking)
  try {
    const wa = getWhatsAppService();
    wa.connect().catch(err => console.error('WhatsApp initial connection error:', err));
  } catch (error) {
    console.error('WhatsApp startup error:', error);
  }
}

start().catch(console.error);
