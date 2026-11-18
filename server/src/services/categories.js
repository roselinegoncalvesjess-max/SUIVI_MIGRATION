/**
 * Catégorie d'un site, déduite des sigles de son nom (règles LHSPLA du 03/11/2026, complétées le 09/11/2026) :
 *  - DISTRICT SANITAIRE   : DS, « District sanitaire »
 *  - HÔPITAL DE RÉFÉRENCE : HG, EPHD, CHU, CHR (et « Hôpital général » écrit en toutes lettres)
 *  - INHP                 : INHP et ses antennes (« ANTENNE … »)
 *  - ESPC                 : CSR, DR, CSI, CSU, FSU, CAT, ONG, DM (et CSUS, variante de CSU) ; testé avant CMS
 *                           (un nom portant les deux, comme « … (CMS PRIVE ONG) », reste ESPC) ;
 *                           noms commençant par DU, INF ou INFIRMERIE (dispensaire urbain, infirmeries) ; INPHB
 *  - CMS                  : CMS, CM (centre médical privé), centres « confessionnels » (« Centre de Santé Confessionnel… »)
 * Une colonne Excel « Catégorie de site » renseignée l'emporte sur la déduction.
 */
import { normaliser } from './membres.js';

export const CATEGORIES = {
  ESPC: 'ESPC',
  DISTRICT_SANITAIRE: 'District sanitaire',
  HOPITAL_REFERENCE: 'Hôpital de référence',
  CMS: 'CMS',
  INHP: 'INHP',
  A_CLASSER: 'À classer',
};

const SIGLES_HR = new Set(['hg', 'ephd', 'chu', 'chr']);
const SIGLES_ESPC = new Set(['csr', 'dr', 'csi', 'csu', 'csus', 'fsu', 'cat', 'ong', 'dm', 'inphb']);
const DEBUTS_ESPC = new Set(['du', 'inf', 'infirmerie']);

export function categorieDuNom(nom) {
  const n = normaliser(nom);
  const mots = new Set(n.split(' '));
  const a = (sigles) => [...mots].some((m) => sigles.has(m));
  if (n.includes('district sanitaire') || mots.has('ds')) return 'DISTRICT_SANITAIRE';
  if (a(SIGLES_HR) || n.includes('hopital general')) return 'HOPITAL_REFERENCE';
  if (mots.has('inhp') || mots.has('antenne')) return 'INHP';
  if (a(SIGLES_ESPC)) return 'ESPC'; // avant CMS : « ASAPSU … (CMS PRIVE ONG) » reste ESPC (sigle ONG)
  if (mots.has('cms') || mots.has('cm') || n.includes('confessionnel')) return 'CMS';
  if (DEBUTS_ESPC.has(n.split(' ')[0])) return 'ESPC';
  return 'A_CLASSER';
}

/** Valeur saisie dans la colonne « Catégorie de site » (ou null si vide / non reconnue). */
export function categorieSaisie(v) {
  const n = normaliser(v);
  if (!n) return null;
  if (n.startsWith('espc')) return 'ESPC';
  if (n.startsWith('district')) return 'DISTRICT_SANITAIRE';
  if (n.startsWith('hopital')) return 'HOPITAL_REFERENCE';
  if (n.startsWith('cms')) return 'CMS';
  if (n.startsWith('inhp')) return 'INHP';
  return null;
}
