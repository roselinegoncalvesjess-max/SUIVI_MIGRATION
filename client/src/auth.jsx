import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, jeton } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);
const NIVEAUX = { lecteur: 1, contributeur: 2, admin: 3 };

export function AuthProvider({ children }) {
  const [utilisateur, setUtilisateur] = useState(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    if (!jeton.lire()) { setPret(true); return; }
    api('/auth/moi').then((d) => setUtilisateur(d.utilisateur)).catch(() => jeton.ecrire(null)).finally(() => setPret(true));
  }, []);

  const deconnexion = useCallback(() => { jeton.ecrire(null); setUtilisateur(null); }, []);
  useEffect(() => {
    window.addEventListener('session-expiree', deconnexion);
    return () => window.removeEventListener('session-expiree', deconnexion);
  }, [deconnexion]);

  const connexion = async (identifiant, motDePasse) => {
    const d = await api('/auth/connexion', { methode: 'POST', corps: { identifiant, motDePasse } });
    jeton.ecrire(d.jeton);
    setUtilisateur(d.utilisateur);
  };
  const peut = (role) => (NIVEAUX[utilisateur?.role] || 0) >= NIVEAUX[role];

  return <Ctx.Provider value={{ utilisateur, pret, connexion, deconnexion, peut }}>{children}</Ctx.Provider>;
}
