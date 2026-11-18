/**
 * Quels sites de l'extrait sont des NOUVEAUX sites (sans version commerciale mSupply, déployés directement sur
 * Open mSupply) ? Deux règles, en plus de la colonne Excel « Type de site » :
 *  1. COMMENTAIRE : « Site nouvellement ajouté pour l'utilisation de mSupply » dans la colonne Commentaires ;
 *  2. LISTE : le site figure dans la liste des nouveaux sites.
 * Le référentiel (liste des dépôts du tableau de bord mSupply) recense TOUS les sites en service, nouveaux sites déjà
 * déployés sur Open mSupply compris : un site de la liste des nouveaux sites qui y figure est un nouveau site DÉPLOYÉ
 * (`deja`), pas un site à migrer. Les noms sont comparés dans un même district, par leur texte normalisé ou par leurs mots
 * significatifs (sans sigles, ex. « DR X » = « CSR-D PUBLIC de X »).
 *
 * Les CORRECTIONS MANUELLES (table correction_site) l'emportent : ANCIEN = jamais un nouveau site ; NOUVEAU = nouveau site
 * à déployer (même s'il figure au tableau de bord) ; MIGRE = site migré (statut « Terminé »).
 */
import { query } from '../db.js';
import { normaliser } from './membres.js';

export const RE_NOUVELLEMENT = /nouvellement\s+ajout/i;

const MOTS_VIDES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'public', 'prive', 'centre', 'sante',
  'csr', 'csu', 'csi', 'dr', 'cat', 'fsu', 'dm', 'ong', 'csus', 'cms', 'cm']);

/**
 * Clé d'un nom d'établissement : mots significatifs triés (sans sigles, mots vides, lettres isolées ni texte entre
 * parenthèses). Les chiffres sont gardés : « KOUTOUKRO 1 » ≠ « KOUTOUKRO 2 ».
 */
export const cleSite = (nom) => [...new Set(normaliser(String(nom).replace(/\([^)]*\)/g, ' ')).split(' ')
  .filter((w) => (w.length > 1 || /\d/.test(w)) && !MOTS_VIDES.has(w)))].sort().join(' ');

/** Index { district → noms normalisés, clés } d'une liste de { nom, district }. */
export function indexer(lignes) {
  const m = new Map();
  for (const l of lignes) {
    if (!m.has(l.district)) m.set(l.district, { noms: new Set(), cles: new Set() });
    const e = m.get(l.district);
    e.noms.add(normaliser(l.nom));
    const c = cleSite(l.nom);
    if (c) e.cles.add(c);
  }
  return m;
}

/** Le site { nom, district } figure-t-il dans l'index (même district) ? */
export function trouve(index, s) {
  const e = index.get(s.district);
  if (!e) return false;
  const c = cleSite(s.nom);
  return e.noms.has(normaliser(s.nom)) || (c !== '' && e.cles.has(c));
}

/**
 * Comme `trouve`, mais tolère un nom complété (« CSU OLIVIA YACE » ≈ « CSU OLIVIA YACE NGOKRO ») : tous les mots
 * significatifs de l'un, au moins deux, figurent dans l'autre. Réservé à la comparaison extrait ↔ liste des nouveaux
 * sites (un seul mot, comme « DABOU », est trop vague et ne suffit pas).
 */
export function trouveProche(index, s) {
  if (trouve(index, s)) return true;
  const e = index.get(s.district);
  if (!e) return false;
  const a = cleSite(s.nom).split(' ').filter(Boolean);
  for (const cle of e.cles) {
    const b = cle.split(' ');
    const [petit, grand] = a.length <= b.length ? [a, b] : [b, a];
    if (petit.length >= 2 && petit.every((w) => grand.includes(w))) return true;
  }
  return false;
}

/**
 * Contexte des règles :
 *  - `sites` : nouveaux sites hors extrait = liste des nouveaux sites sans les ANCIEN, + les corrections NOUVEAU ;
 *    `liste` en est l'index ; `actif` est faux s'il n'y en a aucun ;
 *  - `deja` : ceux qui figurent dans le référentiel (tableau de bord mSupply), donc déjà déployés (sauf correction NOUVEAU) ;
 *  - `anciens`, `forces`, `migres` : index des corrections ANCIEN, NOUVEAU et MIGRE ; `corrections` : leurs lignes.
 */
