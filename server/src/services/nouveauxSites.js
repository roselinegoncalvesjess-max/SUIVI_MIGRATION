/**
 * Liste permanente des nouveaux sites (sans version commerciale mSupply, à déployer sur Open mSupply).
 *
 * Fichier attendu (première feuille) : une ligne d'en-tête avec « NOM D'ETABLISSEMENT », « DISTRICT » et « REGION »
 * (« RAISON », « STATUT » et « TYPE SITE » facultatives). Seules les lignes dont le STATUT vaut « OUI » ou « NOUVEAU SITE » (= statut
 * « nouveau ») sont retenues. Régions et districts sont ramenés aux noms officiels (officiel.js). Un autre tableau placé
 * à droite dans la même feuille (récapitulatif par DS) est ignoré : seules les colonnes reconnues par leur nom sont lues.
 * Un seul fichier est conservé : un nouveau fichier remplace le précédent.
 */
import ExcelJS from 'exceljs';
import { query, transaction } from '../db.js';
import { ErreurImport, texte } from './importer.js';
import { normaliser } from './membres.js';
import { districtOfficiel } from './officiel.js';
import { contexteNouveaux, indexer, trouveProche } from './classementNouveaux.js';

const COLONNES = {
  'nom detablissement': 'nom', 'nom de letablissement': 'nom', 'etablissement': 'nom', 'site': 'nom',
  'district': 'district', 'region': 'region', 'raison': 'raison', 'statut': 'statut', 'type site': 'equipement',
};
// District écrit sans numéro alors que la carte en a deux : rattaché au premier, avec avertissement
const AMBIGUS = { korhogo: 'KORHOGO 1' };
// STATUT « OUI » (ancienne version du fichier) ou « NOUVEAU SITE » (version actuelle)
const statutNouveau = (v) => { const n = normaliser(v); return n === 'oui' || n.startsWith('nouv'); };
const propre = (v) => texte(v).replace(/\s+/g, ' ');

export async function lireListeNouveaux(buffer) {
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
  if (entete < 0) throw new ErreurImport('Ligne d\'en-tête introuvable (colonnes « NOM D\'ETABLISSEMENT », « DISTRICT » et « REGION »).');
  const index = {};
  lignes[entete].forEach((c, i) => {
    const cle = COLONNES[normaliser(texte(c))];
    if (cle && index[cle] === undefined) index[cle] = i;
  });
  const val = (l, cle) => (index[cle] === undefined ? '' : propre(l[index[cle]]));

  const sites = [];
  const avertissements = [];
  const inconnus = new Map();
  const ambigus = new Map();
  let sansNom = 0;
  let pasNouveaux = 0;
  lignes.slice(entete + 1).forEach((l, k) => {
    const nom = val(l, 'nom');
    const brut = [val(l, 'district'), val(l, 'region'), val(l, 'raison')].some(Boolean);
    if (!nom) { if (brut) { sansNom++; avertissements.push(`Ligne ${entete + k + 2} sans nom d'établissement (${val(l, 'district') || '?'}) : ignorée.`); } return; }
    if (index.statut !== undefined && !statutNouveau(val(l, 'statut'))) { pasNouveaux++; return; }
    const district = val(l, 'district');
    const cle = normaliser(district);
    const d = districtOfficiel(AMBIGUS[cle] ?? district);
    if (!d) { inconnus.set(district || '(vide)', (inconnus.get(district || '(vide)') || 0) + 1); return; }
    if (AMBIGUS[cle]) ambigus.set(district, (ambigus.get(district) || 0) + 1);
    sites.push({ nom, region: d.region, district: d.district, raison: val(l, 'raison'), equipement: val(l, 'equipement').toUpperCase() });
  });
  if (!sites.length) throw new ErreurImport('Aucun nouveau site trouvé (lignes dont le STATUT vaut « OUI » ou « NOUVEAU SITE »).');

  for (const [nom, n] of inconnus) avertissements.push(`District « ${nom} » inconnu : ${n} site(s) ignoré(s).`);
  for (const [nom, n] of ambigus) avertissements.push(`District « ${nom} » ambigu (la carte a ${AMBIGUS[normaliser(nom)].replace(/ 1$/, '')} 1 et 2) : ${n} site(s) rattaché(s) à ${AMBIGUS[normaliser(nom)]}.`);
  if (pasNouveaux) avertissements.push(`${pasNouveaux} ligne(s) dont le STATUT n'est ni « OUI » ni « NOUVEAU SITE » : ignorée(s).`);
  const vus = new Map();
  for (const s of sites) vus.set(normaliser(s.nom), (vus.get(normaliser(s.nom)) || 0) + 1);
  const doubles = [...vus].filter(([, n]) => n > 1);
  if (doubles.length) avertissements.push(`${doubles.length} nom(s) d'établissement en double : ${doubles.slice(0, 3).map(([k, n]) => `${k} ×${n}`).join(', ')}…`);
  return { sites, avertissements };
}

