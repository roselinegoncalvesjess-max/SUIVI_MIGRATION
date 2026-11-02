import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtPct } from '../api.js';

export default function Importer() {
  const [fichier, setFichier] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState(null);
  const [erreur, setErreur] = useState('');

  const envoyer = async (e) => {
    e.preventDefault();
    if (!fichier) return;
    setEnvoi(true);
    setErreur('');
    setResultat(null);
    try {
      setResultat(await api('/imports', { methode: 'POST', fichier }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  const imp = resultat?.import;
  return (
    <section className="panel">
      <h2>Importer un extrait de suivi</h2>
      <p className="sub">Fichier Excel (.xlsx) exporté depuis l'application de suivi de la DAP, feuille « Sites ». Toute l'équipe verra les nouveaux chiffres immédiatement.</p>
      <form className="import" onSubmit={envoyer}>
        <label htmlFor="fichier">Fichier Excel de l'extrait</label>
        <input id="fichier" type="file" accept=".xlsx" onChange={(e) => setFichier(e.target.files[0] || null)} />
        {erreur && <div className="erreur">{erreur}</div>}
        <div><button className="btn primaire" type="submit" disabled={!fichier || envoi}>{envoi ? 'Import en cours…' : 'Importer'}</button></div>
      </form>
      {imp && (
        <div className="info" style={{ marginTop: 16 }}>
          <b>Extrait importé :</b> {imp.nb_sites} sites, {imp.nb_termines} migrés ({fmtPct((100 * imp.nb_termines) / imp.nb_sites)}),
          {' '}{imp.nb_en_cours} en cours, {imp.nb_non_demarres} non démarrés. <Link to="/">Voir la vue d'ensemble</Link>
          {resultat.avertissements.length > 0 && (
            <>
              <p style={{ marginBottom: 4 }}><b>{resultat.avertissements.length} incohérence(s) à signaler à la DAP :</b></p>
              <ul style={{ marginTop: 0 }}>{resultat.avertissements.map((a, k) => <li key={k}>{a}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
