import pg from 'pg';
import 'dotenv/config';

// Les dates SQL (type DATE) restent des chaînes « AAAA-MM-JJ » : pas de décalage de fuseau.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://suivi:suivi@localhost:5432/suivi_migration',
  max: 10,
});

export const query = (text, params) => pool.query(text, params);

/** Exécute fn(client) dans une transaction : tout est enregistré, ou rien. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
