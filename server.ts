import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { ENV } from './server/config/env';
import { getDb } from './server/db/sqlite';
import { apiRateLimiter, securityHeadersMiddleware } from './server/middleware/security';
import { createApiRouter } from './server/routes/api';
import { initRealtimeServer } from './server/services/realtime';
import { startTier1LocalCollector } from './server/services/tier1LocalCollector';

async function startServer() {
  getDb();

  const app = express();
  const httpServer = http.createServer(app);

  app.set('trust proxy', 1);
  app.use(securityHeadersMiddleware);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (ENV.ALLOWED_ORIGINS.length === 0 || ENV.ALLOWED_ORIGINS.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, true);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRateLimiter);
  app.use('/api', createApiRouter());

  initRealtimeServer(httpServer);
  startTier1LocalCollector();

  if (ENV.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(ENV.PORT, '0.0.0.0', () => {
    console.log(`CICADA 2026 Smart Observability server listening on http://0.0.0.0:${ENV.PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start CICADA server:', err);
  process.exit(1);
});
