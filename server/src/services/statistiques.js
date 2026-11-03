/** Calculs de synthèse sur un import (par défaut, le dernier). */
import { query } from '../db.js';

// « sites », « migres », « en_cours », « non_demarres » ne concernent que les sites à MIGRER.
// Les nouveaux sites (déploiement direct sur Open mSupply) sont comptés à part.
const COMPTES = `
  COUNT(*) FILTER (WHERE s.type_site = 'MIGRATION')::int AS sites,
  COUNT(*) FILTER (WHERE s.type_site = 'MIGRATION' AND s.statut = 'TERMINE')::int AS migres,
  COUNT(*) FILTER (WHERE s.type_site = 'MIGRATION' AND s.statut = 'EN_COURS')::int AS en_cours,
  COUNT(*) FILTER (WHERE s.type_site = 'MIGRATION' AND s.statut = 'NON_DEMARRE')::int AS non_demarres,
  COUNT(*) FILTER (WHERE s.type_site = 'NOUVEAU')::int AS nouveaux,
  COUNT(*) FILTER (WHERE s.type_site = 'NOUVEAU' AND s.statut = 'TERMINE')::int AS nouveaux_deployes,
  COUNT(*) FILTER (WHERE s.type_site = 'NOUVEAU' AND s.statut = 'EN_COURS')::int AS nouveaux_en_cours`;

const JOINTURES = `
  FROM suivi_site s
  JOIN site si ON si.id = s.site_id
  JOIN district d ON d.id = si.district_id
  JOIN region r ON r.id = d.region_id`;

const CLES = ['sites', 'migres', 'en_cours', 'non_demarres', 'nouveaux', 'nouveaux_deployes', 'nouveaux_en_cours'];

export const taux = (migres, total) => (total ? Math.round((1000 * migres) / total) / 10 : 0);
const avecTaux = (l) => ({ ...l, taux: taux(l.migres, l.sites), complet: l.sites > 0 && l.migres === l.sites });

export async function dernierImport() {
  const { rows } = await query(
    `SELECT i.*, u.nom AS importe_par_nom FROM import_extrait i
     LEFT JOIN utilisateur u ON u.id = i.importe_par ORDER BY i.importe_le DESC, i.id DESC LIMIT 1`);
  return rows[0] || null;
}

export async function regionsEtDistricts(importId) {
  const { rows } = await query(
    `SELECT r.id AS region_id, r.nom AS region, d.id AS district_id, d.nom AS district, ${COMPTES},
       COALESCE(MIN(s.debut_mission), MIN(s.debut_reel)) AS debut_mission,
       COALESCE(MAX(s.fin_mission), MAX(s.fin_reelle) FILTER (WHERE s.statut = 'TERMINE')) AS fin_mission
     ${JOINTURES} WHERE s.import_id = $1 GROUP BY r.id, r.nom, d.id, d.nom`, [importId]);
  const regions = new Map();
  for (const l of rows) {
    if (!regions.has(l.region_id)) {
      regions.set(l.region_id, { id: l.region_id, nom: l.region, ...Object.fromEntries(CLES.map((k) => [k, 0])), districts: [] });
    }
    const r = regions.get(l.region_id);
    for (const k of CLES) r[k] += l[k];
    r.districts.push(avecTaux({ id: l.district_id, nom: l.district, debut_mission: l.debut_mission, fin_mission: l.fin_mission, ...Object.fromEntries(CLES.map((k) => [k, l[k]])) }));
  }
  const tri = (a, b) => b.sites - a.sites || a.nom.localeCompare(b.nom, 'fr');
  return [...regions.values()].map((r) => ({ ...avecTaux(r), districts: r.districts.sort(tri) })).sort(tri);
}

export async function objectifs() {
  const { rows } = await query('SELECT cle, valeur, libelle FROM parametre ORDER BY cle');
  const o = Object.fromEntries(rows.map((r) => [r.cle, r.valeur]));
  return { sites: o.objectif_sites || 0, districts: o.objectif_districts || 0, regions: o.objectif_regions || 0,
    nouveaux: o.objectif_nouveaux_sites || 0, detail: rows };
}