export async function importerNouveaux(buffer, nomFichier, utilisateurId = null) {
  const { sites, avertissements } = await lireListeNouveaux(buffer);
  return transaction(async (c) => {
    await c.query('DELETE FROM nouveau_site_import'); // supprime aussi les sites de l'ancienne liste
    const { rows: [imp] } = await c.query(
      `INSERT INTO nouveau_site_import (nom_fichier, importe_par, nb_sites, avertissements)
       VALUES ($1, $2, $3, $4) RETURNING *`, [nomFichier, utilisateurId, sites.length, JSON.stringify(avertissements)]);
    for (let i = 0; i < sites.length; i += 500) {
      const lot = sites.slice(i, i + 500);
      const p = [];
      const valeurs = lot.map((s, j) => { p.push(imp.id, s.nom, s.region, s.district, s.raison, s.equipement); return `(${[1, 2, 3, 4, 5, 6].map((k) => `$${j * 6 + k}`).join(',')})`; });
      await c.query(`INSERT INTO nouveau_site (import_id, nom, region, district, raison, equipement) VALUES ${valeurs.join(',')}`, p);
    }
    return { import: imp, avertissements };
  });
}

/** Liste en vigueur : fichier, date, total et détail par région (null si aucune). */
export async function nouveauxActuels() {
  const { rows: [imp] } = await query(
    `SELECT i.*, u.nom AS importe_par_nom FROM nouveau_site_import i LEFT JOIN utilisateur u ON u.id = i.importe_par ORDER BY i.id DESC LIMIT 1`);
  if (!imp) return null;
  const { rows: regions } = await query(
    `SELECT region, COUNT(*)::int AS n, COUNT(DISTINCT district)::int AS districts
     FROM nouveau_site WHERE import_id = $1 GROUP BY region ORDER BY n DESC, region`, [imp.id]);
  const ctx = await contexteNouveaux();
  return { ...imp, regions, deja_deployes: ctx.deja };
}

/**
 * Sites de la liste à AJOUTER à l'extrait `importId` : ceux qui n'y figurent pas déjà (même district ; classés « nouveau
 * site » par classementNouveaux.js, pas de double compte). Un site qui figure dans le référentiel (tableau de bord mSupply)
 * est DÉJÀ DÉPLOYÉ (`deploye`). `parDistrict` / `parDistrictDeployes` : « région|district » → nombre.
 */
export async function nouveauxEnPlus(importId) {
  // Liste des nouveaux sites sans les corrections « ancien site », + corrections « nouveau site » (classementNouveaux.js)
  const ctx = await contexteNouveaux();
  const rows = ctx.sites;
  if (!rows.length) return { total: 0, deployes: 0, parDistrict: new Map(), parDistrictDeployes: new Map(), sites: [] };
  const { rows: deja } = await query(
    `SELECT si.nom, d.nom AS district FROM suivi_site s JOIN site si ON si.id = s.site_id JOIN district d ON d.id = si.district_id
     WHERE s.import_id = $1`, [importId]);
  const dansExtrait = indexer(deja);
  const deployes = new Set(ctx.deja.map((x) => `${x.district}|${normaliser(x.nom)}`));
  const sites = rows.filter((r) => !trouveProche(dansExtrait, r))
    .map((r) => ({ ...r, deploye: deployes.has(`${r.district}|${normaliser(r.nom)}`) }));
  const parDistrict = new Map();
  const parDistrictDeployes = new Map();
  for (const s of sites) {
    const cle = `${s.region}|${s.district}`;
    parDistrict.set(cle, (parDistrict.get(cle) || 0) + 1);
    if (s.deploye) parDistrictDeployes.set(cle, (parDistrictDeployes.get(cle) || 0) + 1);
  }
  return { total: sites.length, deployes: sites.filter((s) => s.deploye).length, parDistrict, parDistrictDeployes, sites };
}
