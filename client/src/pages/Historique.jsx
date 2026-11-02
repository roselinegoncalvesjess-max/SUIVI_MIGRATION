import { useState } from 'react';
import { Etat, useDonnees } from '../App.jsx';
import { api, fmtDateHeure, fmtPct } from '../api.js';

export default function Historique() {
  const etat = useDonnees('/historique');
  const [details, setDetails] = useState(null);
  const voir = async (id) => setDetails({ id, ...(await api(`/imports/${id}/avertissements`)) });
  return (
    <section className="panel">
      <h2>Historique des imports</h2>
      <p className="sub">Chaque extrait importé est conservé, du plus récent au plus ancien</p>
      <Etat etat={etat}>{(d) => (
        <div className="tablewrap"><table>
          <thead><tr><th>Importé le</th><th>Importé par</th><th>Fichier</th><th>Extrait généré le</th><th className="r">Sites</th><th className="r">Migrés</th><th className="r">Taux</th><th className="r">En cours</th><th className="r">Non démarrés</th><th className="r">Évolution</th><th>Contrôle qualité</th></tr></thead>
          <tbody>
            {d.imports.length === 0 && <tr><td colSpan={11} className="vide">Aucun import.</td></tr>}
            {d.imports.map((i) => (
              <tr key={i.id}>
                <td className="num">{fmtDateHeure(i.importe_le)}</td><td>{i.importe_par_nom || '—'}</td><td>{i.nom_fichier}</td>
                <td className="num">{fmtDateHeure(i.genere_le)}</td><td className="r num">{i.nb_sites}</td><td className="r num">{i.nb_termines}</td>
                <td className="r num">{fmtPct(i.taux)}</td><td className="r num">{i.nb_en_cours}</td><td className="r num">{i.nb_non_demarres}</td>
                <td className="r num">{i.evolution === null ? '—' : `${i.evolution >= 0 ? '+' : ''}${i.evolution}`}</td>
                <td>{i.nb_avertissements ? <button className="lien" type="button" onClick={() => voir(i.id)}>{i.nb_avertissements} incohérence{i.nb_avertissements > 1 ? 's' : ''}</button> : 'Aucune'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}</Etat>
      {details && (
        <div className="info" style={{ marginTop: 12 }}>
          <b>Incohérences de l'import n°{details.id}</b>
          <ul>{details.avertissements.map((a, k) => <li key={k}>{a}</li>)}</ul>
          <button className="btn" type="button" onClick={() => setDetails(null)}>Fermer</button>
        </div>
      )}
    </section>
  );
}