export async function contexteNouveaux() {
  const { rows: liste } = await query('SELECT nom, region, district, raison, equipement FROM nouveau_site');
  const { rows: corrections } = await query('SELECT nom, region, district, decision, note FROM correction_site');
  const de = (decision) => corrections.filter((c) => c.decision === decision);
  const anciens = indexer(de('ANCIEN'));
  const forces = indexer(de('NOUVEAU'));
  const migres = indexer(de('MIGRE'));
  const indexListe = indexer(liste);
  const sites = [
    ...liste.filter((s) => !trouve(anciens, s)),
    ...de('NOUVEAU').filter((c) => !trouve(indexListe, c))
      .map((c) => ({ nom: c.nom, region: c.region, district: c.district, raison: c.note || 'Correction : nouveau site', equipement: '' })),
  ];
  const base = { anciens, forces, migres, corrections };
  if (!sites.length) return { actif: false, sites: [], liste: new Map(), deja: [], ...base };
  const { rows: ref } = await query('SELECT nom, district FROM referentiel_depot');
  const dansRef = indexer(ref);
  return { actif: true, sites, liste: indexer(sites), deja: sites.filter((s) => trouve(dansRef, s) && !trouve(forces, s)), ...base };
}

/** 'commentaire', 'liste' ou null : pourquoi ce site { nom, district, commentaires } est un nouveau site. */
export function raisonNouveau(s, ctx) {
  if (ctx.anciens && trouveProche(ctx.anciens, s)) return null; // correction : ancien site mSupply
  if (RE_NOUVELLEMENT.test(s.commentaires || '')) return 'commentaire';
  return ctx.actif && trouveProche(ctx.liste, s) ? 'liste' : null;
}

const MESSAGES = {
  commentaire: (nom) => `${nom} : commentaire « Site nouvellement ajouté » : classé nouveau site (déployé directement sur Open mSupply).`,
  liste: (nom) => `${nom} : dans la liste des nouveaux sites : classé nouveau site (déployé directement sur Open mSupply).`,
  ancien: (nom) => `${nom} : correction manuelle « ancien site mSupply » : compté comme site à migrer, pas comme nouveau site.`,
  migre: (nom) => `${nom} : correction manuelle « migré vers Open mSupply » : statut « Terminé ».`,
};

/**
 * Applique aux lignes de l'extrait (lues par lireClasseur) les règles des nouveaux sites et les corrections manuelles ;
 * renvoie un avertissement par site modifié.
 */
export function classerNouveaux(sites, ctx) {
  const notes = [];
  for (const s of sites) {
    const cle = { nom: s.site, district: s.district, commentaires: s.commentaires };
    if (ctx.anciens && trouveProche(ctx.anciens, cle)) {
      if (s.typeSite === 'NOUVEAU') { s.typeSite = 'MIGRATION'; notes.push(MESSAGES.ancien(s.site)); }
    } else if (s.typeSite !== 'NOUVEAU') {
      const raison = (ctx.forces && trouveProche(ctx.forces, cle)) ? 'liste' : raisonNouveau(cle, ctx);
      if (raison) { s.typeSite = 'NOUVEAU'; notes.push(MESSAGES[raison](s.site)); }
    }
    if (ctx.migres && trouveProche(ctx.migres, cle) && s.statut !== 'TERMINE') {
      s.statut = 'TERMINE';
      notes.push(MESSAGES.migre(s.site));
    }
  }
  return notes;
}

/**
 * Sites corrigés « MIGRE » absents de l'extrait `lignesExtrait` ({ nom, district }) : migrés hors du suivi de la DAP.
 * `parDistrict` : « région|district » → nombre.
 */
export function migresHorsExtrait(ctx, lignesExtrait) {
  const dansExtrait = indexer(lignesExtrait);
  const sites = (ctx.corrections || []).filter((c) => c.decision === 'MIGRE' && !trouveProche(dansExtrait, c));
  const parDistrict = new Map();
  for (const s of sites) { const k = `${s.region}|${s.district}`; parDistrict.set(k, (parDistrict.get(k) || 0) + 1); }
  return { total: sites.length, parDistrict, sites };
}
