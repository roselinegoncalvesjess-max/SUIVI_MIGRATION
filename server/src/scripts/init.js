// Initialise le projet : équipe SI (+ alias) et compte administrateur.
// Usage : node src/scripts/init.js [identifiant_admin] [mot_de_passe_admin]
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';
import { migrer } from './migrate.js';

export const EQUIPE_SI = [
  ["Mme KOUAKOU ABLIMAN THERESE D'AVILA epse DJEREKE", ['Djereke Davila']],
  ['GONCALVES JESSICA', []],
  ['TEKI JOEL ACHI FABIEN', []],
  ['SIE AMAN NINA', []],
  ['GUEI CHRISTIAN RICHARD DESGUEYES', []],
];

export async function initialiser({ admin, motDePasse, silencieux = false } = {}) {
  await migrer({ silencieux });
  for (const [nom, alias] of EQUIPE_SI) {
    const { rows: [m] } = await pool.query(
      `INSERT INTO membre (nom_complet, equipe) VALUES ($1, 'SI')
       ON CONFLICT (nom_complet) DO UPDATE SET equipe = 'SI' RETURNING id`, [nom]);
    for (const a of alias) {
      await pool.query('INSERT INTO alias_membre (membre_id, libelle) VALUES ($1, $2) ON CONFLICT (libelle) DO NOTHING', [m.id, a]);
    }
    if (!silencieux) console.log(`• ${nom}`);
  }
  if (admin && motDePasse) {
    await pool.query(
      `INSERT INTO utilisateur (identifiant, nom, mot_de_passe, role) VALUES ($1, $1, $2, 'admin')
       ON CONFLICT (identifiant) DO UPDATE SET mot_de_passe = EXCLUDED.mot_de_passe, role = 'admin', actif = TRUE`,
      [admin, await bcrypt.hash(motDePasse, 10)]);
    if (!silencieux) console.log(`Compte administrateur « ${admin} » prêt.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [admin = process.env.ADMIN_IDENTIFIANT, motDePasse = process.env.ADMIN_MOT_DE_PASSE] = process.argv.slice(2);
  initialiser({ admin, motDePasse }).then(() => pool.end()).catch((e) => { console.error(e.message); process.exit(1); });
}
