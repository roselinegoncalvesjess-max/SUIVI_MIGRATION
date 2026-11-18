/**
 * Corrections manuelles sur des sites (table correction_site), saisies par un administrateur ; elles l'emportent sur
 * les fichiers (extrait de la DAP, liste des nouveaux sites, tableau de bord mSupply). Leur effet est appliqué par
 * classementNouveaux.js (nouveaux sites), referentiel.js (sites à migrer), statistiques.js (migrés hors extrait)
 * et, sur les imports déjà faits, par scripts/reclasser.js (`appliquerCorrectionsBase`).
 */
import { query } from '../db.js';
import { ErreurImport } from './importer.js';
import { districtOfficiel } from './officiel.js';

export const DECISIONS = {
  MIGRE: 'Migré vers Open mSupply',
  ANCIEN: 'Ancien site mSupply (pas un nouveau site)',
  NOUVEAU: 'Nouveau site à déployer sur Open mSupply',
};

export async function listeCorrections() {
  const { rows } = await query(
    `SELECT c.*, u.nom AS cree_par_nom FROM correction_site c LEFT JOIN utilisateur u ON u.id = c.cree_par
     ORDER BY c.decision, c.region, c.district, c.nom`);
  return rows;
}

/** Ajoute (ou remplace, même nom et même district) une correction. */
export async function enregistrerCorrection({ nom, district, decision, note = '' }, utilisateurId = null) {
  const n = String(nom ?? '').trim().replace(/\s+/g, ' ');
  if (!n) throw new ErreurImport('Indiquez le nom du site.');
  const d = districtOfficiel(district);
  if (!d) throw new ErreurImport(`District « ${district ?? ''} » inconnu.`);
  if (!DECISIONS[decision]) throw new ErreurImport('Décision inconnue (MIGRE, ANCIEN ou NOUVEAU).');
  const { rows: [c] } = await query(
    `INSERT INTO correction_site (nom, region, district, decision, note, cree_par) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (district, nom) DO UPDATE SET decision = EXCLUDED.decision, note = EXCLUDED.note,
       cree_par = EXCLUDED.cree_par, cree_le = now()
     RETURNING *`, [n, d.region, d.district, decision, String(note ?? '').trim(), utilisateurId]);
  return c;
}

export async function supprimerCorrection(id) {
  const { rowCount } = await query('DELETE FROM correction_site WHERE id = $1', [id]);
  return rowCount > 0;
}
