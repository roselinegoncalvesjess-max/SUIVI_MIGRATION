import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Connexion() {
  const { connexion } = useAuth();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const soumettre = async (e) => {
    e.preventDefault();
    setEnvoi(true);
    setErreur('');
    try { await connexion(identifiant, motDePasse); } catch (err) { setErreur(err.message); } finally { setEnvoi(false); }
  };

  return (
    <main style={{ maxWidth: 420, marginTop: 60 }}>
      <section className="panel">
        <h2>Suivi migration Open mSupply — LHSPLA</h2>
        <p className="sub">Connectez-vous avec votre compte</p>
        <form className="import" onSubmit={soumettre}>
          {erreur && <div className="erreur">{erreur}</div>}
          <label htmlFor="identifiant">Identifiant</label>
          <input id="identifiant" autoComplete="username" value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} required />
          <label htmlFor="mdp">Mot de passe</label>
          <input id="mdp" type="password" autoComplete="current-password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} required />
          <button className="btn primaire" type="submit" disabled={envoi}>{envoi ? 'Connexion…' : 'Se connecter'}</button>
        </form>
      </section>
    </main>
  );
}
