/**
 * Référentiel des dépôts mSupply par district et par région : liste exportée du tableau de bord mSupply, qui recense TOUS
 * les sites en service (version commerciale et nouveaux sites déjà déployés sur Open mSupply). Les sites à migrer d'un
 * district = ses dépôts moins les nouveaux sites qui y figurent (`effectifsAMigrer`).
 *
 * Fichier attendu (première feuille) : une ligne d'en-tête avec « Nom du dépôt », « District » et « Région »
 * (« Catégorie » facultative). Les régions et districts sont ramenés à leurs noms officiels (officiel.js) ;
 * une ligne dont le district n'est pas un district sanitaire connu est ignorée et signalée.
 * Un seul référentiel est conservé : un nouveau fichier remplace le précédent. Les lignes en double
 * (même nom, même district) sont conservées : ce peuvent être des dépôts distincts d'un même établissement.
 */
import ExcelJS from 'exceljs';
import { query, transaction } from '../db.js';
import { ErreurImport, texte } from './importer.js';
import { normaliser } from './membres.js';
import { districtOfficiel, regionOfficielle } from './officiel.js';
import { contexteNouveaux, indexer, trouveProche } from './classementNouveaux.js';

const COLONNES = {
  'nom du depot': 'nom', 'depot': 'nom', 'nom': 'nom', 'categorie': 'categorie', 'district': 'district', 'region': 'region',
  'type de structure': 'type', 'type structure': 'type',
};
const propre = (v) => texte(v).replace(/\s+/g, ' ');

export async function lireListeDepots(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ErreurImport('Fichier illisible : ce n\'est pas un classeur Excel (.xlsx) valide.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ErreurImport('Le classeur ne contient aucune feuille.');
  const lignes = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => { lignes[n - 1] = row.values.slice(1); });
  for (let i = 0; i < lignes.length; i++) lignes[i] = lignes[i] || [];

  const entete = lignes.slice(0, 30).findIndex((l) => {
    const s = new Set(l.map((c) => COLONNES[normaliser(texte(c))]));
    return s.has('nom') && s.has('district') && s.has('region');
  });
  if (entete < 0) throw new ErreurImport('Ligne d\'en-tête introuvable (colonnes « Nom du dépôt », « District » et « Région »).');
  const index = {};
  lignes[entete].forEach((c, i) => {
    const cle = COLONNES[normaliser(texte(c))];
    if (cle && index[cle] === undefined) index[cle] = i;
  });

  const depots = [];
  const inconnus = new Map();
  const regionsCorrigees = new Map();
  let ecritures = 0;
  let sansCategorie = 0;
  let lus = 0;
  for (const l of lignes.slice(entete + 1)) {
    const nom = propre(l[index.nom]);
    if (!nom) continue;
    lus++;
    const districtFichier = propre(l[index.district]);
    const regionFichier = propre(l[index.region]);
    const d = districtOfficiel(districtFichier);
    if (!d) { inconnus.set(districtFichier || '(vide)', (inconnus.get(districtFichier || '(vide)') || 0) + 1); continue; }
    if (regionOfficielle(regionFichier) !== d.region) {
      const cle = `${d.district} : « ${regionFichier || 'vide'} » dans le fichier, ${d.region} d'après la carte`;
      regionsCorrigees.set(cle, (regionsCorrigees.get(cle) || 0) + 1);
    } else if (regionFichier !== d.region || districtFichier !== d.district) ecritures++;
    let categorie = index.categorie === undefined ? '' : propre(l[index.categorie]);
    if (!categorie || normaliser(categorie) === 'none') { categorie = ''; sansCategorie++; }
    const type = index.type === undefined ? '' : propre(l[index.type]).toUpperCase();
    depots.push({ nom, categorie, type, region: d.region, district: d.district });
  }
  if (!lus) throw new ErreurImport('Aucun dépôt trouvé sous la ligne d\'en-tête.');
  if (!depots.length) throw new ErreurImport('Aucun district du fichier ne correspond à un district sanitaire connu.');

  const avertissements = [];
  for (const [nom, n] of inconnus) avertissements.push(`District « ${nom} » inconnu : ${n} dépôt(s) ignoré(s).`);
  for (const [cle, n] of regionsCorrigees) avertissements.push(`${cle} : ${n} dépôt(s) rattaché(s) à la région de la carte.`);
  const vus = new Map();
  for (const d of depots) { const k = `${normaliser(d.nom)}|${d.district}`; vus.set(k, (vus.get(k) || 0) + 1); }
  const doubles = [...vus].filter(([, n]) => n > 1);
  if (doubles.length) {
    const exemples = doubles.slice(0, 3).map(([k, n]) => `${depots.find((d) => `${normaliser(d.nom)}|${d.district}` === k).nom} ×${n}`).join(', ');
    avertissements.push(`${doubles.length} nom(s) de dépôt en double dans un même district (${doubles.reduce((s, [, n]) => s + n - 1, 0)} ligne(s) en trop si ce sont des doublons) : ${exemples}…`);
  }
  if (ecritures) avertissements.push(`${ecritures} dépôt(s) avec une région ou un district écrit autrement que le nom officiel : ramené au nom officiel.`);
  if (sansCategorie) avertissements.push(`${sansCategorie} dépôt(s) sans catégorie.`);
  return { depots, avertissements };
}

