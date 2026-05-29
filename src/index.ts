import 'dotenv/config';

// ── Validate env FIRST — before any other import that reads process.env ───────
import { validateEnv } from './utils/env';
validateEnv();

import express from 'express';
import cors from 'cors';
import dns from 'node:dns/promises';
import connectDB from './config/db';
import { initBot } from './bot/telegram';
import { requireApiKey } from './middleware/authorization';
import logger from './utils/logger';
import knowledgeRoutes from './routes/knowledge';
import chatRoutes from './routes/chat';
import studentRoutes from './routes/students';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin:       process.env.FRONTEND_URL || '*',
  methods:      ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────

// Public routes
app.use('/api/chat', chatRoutes);

// Protected routes — require Authorization: Bearer <ADMIN_API_KEY>
app.use('/api/students',  requireApiKey, studentRoutes);
app.use('/api/knowledge', requireApiKey, knowledgeRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'SchoolBridge API is running 🏫🚀' });
});

// Health check — Render uses this to confirm the app is ready before routing traffic
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Must have exactly 4 params for Express to recognise it as error middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled HTTP error');
  const status = (err as any).status ?? 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message
  });
});

// ── Startup ───────────────────────────────────────────────────────────────────

const main = async () => {
  // 1. Connect DB first
  await connectDB();

  // 2. Start the bot only after DB is ready
  //    - production  → webhook (no polling conflicts on Render)
  //    - development → polling (works locally without ngrok)
  await initBot(app);

  // 3. Start Express
  app.listen(PORT, () => {
    logger.info(
      { port: PORT, env: process.env.NODE_ENV || 'development' },
      'SchoolBridge is running'
    );
  });
};

main().catch((err) => {
  logger.error({ err }, 'Startup failed');
  process.exit(1);
});