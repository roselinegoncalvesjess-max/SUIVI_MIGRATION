/**
 * Catégorie d'un site, déduite des sigles de son nom (règles LHSPLA du 03/11/2026) :
 *  - DISTRICT SANITAIRE   : DS, « District sanitaire »
 *  - HÔPITAL DE RÉFÉRENCE : HG, EPHD, CHU, CHR (et « Hôpital général » écrit en toutes lettres)
 *  - ESPC                 : CSR, DR, CSI, CSU, FSU, CAT, ONG, DM (et CSUS, variante de CSU)
 * Une colonne Excel « Catégorie de site » renseignée l'emporte sur la déduction.
 */
import { normaliser } from './membres.js';

export const CATEGORIES = {
  ESPC: 'ESPC',
  DISTRICT_SANITAIRE: 'District sanitaire',
  HOPITAL_REFERENCE: 'Hôpital de référence',
  A_CLASSER: 'À classer',
};

const SIGLES_HR = new Set(['hg', 'ephd', 'chu', 'chr']);
const SIGLES_ESPC = new Set(['csr', 'dr', 'csi', 'csu', 'csus', 'fsu', 'cat', 'ong', 'dm']);

export function categorieDuNom(nom) {
  const n = normaliser(nom);
  const mots = new Set(n.split(' '));
  if (n.includes('district sanitaire') || mots.has('ds')) return 'DISTRICT_SANITAIRE';
  if ([...mots].some((m) => SIGLES_HR.has(m)) || n.includes('hopital general')) return 'HOPITAL_REFERENCE';
  if ([...mots].some((m) => SIGLES_ESPC.has(m))) return 'ESPC';
  return 'A_CLASSER';
}

/** Valeur saisie dans la colonne « Catégorie de site » (ou null si vide / non reconnue). */
export function categorieSaisie(v) {
  const n = normaliser(v);
  if (!n) return null;
  if (n.startsWith('espc')) return 'ESPC';
  if (n.startsWith('district')) return 'DISTRICT_SANITAIRE';
  if (n.startsWith('hopital')) return 'HOPITAL_REFERENCE';
  return null;
}
