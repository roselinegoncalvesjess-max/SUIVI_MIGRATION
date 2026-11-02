import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Etat, useDonnees } from '../App.jsx';
import { STATUTS, api, fmtDate } from '../api.js';
import { Etapes, Statut } from '../components/Elements.jsx';

const CHAMPS = ['q', 'region', 'district', 'statut', 'vague', 'retard'];

export default function Sites() {
  const [params, setParams] = useSearchParams();
  const [filtres, setFiltres] = useState({ regions: [], districts: [], vagues: [] });
  const [q, setQ] = useState(params.get('q') || '');
  useEffect(() => { api('/filtres').then(setFiltres).catch(() => {}); }, []);

  // La recherche texte est appliquée après une courte pause de frappe
  useEffect(() => {
    const t = setTimeout(() => changer('q', q), 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const requete = new URLSearchParams(CHAMPS.flatMap((k) => (params.get(k) ? [[k, params.get(k)]] : []))).toString();
  const etat = useDonnees(`/sites${requete ? `?${requete}` : ''}`);

  function changer(cle, valeur) {
    const p = new URLSearchParams(params);
    valeur ? p.set(cle, valeur) : p.delete(cle);
    if (cle === 'region') p.delete('district');
    if (p.toString() !== params.toString()) setParams(p, { replace: true });
  }
  const regionChoisie = params.get('region');
  const districts = filtres.districts.filter((d) => !regionChoisie || String(d.region_id) === regionChoisie);

  return (
    <section className="panel">
      <div className="filtres">
        <input type="search" placeholder="Site, district, responsable…" aria-label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Région" value={params.get('region') || ''} onChange={(e) => changer('region', e.target.value)}>
          <option value="">Toutes les régions</option>
          {filtres.regions.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
        </select>
        <select aria-label="District" value={params.get('district') || ''} onChange={(e) => changer('district', e.target.value)}>
          <option value="">Tous les districts</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
        </select>
        <select aria-label="Statut" value={params.get('statut') || ''} onChange={(e) => changer('statut', e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Vague" value={params.get('vague') || ''} onChange={(e) => changer('vague', e.target.value)}>
          <option value="">Toutes les vagues</option>
          {filtres.vagues.map((v) => <option key={v} value={v}>Vague {v}</option>)}
        </select>
        <label className="sub" style={{ margin: 0, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={params.get('retard') === '1'} onChange={(e) => changer('retard', e.target.checked ? '1' : '')} /> En retard
        </label>
        <button className="btn" type="button" onClick={() => { setQ(''); setParams({}, { replace: true }); }}>Réinitialiser</button>
        {etat.donnees && <span className="sub" style={{ margin: '0 0 0 auto' }}>{etat.donnees.sites.length} site{etat.donnees.sites.length > 1 ? 's' : ''}</span>}
      </div>
      <Etat etat={etat}>{(d) => (
        <div className="tablewrap" style={{ maxHeight: '70vh', overflow: 'auto' }}><table>
          <thead><tr><th>Site</th><th>Région</th><th>District</th><th>Vague</th><th>Responsable</th><th>Statut</th><th>Étapes 1 → 9</th><th className="r">Avanc.</th><th>Prévu le</th><th>Fin réelle</th></tr></thead>
          <tbody>
            {d.sites.length === 0 && <tr><td colSpan={10} className="vide">Aucun site ne correspond à ces filtres.</td></tr>}
            {d.sites.map((s) => (
              <tr key={s.id}>
                <td>{s.site}{s.difficultes && !/^ras\.?$/i.test(s.difficultes.trim()) && <span className="pill" style={{ color: 'var(--crit)', marginLeft: 6 }} title={s.difficultes}>Difficulté</span>}</td>
                <td>{s.region}</td><td>{s.district}</td><td className="num">{s.vague ?? '—'}</td>
                <td>{s.responsable_libelle || '—'}{s.membre && <span className="chip" style={{ marginLeft: 6 }} title={s.membre}>SI</span>}</td>
                <td><Statut statut={s.statut} /></td><td><Etapes etapes={s.etapes} /></td>
                <td className="r num">{s.avancement} %</td><td className="num">{fmtDate(s.date_prevue)}</td><td className="num">{fmtDate(s.fin_reelle)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}</Etat>
    </section>
  );
}