export async function synthese(imp) {
  const { rows: [t] } = await query(
    `SELECT ${COMPTES},
       COUNT(*) FILTER (WHERE s.statut <> 'TERMINE' AND s.date_prevue < CURRENT_DATE)::int AS en_retard,
       COUNT(*) FILTER (WHERE btrim(s.difficultes) <> '' AND upper(btrim(s.difficultes, ' .')) <> 'RAS')::int AS difficultes
     FROM suivi_site s WHERE s.import_id = $1`, [imp.id]);
  const regions = await regionsEtDistricts(imp.id);
  const districts = regions.flatMap((r) => r.districts);
  const { rows: [prec] } = await query(
    `SELECT nb_termines, nb_nouveaux_deployes FROM import_extrait WHERE (importe_le, id) < ($1, $2)
     ORDER BY importe_le DESC, id DESC LIMIT 1`, [imp.importe_le, imp.id]);
  const obj = await objectifs();
  return {
    ...avecTaux(t),
    // Taux national : sites migrés rapportés à l'objectif national (ex. 2 905 sites)
    objectif_sites: obj.sites,
    objectif_districts: obj.districts,
    objectif_regions: obj.regions,
    taux_national: taux(t.migres, obj.sites),
    sites_restants: Math.max(obj.sites - t.migres, 0),
    sites_hors_extrait: Math.max(obj.sites - t.sites, 0),
    // Nouveaux sites : déploiement direct sur Open mSupply
    objectif_nouveaux: obj.nouveaux,
    taux_nouveaux: taux(t.nouveaux_deployes, obj.nouveaux || t.nouveaux),
    // Tous les sites sur Open mSupply (migrés + nouveaux déployés)
    sites_open_msupply: t.migres + t.nouveaux_deployes,
    regions: regions.length,
    regions_touchees: regions.filter((r) => r.migres > 0).length,
    regions_completes: regions.filter((r) => r.complet).length,
    districts: districts.length,
    districts_touches: districts.filter((d) => d.migres > 0).length,
    districts_complets: districts.filter((d) => d.complet).length,
    evolution: prec ? imp.nb_termines - prec.nb_termines : null,
    evolution_nouveaux: prec ? imp.nb_nouveaux_deployes - prec.nb_nouveaux_deployes : null,
  };
}

export async function parVague(importId) {
  const { rows } = await query(
    `SELECT s.vague, ${COMPTES} FROM suivi_site s WHERE s.import_id = $1 GROUP BY s.vague ORDER BY s.vague NULLS LAST`, [importId]);
  return rows.map(avecTaux);
}

export async function parCategorie(importId) {
  const { rows } = await query(
    `SELECT s.categorie, ${COMPTES} FROM suivi_site s WHERE s.import_id = $1 GROUP BY s.categorie
     ORDER BY array_position(ARRAY['ESPC','DISTRICT_SANITAIRE','HOPITAL_REFERENCE','A_CLASSER']::categorie_site[], s.categorie)`, [importId]);
  return rows.map(avecTaux);
}

/**
 * Périodes de migration : une mission par district et par vague.
 * Début = « Début mission » saisi, sinon premier « Début réel » des sites ;
 * Fin   = « Fin mission » saisie, sinon dernière date de migration (fin réelle) des sites.
 */
export async function missions(importId) {
  const { rows } = await query(
    `SELECT r.nom AS region, d.id AS district_id, d.nom AS district, s.vague,
       COALESCE(MIN(s.debut_mission), MIN(s.debut_reel)) AS debut,
       COALESCE(MAX(s.fin_mission), MAX(s.fin_reelle) FILTER (WHERE s.statut = 'TERMINE')) AS fin,
       BOOL_OR(s.debut_mission IS NOT NULL OR s.fin_mission IS NOT NULL) AS dates_saisies,
       ${COMPTES}
     ${JOINTURES} WHERE s.import_id = $1
     GROUP BY r.nom, d.id, d.nom, s.vague
     ORDER BY COALESCE(MIN(s.debut_mission), MIN(s.debut_reel)) NULLS LAST, r.nom, d.nom`, [importId]);
  const jours = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1 : null);
  return rows.map((m) => ({ ...avecTaux(m), duree_jours: jours(m.debut, m.fin), terminee: m.sites + m.nouveaux > 0 && m.non_demarres === 0 && m.en_cours === 0 && m.nouveaux === m.nouveaux_deployes }));
}

