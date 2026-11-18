// Recalcule des classements d'après les règles du code (à lancer après une évolution des règles : npm run reclasser) :
//  - régions et districts de la base, ramenés à la géographie officielle (services/corrigerZones.js) ;
//  - catégorie des sites « À classer » (services/categories.js) ;
//  - type « nouveau site » des sites de l'extrait (services/classementNouveaux.js) ; les compteurs des imports sont recalculés.
// Les classements déjà connus ne changent pas (sauf migration → nouveau site).
import { fileURLToPath } from 'node:url';
import { pool, transaction } from '../db.js';
import { corrigerZones } from '../services/corrigerZones.js';
import { categorieDuNom } from '../services/categories.js';
import { contexteNouveaux, raisonNouveau, trouveProche } from '../services/classementNouveaux.js';
import { districtOfficiel } from '../services/officiel.js';

/** Renvoie le nombre de sites reclassés (tous les imports, historique compris). */
export async function reclasser() {
  const { rows } = await pool.query(
    `SELECT DISTINCT si.id, si.nom FROM suivi_site s JOIN site si ON si.id = s.site_id WHERE s.categorie = 'A_CLASSER'`);
  let n = 0;
  for (const s of rows) {
    const categorie = categorieDuNom(s.nom);
    if (categorie === 'A_CLASSER') continue;
    await pool.query(`UPDATE suivi_site SET categorie = $2 WHERE site_id = $1 AND categorie = 'A_CLASSER'`, [s.id, categorie]);
    n++;
  }
  return n;
}

/**
 * Applique aux imports existants les règles des nouveaux sites et les corrections manuelles (ancien site → migration,
 * nouveau site → nouveau, migré → « Terminé ») ; recalcule les compteurs. Renvoie le nombre de lignes modifiées.
 */
export async function reclasserNouveaux() {
  const ctx = await contexteNouveaux();
  const { rows } = await pool.query(
    `SELECT s.id, si.nom, d.nom AS district, s.commentaires, s.type_site, s.statut FROM suivi_site s
     JOIN site si ON si.id = s.site_id JOIN district d ON d.id = si.district_id`);
  const versNouveau = [];
  const versMigration = [];
  const versTermine = [];
  for (const r of rows) {
    const s = { nom: r.nom, district: districtOfficiel(r.district)?.district ?? r.district, commentaires: r.commentaires };
    if (trouveProche(ctx.anciens, s)) {
      if (r.type_site === 'NOUVEAU') versMigration.push(r.id);
    } else if (r.type_site === 'MIGRATION' && (trouveProche(ctx.forces, s) || raisonNouveau(s, ctx))) versNouveau.push(r.id);
    if (r.statut !== 'TERMINE' && trouveProche(ctx.migres, s)) versTermine.push(r.id);
  }
  if (versNouveau.length) await pool.query(`UPDATE suivi_site SET type_site = 'NOUVEAU' WHERE id = ANY($1::int[])`, [versNouveau]);
  if (versMigration.length) await pool.query(`UPDATE suivi_site SET type_site = 'MIGRATION' WHERE id = ANY($1::int[])`, [versMigration]);
  if (versTermine.length) await pool.query(`UPDATE suivi_site SET statut = 'TERMINE' WHERE id = ANY($1::int[])`, [versTermine]);
  const ids = [...versNouveau, ...versMigration, ...versTermine];
  await pool.query(
    `UPDATE import_extrait i SET
       nb_sites = (SELECT count(*) FROM suivi_site s WHERE s.import_id = i.id AND s.type_site = 'MIGRATION'),
       nb_termines = (SELECT count(*) FROM suivi_site s WHERE s.import_id = i.id AND s.type_site = 'MIGRATION' AND s.statut = 'TERMINE'),
       nb_en_cours = (SELECT count(*) FROM suivi_site s WHERE s.import_id = i.id AND s.type_site = 'MIGRATION' AND s.statut = 'EN_COURS'),
       nb_non_demarres = (SELECT count(*) FROM suivi_site s WHERE s.import_id = i.id AND s.type_site = 'MIGRATION' AND s.statut NOT IN ('TERMINE', 'EN_COURS')),
       nb_nouveaux = (SELECT count(*) FROM suivi_site s WHERE s.import_id = i.id AND s.type_site = 'NOUVEAU'),
       nb_nouveaux_deployes = (SELECT count(*) FROM suivi_site s WHERE s.import_id = i.id AND s.type_site = 'NOUVEAU' AND s.statut = 'TERMINE')`);
  return ids.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const z = await transaction((c) => corrigerZones(c));
    console.log(`Zones : ${z.deplaces} district(s) déplacé(s), ${z.fusionnes} fusionné(s), ${z.regionsSupprimees} région(s) vide(s) supprimée(s).`);
    console.log(`${await reclasser()} site(s) reclassé(s) en catégorie.`);
    console.log(`${await reclasserNouveaux()} ligne(s) modifiée(s) (nouveaux sites et corrections manuelles).`);
    await pool.end();
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
