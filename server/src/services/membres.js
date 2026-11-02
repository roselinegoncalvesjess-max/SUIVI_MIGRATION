/**
 * Rapprochement entre le libellé de la colonne « Responsable » et les membres connus.
 * Règle : libellé identique à un alias, ou bien tous les mots du libellé (au moins deux)
 * figurent dans le nom complet du membre.
 * Ex. « Djereke Davila » ↔ « Mme KOUAKOU ABLIMAN THERESE D'AVILA epse DJEREKE ».
 */
import { pool } from '../db.js';

export function normaliser(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’'`]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export class Rapprochement {
  constructor(membres, alias) {
    this.membres = membres.map((m) => ({ id: m.id, mots: new Set(normaliser(m.nom_complet).split(' ')) }));
    this.alias = new Map(alias.map((a) => [normaliser(a.libelle), a.membre_id]));
  }

  static async charger(client = pool) {
    const { rows: membres } = await client.query('SELECT id, nom_complet FROM membre WHERE actif');
    const { rows: alias } = await client.query(
      'SELECT a.libelle, a.membre_id FROM alias_membre a JOIN membre m ON m.id = a.membre_id WHERE m.actif');
    return new Rapprochement(membres, alias);
  }

  /** Renvoie l'id du membre, ou null. */
  trouver(libelle) {
    const n = normaliser(libelle);
    if (!n) return null;
    if (this.alias.has(n)) return this.alias.get(n);
    const mots = n.split(' ');
    if (mots.length < 2) return null;
    const candidats = this.membres.filter((m) => mots.every((t) => m.mots.has(t)));
    return candidats.length === 1 ? candidats[0].id : null;
  }
}

/** Relie à nouveau les sites aux membres (après ajout d'un membre ou d'un alias). */
export async function rapprocherTout(importId = null) {
  const r = await Rapprochement.charger();
  const { rows } = await pool.query(
    `SELECT id, responsable_libelle, responsable_id FROM suivi_site
     WHERE responsable_libelle <> '' AND ($1::int IS NULL OR import_id = $1)`, [importId]);
  let n = 0;
  for (const s of rows) {
    const m = r.trouver(s.responsable_libelle);
    if (m !== s.responsable_id) {
      await pool.query('UPDATE suivi_site SET responsable_id = $1 WHERE id = $2', [m, s.id]);
      n++;
    }
  }
  return n;
}