export async function rythme(importId) {
  const cumul = async (champ, filtre) => {
    const { rows } = await query(
      `SELECT to_char(${champ}, 'YYYY-MM-DD') AS date, COUNT(*)::int AS n FROM suivi_site
       WHERE import_id = $1 AND ${champ} IS NOT NULL ${filtre} GROUP BY ${champ} ORDER BY ${champ}`, [importId]);
    let c = 0;
    return rows.map((r) => ({ date: r.date, cumul: (c += r.n) }));
  };
  return {
    reel: await cumul('fin_reelle', "AND statut = 'TERMINE' AND type_site = 'MIGRATION'"),
    prevu: await cumul('date_prevue', "AND type_site = 'MIGRATION'"),
    nouveaux: await cumul('fin_reelle', "AND statut = 'TERMINE' AND type_site = 'NOUVEAU'"),
  };
}

const SITES_COLONNES = `
  s.id, si.nom AS site, r.id AS region_id, r.nom AS region, d.id AS district_id, d.nom AS district, s.vague,
  s.type_site, s.categorie, s.responsable_libelle, s.responsable_id, m.nom_complet AS membre, s.statut,
  s.date_prevue, s.debut_reel, s.fin_reelle AS date_migration, s.debut_mission, s.fin_mission,
  s.version_msupply, s.commentaires, s.difficultes, si.latitude::float AS latitude, si.longitude::float AS longitude`;

export async function sites(importId, f = {}) {
  const cond = ['s.import_id = $1'];
  const p = [importId];
  // « ? » est remplacé par le numéro du paramètre ajouté
  const ajouter = (sql, v) => { p.push(v); cond.push(sql.replaceAll('?', `$${p.length}`)); };
  if (f.q) ajouter('(si.nom ILIKE ? OR d.nom ILIKE ? OR s.responsable_libelle ILIKE ?)', `%${f.q}%`);
  if (f.region) ajouter('r.id = ?', +f.region);
  if (f.district) ajouter('d.id = ?', +f.district);
  if (f.statut) ajouter('s.statut = ?', f.statut);
  if (f.vague) ajouter('s.vague = ?', +f.vague);
  if (f.type === 'MIGRATION' || f.type === 'NOUVEAU') ajouter('s.type_site = ?::type_site', f.type);
  if (['ESPC', 'DISTRICT_SANITAIRE', 'HOPITAL_REFERENCE', 'A_CLASSER'].includes(f.categorie)) ajouter('s.categorie = ?::categorie_site', f.categorie);
  if (f.retard === '1') cond.push("s.statut <> 'TERMINE' AND s.date_prevue < CURRENT_DATE");
  const { rows } = await query(
    `SELECT ${SITES_COLONNES} ${JOINTURES} LEFT JOIN membre m ON m.id = s.responsable_id
     WHERE ${cond.join(' AND ')} ORDER BY r.nom, d.nom, si.nom`, p);
  return rows;
}

/**
 * Participation de l'équipe par DISTRICT : un membre est responsable de tous les sites
 * des districts qui lui sont rattachés, qu'il soit ou non inscrit comme « Responsable »
 * de chaque site. Districts d'un membre = affectations + districts où il est responsable
 * d'au moins un site dans l'import.
 */
