import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import * as Ic from './components/Icones.jsx';
import { useAuth } from './auth.jsx';
import { useTempsReel } from './tempsReel.js';
import { api, fmtDateHeure } from './api.js';
import Connexion from './pages/Connexion.jsx';
import VueEnsemble from './pages/VueEnsemble.jsx';
import Sites from './pages/Sites.jsx';
import EquipeSI from './pages/EquipeSI.jsx';
import Carte from './pages/Carte.jsx';
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

const MENU = [
  { titre: 'Suivi', liens: [
    { to: '/', libelle: 'Tableau de bord', Icone: Ic.IcTableau, couleur: '#5e72e4', end: true },
    { to: '/sites', libelle: 'Sites', Icone: Ic.IcSites, couleur: '#fb6340' },
    { to: '/carte', libelle: 'Carte', Icone: Ic.IcCarte, couleur: '#f5365c' },
    { to: '/equipe-si', libelle: 'Équipe SI', Icone: Ic.IcEquipe, couleur: '#11cdef' },
    { to: '/historique', libelle: 'Historique des imports', Icone: Ic.IcHistorique, couleur: '#2dce89' },
  ] },
  { titre: 'Gestion', liens: [
    { to: '/importer', libelle: 'Importer un extrait', Icone: Ic.IcImport, couleur: '#ffb236', role: 'contributeur' },
    { to: '/administration', libelle: 'Administration', Icone: Ic.IcAdmin, couleur: '#8965e0', role: 'admin' },
  ] },
];
const TITRES = { '/': 'Tableau de bord', '/sites': 'Sites', '/carte': 'Carte', '/equipe-si': 'Équipe SI', '/historique': 'Historique des imports', '/importer': 'Importer un extrait', '/administration': 'Administration' };
const initiales = (nom) => String(nom || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0].toUpperCase()).join('');

function Cadre() {
  const { utilisateur, deconnexion, peut } = useAuth();
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState('');
  const [dernier, setDernier] = useState(null);
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [recherche, setRecherche] = useState('');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const enDirect = useTempsReel((e) => {
    setRevision((r) => r + 1);
    setToast(e === 'import' ? 'Nouvel extrait importé : les chiffres sont à jour.' : 'Équipe SI mise à jour.');
    setTimeout(() => setToast(''), 4000);
  });
  useEffect(() => {
    api('/historique').then((d) => setDernier(d.imports[0] || null)).catch(() => {});
  }, [revision]);
  useEffect(() => { setMenuOuvert(false); }, [pathname]);

  const chercher = (e) => {
    e.preventDefault();
    navigate(`/sites${recherche.trim() ? `?q=${encodeURIComponent(recherche.trim())}` : ''}`);
  };

  return (
    <RevisionCtx.Provider value={revision}>
      <div className={`app ${menuOuvert ? 'menu-ouvert' : ''}`}>
        <aside className="sidenav" aria-label="Menu principal">
          <div className="sidenav-logo">
            <span className="logo-ic"><Ic.IcLogo width={22} height={22} /></span>
            <span><b>Open mSupply</b><small>Suivi de la migration · LHSPLA</small></span>
          </div>
          <nav>
            {MENU.map((g) => {
              const liens = g.liens.filter((l) => !l.role || peut(l.role));
              if (!liens.length) return null;
              return (
                <div key={g.titre} className="sidenav-groupe">
                  <h6>{g.titre}</h6>
                  {liens.map(({ to, libelle, Icone, couleur, end }) => (
                    <NavLink key={to} to={to} end={end} className={({ isActive }) => `sidenav-lien ${isActive ? 'actif' : ''}`}>
                      <Icone style={{ color: couleur }} /><span>{libelle}</span>
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="sidenav-pied">
            <span className={`en-direct ${enDirect ? 'on' : ''}`} title="Connexion temps réel"><i />{enDirect ? 'Données en direct' : 'Hors ligne'}</span>
            {dernier && <small>Extrait du {fmtDateHeure(dernier.genere_le)}<br />importé le {fmtDateHeure(dernier.importe_le)}</small>}
          </div>
        </aside>
        <button className="voile" type="button" aria-label="Fermer le menu" onClick={() => setMenuOuvert(false)} />

        <div className="principal">
          <header className="bandeau">
            <div className="bandeau-haut">
              <button className="btn-menu" type="button" aria-label="Ouvrir le menu" onClick={() => setMenuOuvert(true)}><Ic.IcMenu /></button>
              <h1>{TITRES[pathname] || 'Tableau de bord'}</h1>
              <form className="recherche" onSubmit={chercher} role="search">
                <Ic.IcRecherche />
                <input type="search" placeholder="Rechercher un site, un district…" aria-label="Rechercher un site" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
              </form>
              <div className="utilisateur">
                <span className="avatar" aria-hidden="true">{initiales(utilisateur.nom)}</span>
                <span className="nom">{utilisateur.nom}</span>
                <button className="btn-sortie" type="button" onClick={deconnexion} title="Se déconnecter" aria-label="Se déconnecter"><Ic.IcSortie /></button>
              </div>
            </div>
          </header>
          <main className="contenu">
            <Routes>
              <Route path="/" element={<VueEnsemble />} />
              <Route path="/sites" element={<Sites />} />
              <Route path="/equipe-si" element={<EquipeSI />} />
              <Route path="/carte" element={<Carte />} />
              <Route path="/historique" element={<Historique />} />
              <Route path="/importer" element={peut('contributeur') ? <Importer /> : <Navigate to="/" />} />
              <Route path="/administration" element={peut('admin') ? <Administration /> : <Navigate to="/" />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
            <footer className="pied">© 2026 LHSPLA · Équipe Système d'information · Suivi de la migration mSupply → Open mSupply</footer>
          </main>
        </div>
      </div>
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
