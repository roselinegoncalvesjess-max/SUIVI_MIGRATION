import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import { query } from './db.js';

/** Construit l'application Express. `notifier` relaie les événements temps réel. */
export function creerApp({ notifier } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/sante', async (req, res) => {
    await query('SELECT 1');
    res.json({ ok: true });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api', apiRoutes(notifier));

  // En production, le serveur peut aussi servir l'interface React construite (client/dist).
  const dist = process.env.CLIENT_DIST;
  if (dist && existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api|\/socket\.io).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ erreur: 'Fichier trop volumineux (20 Mo maximum).' });
    console.error(err);
    res.status(500).json({ erreur: 'Erreur interne du serveur.' });
  });
  return app;
}