export async function participationEquipe(importId, equipe = 'SI') {
  const { rows: membres } = await query(
    `SELECT m.id, m.nom_complet FROM membre m WHERE m.equipe = $1 AND m.actif ORDER BY m.nom_complet`, [equipe]);
  const { rows: liens } = await query(
    `SELECT a.membre_id, a.district_id, 'affectation' AS origine, NULL::text AS libelle, a.vague,
            a.debut_mission, a.fin_mission
       FROM affectation_district a JOIN membre m ON m.id = a.membre_id WHERE m.equipe = $2
     UNION ALL
     SELECT DISTINCT s.responsable_id, si.district_id, 'responsable', s.responsable_libelle, s.vague,
            NULL::date, NULL::date
       FROM suivi_site s JOIN site si ON si.id = s.site_id JOIN membre m ON m.id = s.responsable_id
      WHERE s.import_id = $1 AND m.equipe = $2`, [importId, equipe]);
  const { rows: districts } = await query(
    `SELECT d.id, d.nom, r.nom AS region, ${COMPTES},
       COALESCE(MIN(s.debut_mission), MIN(s.debut_reel)) AS debut_mission,
       COALESCE(MAX(s.fin_mission), MAX(s.fin_reelle) FILTER (WHERE s.statut = 'TERMINE')) AS fin_mission,
       COALESCE(array_agg(DISTINCT s.vague) FILTER (WHERE s.vague IS NOT NULL), '{}') AS vagues
     FROM district d JOIN region r ON r.id = d.region_id
     LEFT JOIN site si ON si.district_id = d.id
     LEFT JOIN suivi_site s ON s.site_id = si.id AND s.import_id = $1
     WHERE s.id IS NOT NULL OR d.id IN (SELECT district_id FROM affectation_district)
     GROUP BY d.id, d.nom, r.nom`, [importId]);
  const parId = new Map(districts.map((d) => [d.id, avecTaux({ ...d, vagues: d.vagues.sort((a, b) => a - b) })]));
  const uniques = (a) => [...new Set(a)].sort((x, y) => String(x).localeCompare(String(y), 'fr', { numeric: true }));

  return membres.map((m) => {
    const miens = liens.filter((l) => l.membre_id === m.id);
    const ids = uniques(miens.map((l) => l.district_id));
    const ds = ids.map((id) => {
      const l = miens.filter((x) => x.district_id === id);
      const d = parId.get(id);
      if (!d) return null;
      // Vague de participation : celle de l'affectation ou des sites dont il est responsable ;
      // à défaut, les vagues des sites du district.
      const vp = uniques(l.map((x) => x.vague).filter((v) => v !== null));
      // Période de la mission : dates saisies dans l'affectation, sinon celles du district
      const aff = l.find((x) => x.origine === 'affectation' && (x.debut_mission || x.fin_mission));
      return {
        ...d, origines: uniques(l.map((x) => x.origine)), vagues_participation: vp.length ? vp : d.vagues,
        debut_mission: aff?.debut_mission || d.debut_mission, fin_mission: aff?.fin_mission || d.fin_mission,
      };
    }).filter(Boolean).sort((a, b) => b.sites - a.sites || a.nom.localeCompare(b.nom, 'fr'));
    const somme = (k) => ds.reduce((n, d) => n + d[k], 0);
    const parVague = {}; // vague → nombre de sites des districts pris en charge dans cette vague
    ds.forEach((d) => d.vagues_participation.forEach((v) => { parVague[v] = (parVague[v] || 0) + d.sites; }));
    return {
      ...m,
      libelles: uniques(miens.filter((l) => l.libelle).map((l) => l.libelle)),
      districts: ds,
      ...avecTaux({ sites: somme('sites'), migres: somme('migres') }),
      en_cours: somme('en_cours'),
      non_demarres: somme('non_demarres'),
      nouveaux: somme('nouveaux'),
      nouveaux_deployes: somme('nouveaux_deployes'),
      vagues: uniques(ds.flatMap((d) => d.vagues_participation)),
      regions: uniques(ds.map((d) => d.region)),
      par_vague: parVague,
    };
  }).sort((a, b) => b.sites - a.sites || a.nom_complet.localeCompare(b.nom_complet, 'fr'));
}

export async function historique() {
  const { rows } = await query(
    `SELECT i.id, i.nom_fichier, i.genere_le, i.genere_par, i.importe_le, u.nom AS importe_par_nom,
       i.nb_sites, i.nb_termines, i.nb_en_cours, i.nb_non_demarres, i.nb_nouveaux, i.nb_nouveaux_deployes, jsonb_array_length(i.avertissements) AS nb_avertissements
     FROM import_extrait i LEFT JOIN utilisateur u ON u.id = i.importe_par ORDER BY i.importe_le DESC, i.id DESC`);
  return rows.map((r, i) => ({
    ...r,
    taux: taux(r.nb_termines, r.nb_sites),
    evolution: rows[i + 1] ? r.nb_termines - rows[i + 1].nb_termines : null,
  }));
}
