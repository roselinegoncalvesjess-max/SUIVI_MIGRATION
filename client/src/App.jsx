import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useTempsReel } from './tempsReel.js';
import { api, fmtDateHeure } from './api.js';
import Connexion from './pages/Connexion.jsx';
import VueEnsemble from './pages/VueEnsemble.jsx';
import Sites from './pages/Sites.jsx';
import EquipeSI from './pages/EquipeSI.jsx';
import Historique from './pages/Historique.jsx';
import Importer from './pages/Importer.jsx';
import Administration from './pages/Administration.jsx';

// « revision » augmente à chaque notification : les pages rechargent alors leurs données.
const RevisionCtx = createContext(0);

/** Charge `chemin` et recharge à chaque nouvelle révision (import, changement d'équipe). */
export function useDonnees(chemin) {
  const revision = useContext(RevisionCtx);
  const [etat, setEtat] = useState({ donnees: null, erreur: null, chargement: true });
  useEffect(() => {
    let actif = true;
    setEtat((e) => ({ ...e, chargement: true }));
    api(chemin)
      .then((donnees) => actif && setEtat({ donnees, erreur: null, chargement: false }))
      .catch((erreur) => actif && setEtat({ donnees: null, erreur, chargement: false }));
    return () => { actif = false; };
  }, [chemin, revision]);
  return etat;
}

export function Etat({ etat, children }) {
  const { peut } = useAuth();
  if (etat.erreur?.corps?.aucunImport) {
    return (
      <section className="panel">
        <h2>Aucun extrait importé</h2>
        <p className="vide">Importez le fichier Excel exporté depuis l'application de suivi de la DAP pour afficher les chiffres.</p>
        {peut('contributeur') && <NavLink className="btn primaire" to="/importer">Importer un extrait</NavLink>}
      </section>
    );
  }
  if (etat.erreur) return <div className="erreur">{etat.erreur.message}</div>;
  if (!etat.donnees) return <p className="vide">Chargement…</p>;
  return children(etat.donnees);
}

function Cadre() {
  const { utilisateur, deconnexion, peut } = useAuth();
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState('');
  const [dernier, setDernier] = useState(null);
  const enDirect = useTempsReel((e) => {
    setRevision((r) => r + 1);
    setToast(e === 'import' ? 'Nouvel extrait importé : les chiffres sont à jour.' : 'Équipe SI mise à jour.');
    setTimeout(() => setToast(''), 4000);
  });
  useEffect(() => {
    api('/historique').then((d) => setDernier(d.imports[0] || null)).catch(() => {});
  }, [revision]);

  return (
    <RevisionCtx.Provider value={revision}>
      <header className="top">
        <div className="top-row">
          <div>
            <h1>Migration mSupply → Open mSupply</h1>
            <p>{dernier ? `Extrait du ${fmtDateHeure(dernier.genere_le)}${dernier.genere_par ? ` · généré par ${dernier.genere_par}` : ''} · importé le ${fmtDateHeure(dernier.importe_le)}` : 'Aucun extrait importé'}</p>
          </div>
          <div className="actions">
            <span className={`en-direct ${enDirect ? 'on' : ''}`} title="Connexion temps réel"><i />{enDirect ? 'En direct' : 'Hors ligne'}</span>
            {peut('contributeur') && <NavLink className="btn primaire" to="/importer">Importer un extrait</NavLink>}
            <span className="sub" style={{ margin: 0 }}>{utilisateur.nom}</span>
            <button className="btn" type="button" onClick={deconnexion}>Se déconnecter</button>
          </div>
        </div>
        <nav className="tabs">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'actif' : '')}>Vue d'ensemble</NavLink>
          <NavLink to="/sites" className={({ isActive }) => (isActive ? 'actif' : '')}>Sites</NavLink>
          <NavLink to="/equipe-si" className={({ isActive }) => (isActive ? 'actif' : '')}>Équipe SI</NavLink>
          <NavLink to="/historique" className={({ isActive }) => (isActive ? 'actif' : '')}>Historique des imports</NavLink>
          {peut('admin') && <NavLink to="/administration" className={({ isActive }) => (isActive ? 'actif' : '')}>Administration</NavLink>}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<VueEnsemble />} />
          <Route path="/sites" element={<Sites />} />
          <Route path="/equipe-si" element={<EquipeSI />} />
          <Route path="/historique" element={<Historique />} />
          <Route path="/importer" element={peut('contributeur') ? <Importer /> : <Navigate to="/" />} />
          <Route path="/administration" element={peut('admin') ? <Administration /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </RevisionCtx.Provider>
  );
}

export default function App() {
  const { utilisateur, pret } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (pret && !utilisateur) navigate('/connexion', { replace: true }); }, [pret, utilisateur, navigate]);
  if (!pret) return null;
  return (
    <Routes>
      <Route path="/connexion" element={utilisateur ? <Navigate to="/" /> : <Connexion />} />
      <Route path="/*" element={utilisateur ? <Cadre /> : null} />
    </Routes>
  );
}
