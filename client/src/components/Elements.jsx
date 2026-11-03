import { CATEGORIES, STATUTS, fmtPct } from '../api.js';

const CLASSE = { TERMINE: 'T', EN_COURS: 'C', NON_DEMARRE: 'N', NON_APPLICABLE: 'N' };

export const Statut = ({ statut }) => (
  <span className="pill"><span className={`dot ${CLASSE[statut]}`} />{STATUTS[statut]}</span>
);

export const Categorie = ({ categorie }) => (
  <span className={`cat cat-${categorie}`}>{CATEGORIES[categorie] || categorie}</span>
);

export const Taux = ({ valeur, complet, gras }) => (
  <span className="taux">
    <span className="minibar"><span style={{ width: `${valeur}%` }} /></span>
    <span className="num" style={{ fontWeight: gras ? 700 : 400 }}>{fmtPct(valeur)}</span>
    {complet && <span className="complet">✓ complet</span>}
  </span>
);
