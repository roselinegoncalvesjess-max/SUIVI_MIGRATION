import { useEffect, useState } from 'react';
import { api, fmtPeriode } from '../api.js';

export default function Administration() {
  return (
    <>
      <Objectifs />
      <Membres />
      <Utilisateurs />
    </>
  );
}

function useListe(chemin, cle) {
  const [liste, setListe] = useState([]);
  const [erreur, setErreur] = useState('');
  const recharger = () => api(chemin).then((d) => setListe(d[cle])).catch((e) => setErreur(e.message));
  useEffect(() => { recharger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { liste, erreur, setErreur, recharger };
}

function Objectifs() {
  const [o, setO] = useState(null);
  const [msg, setMsg] = useState({});
  useEffect(() => { api('/parametres').then(setO).catch((e) => setMsg({ erreur: e.message })); }, []);
  if (!o) return null;
  const enregistrer = async (e) => {
    e.preventDefault();
    try { setO(await api('/parametres', { methode: 'PUT', corps: { sites: o.sites, districts: o.districts, regions: o.regions, nouveaux: o.nouveaux } })); setMsg({ ok: 'Objectifs enregistrés.' }); }
    catch (err) { setMsg({ erreur: err.message }); }
  };
  return (
    <section className="panel">
      <h2>Objectifs nationaux</h2>
      <p className="sub">Le taux de migration national est calculé sur ces totaux (Côte d'Ivoire). Nouveaux sites : 0 tant que le nombre n'est pas connu.</p>
      <form className="form-ligne" onSubmit={enregistrer}>
        <label htmlFor="o-sites">Sites à migrer</label><input id="o-sites" type="number" min="1" value={o.sites} onChange={(e) => setO({ ...o, sites: e.target.value })} />
        <label htmlFor="o-dist">Districts</label><input id="o-dist" type="number" min="1" value={o.districts} onChange={(e) => setO({ ...o, districts: e.target.value })} />
        <label htmlFor="o-reg">Régions</label><input id="o-reg" type="number" min="1" value={o.regions} onChange={(e) => setO({ ...o, regions: e.target.value })} />
        <label htmlFor="o-nv">Nouveaux sites à déployer</label><input id="o-nv" type="number" min="0" title="0 = pas encore défini" value={o.nouveaux} onChange={(e) => setO({ ...o, nouveaux: e.target.value })} />
        <button className="btn primaire" type="submit">Enregistrer</button>
        {msg.ok && <span className="sub" style={{ margin: 0 }}>{msg.ok}</span>}
      </form>
      {msg.erreur && <div className="erreur" style={{ marginTop: 10 }}>{msg.erreur}</div>}
    </section>
  );
}

function Membres() {
  const { liste, erreur, setErreur, recharger } = useListe('/membres', 'membres');
  const [nom, setNom] = useState('');
  const [alias, setAlias] = useState({});
  const [ref, setRef] = useState({ districts: [], regions: [] });
  const [choix, setChoix] = useState({});
  const [nouveau, setNouveau] = useState({ nom: '', region: '' });
  const chargerRef = () => api('/districts').then(setRef).catch(() => {});
  useEffect(() => { chargerRef(); }, []);
  const agir = async (fn) => {
    setErreur('');
    try { await fn(); await recharger(); } catch (e) { setErreur(e.message); }
  };
  return (
    <section className="panel">
      <h2>Membres de l'équipe SI et alias</h2>
      <p className="sub">Chaque membre est responsable de tous les sites des districts qui lui sont affectés (et des districts où il est inscrit comme « Responsable » dans l'extrait).
        Un alias est le nom sous lequel un membre apparaît dans la colonne « Responsable » (ex. « Djereke Davila »).</p>
      {erreur && <div className="erreur" style={{ marginBottom: 10 }}>{erreur}</div>}
      <form className="form-ligne" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); agir(async () => { await api('/membres', { methode: 'POST', corps: { nom_complet: nom } }); setNom(''); }); }}>
        <input aria-label="Nom complet" placeholder="Nom complet du nouveau membre" value={nom} onChange={(e) => setNom(e.target.value)} required style={{ minWidth: 300 }} />
        <button className="btn primaire" type="submit">Ajouter le membre</button>
      </form>
      <div className="tablewrap"><table>
        <thead><tr><th>Membre</th><th>Actif</th><th>Districts affectés</th><th>Affecter un district</th><th>Alias</th><th>Ajouter un alias</th></tr></thead>
        <tbody>{liste.map((m) => (
          <tr key={m.id}>
            <td>{m.nom_complet}</td>
            <td><input type="checkbox" aria-label={`${m.nom_complet} actif`} checked={m.actif} onChange={(e) => agir(() => api(`/membres/${m.id}`, { methode: 'PUT', corps: { actif: e.target.checked } }))} /></td>
            <td>{m.affectations.length ? m.affectations.map((a) => (
              <span key={a.id} className="alias chip">{a.district}{a.vague !== null ? ` · V${a.vague}` : ''}{a.debut_mission ? ` · ${fmtPeriode(a.debut_mission, a.fin_mission)}` : ''}<button type="button" aria-label={`Retirer ${a.district}`} onClick={() => agir(() => api(`/affectations/${a.id}`, { methode: 'DELETE' }))}>×</button></span>
            )) : <span className="vide">—</span>}</td>
            <td>
              <form className="form-ligne" onSubmit={(e) => { e.preventDefault(); const c = choix[m.id] || {}; agir(async () => { await api(`/membres/${m.id}/districts`, { methode: 'POST', corps: { district_id: c.district, vague: c.vague, debut_mission: c.debut, fin_mission: c.fin } }); setChoix((x) => ({ ...x, [m.id]: {} })); }); }}>
                <select aria-label={`District pour ${m.nom_complet}`} value={choix[m.id]?.district || ''} onChange={(e) => setChoix((x) => ({ ...x, [m.id]: { ...x[m.id], district: e.target.value } }))} required>
                  <option value="">District…</option>
                  {ref.regions.map((r) => (
                    <optgroup key={r.id} label={r.nom}>{ref.districts.filter((d) => d.region_id === r.id).map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}</optgroup>
                  ))}
                </select>
                <input aria-label="Vague" type="number" min="0" placeholder="Vague" style={{ width: 80 }} value={choix[m.id]?.vague ?? ''} onChange={(e) => setChoix((x) => ({ ...x, [m.id]: { ...x[m.id], vague: e.target.value } }))} />
                <input aria-label="Début de mission" type="date" title="Début de mission" value={choix[m.id]?.debut || ''} onChange={(e) => setChoix((x) => ({ ...x, [m.id]: { ...x[m.id], debut: e.target.value } }))} />
                <input aria-label="Fin de mission" type="date" title="Fin de mission" value={choix[m.id]?.fin || ''} onChange={(e) => setChoix((x) => ({ ...x, [m.id]: { ...x[m.id], fin: e.target.value } }))} />
                <button className="btn" type="submit">Affecter</button>
              </form>
            </td>
            <td>{m.alias.length ? m.alias.map((a) => (
              <span key={a.id} className="alias chip">{a.libelle}<button type="button" aria-label={`Retirer l'alias ${a.libelle}`} onClick={() => agir(() => api(`/alias/${a.id}`, { methode: 'DELETE' }))}>×</button></span>
            )) : <span className="vide">—</span>}</td>
            <td>
              <form className="form-ligne" onSubmit={(e) => { e.preventDefault(); agir(async () => { await api(`/membres/${m.id}/alias`, { methode: 'POST', corps: { libelle: alias[m.id] } }); setAlias((x) => ({ ...x, [m.id]: '' })); }); }}>
                <input aria-label={`Nouvel alias pour ${m.nom_complet}`} placeholder="ex. Teki Fabien" value={alias[m.id] || ''} onChange={(e) => setAlias((x) => ({ ...x, [m.id]: e.target.value }))} required />
                <button className="btn" type="submit">Ajouter</button>
              </form>
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Ajouter un district absent des extraits</h3>
      <p className="sub">Pour affecter un membre à un district qui n'apparaît pas encore dans l'extrait (113 districts au total).</p>
      <form className="form-ligne" onSubmit={(e) => { e.preventDefault(); agir(async () => { await api('/districts', { methode: 'POST', corps: nouveau }); setNouveau({ nom: '', region: '' }); await chargerRef(); }); }}>
        <input aria-label="Nom du district" placeholder="Nom du district" value={nouveau.nom} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} required />
        <input aria-label="Région" placeholder="Région" list="liste-regions" value={nouveau.region} onChange={(e) => setNouveau({ ...nouveau, region: e.target.value })} required />
        <datalist id="liste-regions">{ref.regions.map((r) => <option key={r.id} value={r.nom} />)}</datalist>
        <button className="btn" type="submit">Ajouter le district</button>
      </form>
    </section>
  );
}

function Utilisateurs() {
  const { liste, erreur, setErreur, recharger } = useListe('/utilisateurs', 'utilisateurs');
  const [f, setF] = useState({ identifiant: '', nom: '', motDePasse: '', role: 'lecteur' });
  const agir = async (fn) => {
    setErreur('');
    try { await fn(); await recharger(); } catch (e) { setErreur(e.message); }
  };
  return (
    <section className="panel">
      <h2>Utilisateurs</h2>
      <p className="sub">Lecteur : consulte les écrans. Contributeur : peut aussi importer des extraits. Administrateur : gère l'équipe et les comptes.</p>
      {erreur && <div className="erreur" style={{ marginBottom: 10 }}>{erreur}</div>}
      <form className="form-ligne" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); agir(async () => { await api('/utilisateurs', { methode: 'POST', corps: f }); setF({ identifiant: '', nom: '', motDePasse: '', role: 'lecteur' }); }); }}>
        <input aria-label="Identifiant" placeholder="Identifiant" value={f.identifiant} onChange={(e) => setF({ ...f, identifiant: e.target.value })} required />
        <input aria-label="Nom affiché" placeholder="Nom affiché" value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} />
        <input aria-label="Mot de passe" type="password" placeholder="Mot de passe (8 car. min.)" minLength={8} value={f.motDePasse} onChange={(e) => setF({ ...f, motDePasse: e.target.value })} required />
        <select aria-label="Rôle" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="lecteur">Lecteur</option><option value="contributeur">Contributeur</option><option value="admin">Administrateur</option>
        </select>
        <button className="btn primaire" type="submit">Créer le compte</button>
      </form>
      <div className="tablewrap"><table>
        <thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th>Actif</th></tr></thead>
        <tbody>{liste.map((u) => (
          <tr key={u.id}>
            <td>{u.identifiant}</td><td>{u.nom || '—'}</td>
            <td><select aria-label={`Rôle de ${u.identifiant}`} value={u.role} onChange={(e) => agir(() => api(`/utilisateurs/${u.id}`, { methode: 'PUT', corps: { role: e.target.value } }))}>
              <option value="lecteur">Lecteur</option><option value="contributeur">Contributeur</option><option value="admin">Administrateur</option>
            </select></td>
            <td><input type="checkbox" aria-label={`${u.identifiant} actif`} checked={u.actif} onChange={(e) => agir(() => api(`/utilisateurs/${u.id}`, { methode: 'PUT', corps: { actif: e.target.checked } }))} /></td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}
