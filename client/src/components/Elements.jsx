import { STATUTS, fmtPct } from '../api.js';

const CLASSE = { TERMINE: 'T', EN_COURS: 'C', NON_DEMARRE: 'N' };

export const Statut = ({ statut }) => (
  <span className="pill"><span className={`dot ${CLASSE[statut]}`} />{STATUTS[statut]}</span>
);

export const Etapes = ({ etapes = [] }) => (
  <span className="etapes" title={`${etapes.filter((e) => e === 'TERMINE').length} étapes sur 9 terminées`}>
    {etapes.map((e, i) => <i key={i} className={e} title={`Étape ${i + 1} : ${STATUTS[e]}`} />)}
  </span>
);

export const Taux = ({ valeur, complet, gras }) => (
  <span className="taux">
    <span className="minibar"><span style={{ width: `${valeur}%` }} /></span>
    <span className="num" style={{ fontWeight: gras ? 700 : 400 }}>{fmtPct(valeur)}</span>
    {complet && <span className="complet">✓ complet</span>}
  </span>
);
