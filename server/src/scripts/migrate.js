// Applique les fichiers sql/NNN_*.sql qui ne l'ont pas encore été.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from '../db.js';

const dossier = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../sql');

export async function migrer({ silencieux = false } = {}) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (fichier TEXT PRIMARY KEY, applique_le TIMESTAMPTZ DEFAULT now())');
  const faits = new Set((await pool.query('SELECT fichier FROM schema_migrations')).rows.map((r) => r.fichier));
  for (const f of (await readdir(dossier)).filter((f) => f.endsWith('.sql')).sort()) {
    if (faits.has(f)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile(path.join(dossier, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations (fichier) VALUES ($1)', [f]);
      await client.query('COMMIT');
      if (!silencieux) console.log(`✔ ${f}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Échec de ${f} : ${e.message}`);
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrer().then(() => pool.end()).catch((e) => { console.error(e.message); process.exit(1); });
}
