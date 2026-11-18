import { useEffect, useState } from 'react';
import { api, fmtDateHeure } from '../api.js';

const fmtN = (n) => Number(n).toLocaleString('fr-FR');

/**
 * Chargement d'une liste de référence par un administrateur (fichier Excel qui remplace la liste précédente).
 * `cfg` : chemin d'API, clé de la réponse, textes, nom du champ « total » et du champ « effectif par région ».
 */
export default function ListeAdmin({ cfg }) {
  const [liste, setListe] = useState(undefined); // undefined : chargement ; null : aucune liste
  const [fichier, setFichier] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const [avertissements, setAvertissements] = useState([]);

  const charger = () => api(cfg.chemin).then((d) => setListe(d[cfg.cle])).catch((e) => setErreur(e.message));
  useEffect(() => { charger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const envoyer = async (e) => {
    e.preventDefault();
    if (!fichier) return;
    const formulaire = e.target;
    setEnvoi(true);
    setErreur('');
    try {
      const d = await api(cfg.chemin, { methode: 'POST', fichier });
      setListe(d[cfg.cle]);
      setAvertissements(d.avertissements);
      setFichier(null);
      formulaire.reset();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  };

  const points = avertissements.length ? avertissements : (liste?.avertissements || []);
  return (
    <section className="panel">
      <h2>{cfg.titre}</h2>
      <p className="sub">{cfg.description}</p>
      {erreur && <div className="erreur" style={{ marginBottom: 10 }}>{erreur}</div>}
      {liste === null && <div className="info" style={{ marginBottom: 12 }}>{cfg.vide}</div>}
      {liste && (
        <div className="info" style={{ marginBottom: 12 }}>
          <b>{fmtN(liste[cfg.champTotal])} {cfg.unite}</b> dans {liste.regions.length} région{liste.regions.length > 1 ? 's' : ''} · fichier « {liste.nom_fichier} » chargé le {fmtDateHeure(liste.importe_le)}
          {liste.importe_par_nom ? ` par ${liste.importe_par_nom}` : ''}.
        </div>
      )}
      {liste?.types?.length > 0 && (
        <p className="sub" style={{ marginTop: -4 }}>Types de structure : {liste.types.map((t) => `${t.type} ${fmtN(t.n)}`).join(' · ')}</p>
      )}
      {liste?.deja_deployes?.length > 0 && (
        <div className="info" style={{ marginBottom: 12 }}>
          <b>{liste.deja_deployes.length} site{liste.deja_deployes.length > 1 ? 's' : ''} de la liste figure{liste.deja_deployes.length > 1 ? 'nt' : ''} dans le référentiel des dépôts</b> (tableau
          de bord mSupply) : nouveau{liste.deja_deployes.length > 1 ? 'x' : ''} site{liste.deja_deployes.length > 1 ? 's' : ''} déjà déployé{liste.deja_deployes.length > 1 ? 's' : ''} sur Open mSupply, retiré{liste.deja_deployes.length > 1 ? 's' : ''} des sites à migrer :{' '}
          {liste.deja_deployes.map((s) => `${s.nom} (${s.district})`).join(', ')}.
        </div>
      )}
      <form className="form-ligne" onSubmit={envoyer}>
        <label htmlFor={`fichier-${cfg.cle}`} className="sub" style={{ margin: 0 }}>{cfg.aide}</label>
        <input id={`fichier-${cfg.cle}`} type="file" accept=".xlsx" onChange={(e) => setFichier(e.target.files[0] || null)} />
        <button className="btn primaire" type="submit" disabled={!fichier || envoi}>{envoi ? 'Chargement…' : liste ? 'Remplacer la liste' : 'Charger la liste'}</button>
      </form>
      {points.length > 0 && (
        <>
          <p style={{ marginBottom: 4 }}><b>{points.length} point(s) à vérifier dans le fichier :</b></p>
          <ul style={{ marginTop: 0 }}>{points.map((a, k) => <li key={k}>{a}</li>)}</ul>
        </>
      )}
      {liste && (
        <div className="tablewrap" style={{ maxHeight: 320, overflow: 'auto' }}><table>
          <thead><tr><th>Région</th><th className="r">Districts</th><th className="r">{cfg.colonne}</th></tr></thead>
          <tbody>{liste.regions.map((r) => <tr key={r.region}><td>{r.region}</td><td className="r num">{r.districts}</td><td className="r num">{fmtN(r[cfg.champRegion])}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}

export const CFG_REFERENTIEL = {
  chemin: '/referentiel', cle: 'referentiel', titre: 'Référentiel des dépôts mSupply', unite: 'dépôts', colonne: 'Dépôts',
  champTotal: 'nb_depots', champRegion: 'depots',
  description: "Liste des dépôts du tableau de bord mSupply, par district et par région : tous les sites en service, nouveaux sites déjà déployés sur Open mSupply compris. Les sites à migrer d'un district sont ses dépôts moins ses nouveaux sites : les taux de migration du tableau de bord et de la carte sont calculés sur ce nombre, et non plus sur les seuls sites de l'extrait. Un nouveau fichier remplace le précédent.",
  vide: "Aucun référentiel chargé : les taux portent sur les sites de l'extrait.",
  aide: 'Fichier Excel (.xlsx) : Nom du dépôt, Catégorie, District, Région',
};

export const CFG_NOUVEAUX = {
  chemin: '/nouveaux-sites', cle: 'liste', titre: 'Nouveaux sites', unite: 'nouveaux sites', colonne: 'Nouveaux sites',
  champTotal: 'nb_sites', champRegion: 'n',
  description: "Liste des nouveaux sites : établissements sans version commerciale mSupply, à déployer directement sur Open mSupply (lignes dont le STATUT vaut « NOUVEAU SITE » ou « OUI »). Elle s'ajoute à chaque extrait de la DAP : un site déjà déclaré « Nouveau site » dans l'extrait n'est pas compté deux fois. Un nouveau fichier remplace le précédent.",
  vide: "Aucune liste chargée : seuls les « Nouveau site » déclarés dans l'extrait sont comptés.",
  aide: "Fichier Excel (.xlsx) : NOM D'ETABLISSEMENT, DISTRICT, REGION, RAISON, STATUT, TYPE SITE",
};
