import { useEffect, useState } from 'react';
import { api, fmtDateHeure } from '../api.js';
import DG from '../data/districts_geo.json';

const DISTRICTS = DG.districts.map((d) => d.nom).sort((a, b) => a.localeCompare(b, 'fr'));
const COULEUR = { MIGRE: 'T', ANCIEN: 'N', NOUVEAU: 'C' };

/**
 * Corrections manuelles sur des sites (administrateurs) : elles l'emportent sur les fichiers (extrait de la DAP,
 * liste des nouveaux sites, tableau de bord mSupply) et s'appliquent aussitôt aux imports existants.
 */
export default function Corrections() {
  const [liste, setListe] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [f, setF] = useState({ nom: '', district: '', decision: 'MIGRE', note: '' });
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');
  const charger = () => api('/corrections').then((d) => { setListe(d.corrections); setDecisions(d.decisions); }).catch((e) => setErreur(e.message));
  useEffect(() => { charger(); }, []);

  const ajouter = async (e) => {
    e.preventDefault();
    setErreur('');
    setMessage('');
    try {
      const d = await api('/corrections', { methode: 'POST', corps: f });
      setListe(d.corrections);
      setMessage(`Correction enregistrée : ${d.modifies} ligne(s) d'import mise(s) à jour.`);
      setF({ ...f, nom: '', note: '' });
    } catch (err) {
      setErreur(err.message);
    }
  };
  const retirer = async (c) => {
    setErreur('');
    setMessage('');
    try {
      setListe((await api(`/corrections/${c.id}`, { methode: 'DELETE' })).corrections);
      setMessage(`Correction retirée (${c.nom}). Un statut déjà passé à « Terminé » reste tel quel jusqu'au prochain extrait.`);
    } catch (err) {
      setErreur(err.message);
    }
  };

  return (
    <section className="panel">
      <h2>Corrections manuelles des sites</h2>
      <p className="sub">
        Décisions de l'équipe sur des sites, qui l'emportent sur les fichiers : site migré vers Open mSupply (hors du suivi de la DAP
        compris), ancien site mSupply (pas un nouveau site), ou nouveau site à déployer. Elles s'appliquent aussitôt aux imports
        existants et à chaque nouvel extrait. Indiquez le nom tel qu'il figure dans l'extrait ou la liste des dépôts.
      </p>
      {erreur && <div className="erreur" style={{ marginBottom: 10 }}>{erreur}</div>}
      {message && <div className="info" style={{ marginBottom: 10 }}>{message}</div>}
      <form className="form-ligne" style={{ marginBottom: 12 }} onSubmit={ajouter}>
        <input aria-label="Nom du site" placeholder="Nom du site (ex. HG PUBLIC de GUITRY)" value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} required style={{ minWidth: 280 }} />
        <select aria-label="District" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} required>
          <option value="">District…</option>
          {DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select aria-label="Décision" value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })}>
          {Object.entries(decisions).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input aria-label="Note" placeholder="Note (facultatif)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <button className="btn primaire" type="submit">Enregistrer</button>
      </form>
      {liste.length === 0 ? <p className="vide">Aucune correction.</p> : (
        <div className="tablewrap" style={{ maxHeight: 360, overflow: 'auto' }}><table>
          <thead><tr><th>Site</th><th>District</th><th>Région</th><th>Décision</th><th>Note</th><th>Saisie</th><th /></tr></thead>
          <tbody>{liste.map((c) => (
            <tr key={c.id}>
              <td>{c.nom}</td><td>{c.district}</td><td>{c.region}</td>
              <td><span className="pill"><span className={`dot ${COULEUR[c.decision]}`} />{decisions[c.decision] || c.decision}</span></td>
              <td className="sub" style={{ margin: 0 }}>{c.note || '—'}</td>
              <td className="num sub" style={{ margin: 0 }}>{fmtDateHeure(c.cree_le)}{c.cree_par_nom ? ` · ${c.cree_par_nom}` : ''}</td>
              <td><button className="btn" type="button" onClick={() => retirer(c)} aria-label={`Retirer la correction ${c.nom}`}>Retirer</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
