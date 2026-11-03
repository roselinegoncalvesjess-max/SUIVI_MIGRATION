// Petit client pour l'API : ajoute le jeton et transforme les erreurs en messages lisibles.
const CLE = 'suivi-migration-jeton';

export const jeton = {
  lire: () => { try { return localStorage.getItem(CLE); } catch { return null; } },
  ecrire: (j) => { try { j ? localStorage.setItem(CLE, j) : localStorage.removeItem(CLE); } catch { /* stockage indisponible */ } },
};

export class ErreurApi extends Error {
  constructor(message, statut, corps) { super(message); this.statut = statut; this.corps = corps; }
}

export async function api(chemin, { methode = 'GET', corps, fichier } = {}) {
  const entetes = {};
  const j = jeton.lire();
  if (j) entetes.Authorization = `Bearer ${j}`;
  let body;
  if (fichier) {
    body = new FormData();
    body.append('fichier', fichier);
  } else if (corps !== undefined) {
    entetes['Content-Type'] = 'application/json';
    body = JSON.stringify(corps);
  }
  let rep;
  try {
    rep = await fetch(`/api${chemin}`, { method: methode, headers: entetes, body });
  } catch {
    throw new ErreurApi('Serveur injoignable. Vérifiez votre connexion.', 0);
  }
  if (rep.status === 204) return null;
  const donnees = await rep.json().catch(() => ({}));
  if (!rep.ok) {
    if (rep.status === 401) window.dispatchEvent(new Event('session-expiree'));
    throw new ErreurApi(donnees.erreur || `Erreur ${rep.status}`, rep.status, donnees);
  }
  return donnees;
}

export const fmtDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const fmtDateHeure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Abidjan' }) : '—');
export const fmtPct = (v, d = 1) => `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
export const STATUTS = { TERMINE: 'Terminé', EN_COURS: 'En cours', NON_DEMARRE: 'Non démarré', NON_APPLICABLE: 'Non applicable' };
export const CATEGORIES = { ESPC: 'ESPC', DISTRICT_SANITAIRE: 'District sanitaire', HOPITAL_REFERENCE: 'Hôpital de référence', A_CLASSER: 'À classer' };
export const fmtPeriode = (debut, fin) => (debut || fin ? `${fmtDate(debut)} → ${fmtDate(fin)}` : '—');
