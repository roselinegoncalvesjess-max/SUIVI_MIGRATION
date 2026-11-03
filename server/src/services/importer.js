/**
 * Import d'un extrait Excel de l'application de suivi de la DAP.
 *
 * Fichier attendu (feuille « Sites ») :
 *  - une ligne « Généré le JJ/MM/AAAA à HH:MM par Prénom Nom » au-dessus du tableau ;
 *  - une ligne d'en-tête contenant au moins Site, Région, District, Statut ;
 *  - les 9 colonnes d'étapes dont le libellé commence par « 1. » … « 9. ».
 * L'import est atomique : en cas d'erreur, rien n'est enregistré.
 */
import ExcelJS from 'exceljs';
import { transaction } from '../db.js';
import { Rapprochement, normaliser } from './membres.js';

export class ErreurImport extends Error {}

const COLONNES = {
  'site': 'site', 'code région': 'codeRegion', 'région': 'region', 'code district': 'codeDistrict',
  'district': 'district', 'vague': 'vague', 'responsable': 'responsable', 'version msupply': 'version',
  'date prévue': 'datePrevue', 'début réel': 'debut', 'fin réelle': 'fin', 'statut': 'statut',
  'avancement %': 'avancement', 'étape en cours': 'etape', 'commentaires': 'commentaires',
  'difficultés': 'difficultes',
  'type de site': 'typeSite', 'type': 'typeSite', 'type de déploiement': 'typeSite',
};
const OBLIGATOIRES = { site: 'Site', region: 'Région', district: 'District', statut: 'Statut' };
const RE_GENERE = /G[ée]n[ée]r[ée] le\s+(\d{2}\/\d{2}\/\d{4})(?:\s+à\s+(\d{1,2}:\d{2}))?(?:\s+par\s+(.+))?/i;

// ------------------------------------------------------------ conversions
const pad = (n) => String(n).padStart(2, '0');

function brut(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return brut(v.result);                       // formule
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;                                // lien hypertexte
  }
  return v;
}

export function texte(v) {
  v = brut(v);
  if (v === null) return '';
  if (v instanceof Date) return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  return String(v).trim();
}

/** Renvoie une date « AAAA-MM-JJ » ou null. */
export function dateIso(v) {
  v = brut(v);
  if (v === null || v === '') return null;
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const m = String(v).match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [j, mo, a] = [+m[1], +m[2], +m[3]];
  const d = new Date(Date.UTC(a, mo - 1, j));
  return d.getUTCDate() === j && d.getUTCMonth() === mo - 1 ? `${a}-${pad(mo)}-${pad(j)}` : null;
}

