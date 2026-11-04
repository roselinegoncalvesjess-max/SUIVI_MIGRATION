/**
 * Les 10 régions sanitaires prioritaires suivies par le projet LHSPLA.
 * Noms officiels (fichier CI_REGION_SANITAIRE) ; les variantes sont les autres graphies acceptées.
 */
import { normaliser } from './membres.js';

export const REGIONS_PRIORITAIRES = [
  ['ABIDJAN 2'],
  ['AGNEBY-TIASSA'],
  ['BELIER'],
  ['GBEKE'],
  ['HAUT-SASSANDRA'],
  ['INDENIE-DJUABLIN'],
  ['LA ME', 'ME'],
  ['LOH-DJIBOUA'],
  ['PORO'],
  ['TONKPI', 'TONPKI'],
];

const OFFICIEL = new Map(REGIONS_PRIORITAIRES.flatMap(([nom, ...variantes]) =>
  [nom, ...variantes].map((v) => [normaliser(v), nom])));

/** Nom officiel de la région si elle est prioritaire, sinon null. */
export const regionPrioritaire = (nom) => OFFICIEL.get(normaliser(nom)) || null;
