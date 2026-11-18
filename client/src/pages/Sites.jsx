import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Etat, useDonnees } from '../App.jsx';
import { CATEGORIES, STATUTS, api, fmtDate, fmtPct, fmtPeriode } from '../api.js';
import { Categorie, Statut } from '../components/Elements.jsx';

const CHAMPS = ['q', 'region', 'district', 'statut', 'vague', 'type', 'categorie', 'retard'];

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
        <select aria-label="Type de site" value={params.get('type') || ''} onChange={(e) => changer('type', e.target.value)}>
          <option value="">Tous les types</option>
          <option value="MIGRATION">Migration</option>
          <option value="NOUVEAU">Nouveau site</option>
        </select>
        <select aria-label="Catégorie de site" value={params.get('categorie') || ''} onChange={(e) => changer('categorie', e.target.value)}>
          <option value="">Toutes les catégories</option>
          {Object.entries(CATEGORIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="sub" style={{ margin: 0, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={params.get('retard') === '1'} onChange={(e) => changer('retard', e.target.checked ? '1' : '')} /> En retard
        </label>
        <button className="btn" type="button" onClick={() => { setQ(''); setParams({}, { replace: true }); }}>Réinitialiser</button>
        {etat.donnees && <span className="sub" style={{ margin: '0 0 0 auto' }}>{etat.donnees.sites.length} site{etat.donnees.sites.length > 1 ? 's' : ''}</span>}
      </div>
      {params.get('vague') && <ResumeVague vague={params.get('vague')} params={params} changer={changer} />}
      <Etat etat={etat}>{(d) => (
        <div className="tablewrap" style={{ maxHeight: '70vh', overflow: 'auto' }}><table>
          <thead><tr><th>Site</th><th>Région</th><th>District</th><th>Vague</th><th>Responsable</th><th>Catégorie</th><th>Statut</th><th>Prévu le</th><th>Date de migration</th><th>Mission</th></tr></thead>
          <tbody>
            {d.sites.length === 0 && <tr><td colSpan={10} className="vide">Aucun site ne correspond à ces filtres.</td></tr>}
            {d.sites.map((s) => (
              <tr key={s.id}>
                <td>{s.type_site === 'NOUVEAU' && <span className="badge-nv">Nouveau</span>}{s.site}{s.difficultes && !/^ras\.?$/i.test(s.difficultes.trim()) && <span className="pill" style={{ color: 'var(--crit)', marginLeft: 6 }} title={s.difficultes}>Difficulté</span>}</td>
                <td>{s.region}</td><td>{s.district}</td><td className="num">{s.vague ?? '—'}</td>
                <td>{s.responsable_libelle || '—'}{s.membre && <span className="chip" style={{ marginLeft: 6 }} title={s.membre}>SI</span>}</td>
                <td><Categorie categorie={s.categorie} /></td><td><Statut statut={s.statut} /></td>
                <td className="num">{fmtDate(s.date_prevue)}</td><td className="num"><b>{fmtDate(s.date_migration)}</b></td>
                <td className="num sub" style={{ margin: 0 }}>{fmtPeriode(s.debut_mission, s.fin_mission)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}</Etat>
    </section>
  );
}

const TYPES = { MIGRATION: 'Migration', NOUVEAU: 'Nouveau site' };

/** Résumé d'une vague : ses sites par région, district, statut, type et catégorie. Un clic sur une ligne filtre la liste. */
function ResumeVague({ vague, params, changer }) {
  const etat = useDonnees(`/sites?vague=${encodeURIComponent(vague)}`);
  const sites = etat.donnees?.sites;
  const facettes = useMemo(() => {
    if (!sites) return null;
    const grouper = (champ, libelle) => {
      const m = new Map();
      for (const s of sites) {
        const v = s[champ];
        if (v === null || v === undefined) continue;
        if (!m.has(v)) m.set(v, { cle: String(v), libelle: libelle(s), n: 0, migres: 0 });
        const g = m.get(v);
        g.n++;
        if (s.statut === 'TERMINE' && s.type_site === 'MIGRATION') g.migres++;
      }
      return [...m.values()].sort((a, b) => b.n - a.n || a.libelle.localeCompare(b.libelle, 'fr'));
    };
    return {
      region: grouper('region_id', (s) => s.region), district: grouper('district_id', (s) => s.district),
      statut: grouper('statut', (s) => STATUTS[s.statut] || s.statut), type: grouper('type_site', (s) => TYPES[s.type_site] || s.type_site),
      categorie: grouper('categorie', (s) => CATEGORIES[s.categorie] || s.categorie),
    };
  }, [sites]);
  if (!sites) return null;

  const aMigrer = sites.filter((s) => s.type_site === 'MIGRATION');
  const migres = aMigrer.filter((s) => s.statut === 'TERMINE').length;
  const colonne = (titre, champ, param, avecMigres) => (
    <div className="facette">
      <h4>{titre} ({facettes[champ].length})</h4>
      <div className="liste"><table>
        <thead><tr><th /><th>Sites</th>{avecMigres && <th>Migrés</th>}</tr></thead>
        <tbody>{facettes[champ].map((g) => (
          <tr key={g.cle} className={params.get(param) === g.cle ? 'actif' : ''} onClick={() => changer(param, params.get(param) === g.cle ? '' : g.cle)}>
            <td>{g.libelle}</td><td className="r num">{g.n}</td>{avecMigres && <td className="r num">{g.migres}</td>}
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
  return (
    <div className="resume-vague">
      <h3><span className="chip">Vague {vague}</span> Résumé de la vague</h3>
      <p className="sub">
        {sites.length} site{sites.length > 1 ? 's' : ''} · {migres} migré{migres > 1 ? 's' : ''} sur {aMigrer.length} à migrer ({fmtPct(aMigrer.length ? (100 * migres) / aMigrer.length : 0)})
        · {facettes.region.length} région{facettes.region.length > 1 ? 's' : ''} · {facettes.district.length} district{facettes.district.length > 1 ? 's' : ''}.
        Cliquez une ligne pour filtrer la liste.
      </p>
      <div className="resume-grille">
        {colonne('Régions', 'region', 'region', true)}
        {colonne('Districts', 'district', 'district', true)}
        {colonne('Statuts', 'statut', 'statut', false)}
        {colonne('Types', 'type', 'type', false)}
        {colonne('Catégories', 'categorie', 'categorie', true)}
      </div>
    </div>
  );
}