function entier(v) {
  v = brut(v);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** « Nouveau site », « Nouveau déploiement »… → NOUVEAU ; tout le reste (ou vide) → MIGRATION. */
export function typeSite(v) {
  return normaliser(texte(v)).startsWith('nouv') ? 'NOUVEAU' : 'MIGRATION';
}

export function statut(v) {
  const n = normaliser(texte(v));
  if (n === 'non applicable' || n === 'na' || n === 'n a' || n === 'sans objet') return 'NON_APPLICABLE';
  if (n.startsWith('termin')) return 'TERMINE';
  if (n.startsWith('en cours')) return 'EN_COURS';
  return 'NON_DEMARRE';
}

// ------------------------------------------------------------ lecture
export async function lireClasseur(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ErreurImport('Fichier illisible : ce n\'est pas un classeur Excel (.xlsx) valide.');
  }
  const ws = wb.worksheets.find((w) => normaliser(w.name) === 'sites') || wb.worksheets[0];
  if (!ws) throw new ErreurImport('Le classeur ne contient aucune feuille.');

  const lignes = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const vals = row.values.slice(1); // ExcelJS : index 1 = colonne A
    lignes[n - 1] = vals;
  });
  for (let i = 0; i < lignes.length; i++) lignes[i] = lignes[i] || [];

  const entete = lignes.slice(0, 30).findIndex((l) => {
    const s = new Set(l.map((c) => normaliser(texte(c))));
    return s.has('site') && s.has('statut');
  });
  if (entete < 0) throw new ErreurImport(`Ligne d'en-tête introuvable (colonnes « Site » et « Statut ») dans la feuille « ${ws.name} ».`);

  const index = {};
  const etapes = {};
  lignes[entete].forEach((c, i) => {
    const lib = texte(c);
    const cle = COLONNES[lib.toLowerCase()];
    if (cle) index[cle] = i;
    const m = lib.match(/^(\d)\.\s*(.+)$/);
    if (m) etapes[+m[1]] = i;
  });
  const manquantes = Object.entries(OBLIGATOIRES).filter(([k]) => index[k] === undefined).map(([, n]) => n);
  if (manquantes.length) throw new ErreurImport(`Colonnes manquantes : ${manquantes.join(', ')}.`);
  for (let k = 1; k <= 9; k++) if (etapes[k] === undefined) throw new ErreurImport('Les 9 colonnes d\'étapes (« 1. … » à « 9. … ») sont attendues.');

  let genereLe = null;
  let generePar = '';
  for (const l of lignes.slice(0, entete)) {
    const m = l.map(texte).filter(Boolean).join(' ').match(RE_GENERE);
    if (m) {
      const d = dateIso(m[1]);
      genereLe = d ? `${d}T${m[2] ? m[2].padStart(5, '0') : '00:00'}:00Z` : null; // Abidjan = UTC
      generePar = (m[3] || '').trim();
    }
  }

  const val = (l, cle) => (index[cle] === undefined ? null : l[index[cle]]);
  const sites = [];
  for (const l of lignes.slice(entete + 1)) {
    const nom = texte(val(l, 'site'));
    if (!nom) continue;
    sites.push({
      site: nom,
      codeRegion: texte(val(l, 'codeRegion')), region: texte(val(l, 'region')) || '—',
      codeDistrict: texte(val(l, 'codeDistrict')), district: texte(val(l, 'district')) || '—',
      vague: entier(val(l, 'vague')), responsable: texte(val(l, 'responsable')), version: texte(val(l, 'version')),
      datePrevue: dateIso(val(l, 'datePrevue')), debut: dateIso(val(l, 'debut')), fin: dateIso(val(l, 'fin')),
      typeSite: typeSite(val(l, 'typeSite')),
      statut: statut(val(l, 'statut')).replace('NON_APPLICABLE', 'NON_DEMARRE'), avancement: entier(val(l, 'avancement')) ?? 0,
      etape: texte(val(l, 'etape')), commentaires: texte(val(l, 'commentaires')), difficultes: texte(val(l, 'difficultes')),
      etapes: Array.from({ length: 9 }, (_, k) => statut(l[etapes[k + 1]])),
    });
  }
  if (!sites.length) throw new ErreurImport('Aucun site trouvé sous la ligne d\'en-tête.');
  return { genereLe, generePar, sites };
}

// ------------------------------------------------------------ contrôle qualité
const fr = (iso) => iso.split('-').reverse().join('/');

export function controlerQualite(sites) {
  const avert = [];
  const codes = new Map();
  for (const s of sites) {
    if (s.statut === 'TERMINE' && s.etapes.some((e) => e !== 'TERMINE' && e !== 'NON_APPLICABLE'))
      avert.push(`${s.site} : statut « Terminé » mais toutes les étapes ne sont pas terminées.`);
    if (s.statut === 'NON_DEMARRE' && (s.debut || s.fin))
      avert.push(`${s.site} : « Non démarré » alors qu'une date de début ou de fin est renseignée.`);
    if (s.debut && s.fin && s.fin < s.debut)
      avert.push(`${s.site} : fin réelle (${fr(s.fin)}) antérieure au début (${fr(s.debut)}).`);
    if (s.typeSite === 'NOUVEAU' && s.version)
      avert.push(`${s.site} : « Nouveau site » alors qu'une version mSupply (${s.version}) est renseignée : s'agit-il d'une migration ?`);
    if (s.statut !== 'NON_DEMARRE' && !s.responsable)
      avert.push(`${s.site} : migration démarrée sans responsable.`);
    if (s.codeDistrict) {
      if (!codes.has(s.codeDistrict)) codes.set(s.codeDistrict, new Set());
      codes.get(s.codeDistrict).add(`${s.district} (${s.region})`);
    }
  }
  for (const [code, noms] of [...codes].sort()) {
    if (noms.size > 1) avert.push(`Code ${code} utilisé pour plusieurs districts : ${[...noms].sort().join(', ')}.`);
  }
  return avert;
}