export async function importerReferentiel(buffer, nomFichier, utilisateurId = null) {
  const { depots, avertissements } = await lireListeDepots(buffer);
  return transaction(async (c) => {
    await c.query('DELETE FROM referentiel_import'); // supprime aussi les dépôts de l'ancien référentiel
    const { rows: [imp] } = await c.query(
      `INSERT INTO referentiel_import (nom_fichier, importe_par, nb_depots, avertissements)
       VALUES ($1, $2, $3, $4) RETURNING *`, [nomFichier, utilisateurId, depots.length, JSON.stringify(avertissements)]);
    for (let i = 0; i < depots.length; i += 500) {
      const lot = depots.slice(i, i + 500);
      const p = [];
      const valeurs = lot.map((d, j) => { p.push(imp.id, d.nom, d.categorie, d.type, d.region, d.district); return `(${[1, 2, 3, 4, 5, 6].map((k) => `$${j * 6 + k}`).join(',')})`; });
      await c.query(`INSERT INTO referentiel_depot (import_id, nom, categorie, type_structure, region, district) VALUES ${valeurs.join(',')}`, p);
    }
    return { import: imp, avertissements };
  });
}

/** Nombre de dépôts par région et district officiels ([] si aucun référentiel n'est chargé). */
export async function effectifs() {
  const { rows } = await query('SELECT region, district, COUNT(*)::int AS n FROM referentiel_depot GROUP BY region, district');
  return rows;
}

/**
 * Dépôts À MIGRER par région et district : ceux du référentiel (tous les sites en service) moins les nouveaux sites qui y
 * figurent (liste des nouveaux sites, et nouveaux sites de l'extrait `importId`), déjà déployés sur Open mSupply.
 * `n` = à migrer, `nouveaux` = nouveaux sites retirés. [] si aucun référentiel n'est chargé.
 */
export async function effectifsAMigrer(importId = null) {
  const { rows: ref } = await query('SELECT nom, region, district FROM referentiel_depot');
  if (!ref.length) return [];
  // Nouveaux sites : liste (sans les corrections « ancien site ») + corrections « nouveau site » + nouveaux de l'extrait
  const { sites: liste } = await contexteNouveaux();
  const { rows: extrait } = importId === null ? { rows: [] } : await query(
    `SELECT si.nom, d.nom AS district FROM suivi_site s JOIN site si ON si.id = s.site_id JOIN district d ON d.id = si.district_id
     WHERE s.import_id = $1 AND s.type_site = 'NOUVEAU'`, [importId]);
  const nouveaux = indexer([...liste, ...extrait]);
  const parZone = new Map();
  for (const r of ref) {
    const cle = `${r.region}|${r.district}`;
    if (!parZone.has(cle)) parZone.set(cle, { region: r.region, district: r.district, n: 0, nouveaux: 0 });
    const z = parZone.get(cle);
    if (trouveProche(nouveaux, r)) z.nouveaux++; else z.n++;
  }
  return [...parZone.values()];
}

/** Référentiel en vigueur : fichier, date, total et détail par région (null si aucun). */
export async function referentielActuel() {
  const { rows: [imp] } = await query(
    `SELECT r.*, u.nom AS importe_par_nom FROM referentiel_import r LEFT JOIN utilisateur u ON u.id = r.importe_par ORDER BY r.id DESC LIMIT 1`);
  if (!imp) return null;
  const { rows: regions } = await query(
    `SELECT region, COUNT(*)::int AS depots, COUNT(DISTINCT district)::int AS districts
     FROM referentiel_depot WHERE import_id = $1 GROUP BY region ORDER BY depots DESC, region`, [imp.id]);
  const { rows: types } = await query(
    `SELECT type_structure AS type, COUNT(*)::int AS n FROM referentiel_depot
     WHERE import_id = $1 AND type_structure <> '' GROUP BY 1 ORDER BY 2 DESC, 1`, [imp.id]);
  return { ...imp, regions, types };
}
