/**
 * Liste officielle des 113 districts sanitaires et de leurs 33 régions (data/districts_officiels.json,
 * déduite de la carte officielle). Un district est identifié par son NOM : sa région officielle s'en déduit,
 * quelle que soit la région écrite dans un fichier (ex. YOPOUGON-EST est dans ABIDJAN 1).
 */
import { readFileSync } from 'node:fs';
import { normaliser } from './membres.js';

export const DISTRICTS_OFFICIELS = JSON.parse(readFileSync(new URL('../data/districts_officiels.json', import.meta.url), 'utf8'));

// Écritures rencontrées dans les fichiers (extraits, liste des dépôts) → nom officiel
const ALIAS_DISTRICTS = {
  'ouangolo': 'OUANGOLODOUGOU', 'adjame plateau attecoube': 'ADJAME-ATTECOUBE-PLATEAU',
  'kouassi kouassikro': 'KOUASSI-KOUSSIKRO', 'bouake nourd ouest': 'BOUAKE NORD-OUEST',
};
const ALIAS_REGIONS = {
  'me': 'LA ME', 'indenie duablin': 'INDENIE-DJUABLIN', 'cavaly': 'CAVALLY', 'gbockle': 'GBOKLE', 'boukani': 'BOUNKANI',
};

const PAR_DISTRICT = new Map(DISTRICTS_OFFICIELS.map((d) => [normaliser(d.district), d]));
const REGIONS = new Map(DISTRICTS_OFFICIELS.map((d) => [normaliser(d.region), d.region]));

/** { district, region } officiels, ou null si le nom n'est pas celui d'un district sanitaire. */
export function districtOfficiel(nom) {
  const n = normaliser(nom);
  return PAR_DISTRICT.get(n) || PAR_DISTRICT.get(normaliser(ALIAS_DISTRICTS[n] || '')) || null;
}

/** Nom officiel d'une région (ex. « ME » → « LA ME »), ou null. */
export function regionOfficielle(nom) {
  const n = normaliser(nom);
  return REGIONS.get(n) || REGIONS.get(normaliser(ALIAS_REGIONS[n] || '')) || null;
}