// ------------------------------------------------------------ enregistrement
export async function importerExtrait(buffer, nomFichier, utilisateurId = null) {
  const donnees = await lireClasseur(buffer);
  const avertissements = controlerQualite(donnees.sites);

  return transaction(async (c) => {
    const rapprochement = await Rapprochement.charger(c);
    const { rows: [imp] } = await c.query(
      `INSERT INTO import_extrait (nom_fichier, genere_le, genere_par, importe_par, avertissements)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nomFichier, donnees.genereLe, donnees.generePar, utilisateurId, JSON.stringify(avertissements)],
    );

    const regions = new Map();
    const districts = new Map();
    // nb_* = sites à MIGRER ; les nouveaux sites sont comptés à part
    const compte = { TERMINE: 0, EN_COURS: 0, NON_DEMARRE: 0, NON_APPLICABLE: 0 };
    const nouveaux = { total: 0, deployes: 0 };
    const suivis = [];

    for (const s of donnees.sites) {
      if (!regions.has(s.region)) {
        const { rows } = await c.query(
          `INSERT INTO region (nom, code) VALUES ($1, $2)
           ON CONFLICT (nom) DO UPDATE SET code = EXCLUDED.code RETURNING id`, [s.region, s.codeRegion]);
        regions.set(s.region, rows[0].id);
      }
      const cleD = `${s.district}|${s.region}`;
      if (!districts.has(cleD)) {
        const { rows } = await c.query(
          `INSERT INTO district (nom, region_id, code) VALUES ($1, $2, $3)
           ON CONFLICT (nom, region_id) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
          [s.district, regions.get(s.region), s.codeDistrict]);
        districts.set(cleD, rows[0].id);
      }
      const { rows: [site] } = await c.query(
        `INSERT INTO site (nom, district_id) VALUES ($1, $2)
         ON CONFLICT (nom) DO UPDATE SET district_id = EXCLUDED.district_id RETURNING id`,
        [s.site, districts.get(cleD)]);
      if (s.typeSite === 'NOUVEAU') {
        nouveaux.total++;
        if (s.statut === 'TERMINE') nouveaux.deployes++;
      } else compte[s.statut]++;
      suivis.push({ ...s, siteId: site.id, responsableId: rapprochement.trouver(s.responsable) });
    }

    // Insertion groupée (par lots) des suivis puis des étapes
    for (let i = 0; i < suivis.length; i += 200) {
      const lot = suivis.slice(i, i + 200);
      const p = [];
      const valeurs = lot.map((s, j) => {
        p.push(imp.id, s.siteId, s.vague, s.responsable, s.responsableId, s.version, s.datePrevue,
          s.debut, s.fin, s.statut, s.avancement, s.etape, s.commentaires, s.difficultes, s.typeSite);
        return `(${Array.from({ length: 15 }, (_, k) => `$${j * 15 + k + 1}`).join(',')})`;
      });
      const { rows } = await c.query(
        `INSERT INTO suivi_site (import_id, site_id, vague, responsable_libelle, responsable_id, version_msupply,
           date_prevue, debut_reel, fin_reelle, statut, avancement, etape_en_cours, commentaires, difficultes, type_site)
         VALUES ${valeurs.join(',')} RETURNING id, site_id`, p);
      const idParSite = new Map(rows.map((r) => [r.site_id, r.id]));
      const pe = [];
      const ve = [];
      lot.forEach((s) => s.etapes.forEach((st, k) => {
        pe.push(idParSite.get(s.siteId), k + 1, st);
        ve.push(`($${pe.length - 2},$${pe.length - 1},$${pe.length})`);
      }));
      await c.query(`INSERT INTO suivi_etape (suivi_id, etape_ordre, statut) VALUES ${ve.join(',')}`, pe);
    }

    const { rows: [fin] } = await c.query(
      `UPDATE import_extrait SET nb_sites = $2, nb_termines = $3, nb_en_cours = $4, nb_non_demarres = $5,
         nb_nouveaux = $6, nb_nouveaux_deployes = $7
       WHERE id = $1 RETURNING *`,
      [imp.id, suivis.length - nouveaux.total, compte.TERMINE, compte.EN_COURS, compte.NON_DEMARRE,
        nouveaux.total, nouveaux.deployes]);
    return { import: fin, avertissements };
  });
}
