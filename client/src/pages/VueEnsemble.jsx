import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Etat, useDonnees } from '../App.jsx';
import { fmtDate, fmtPct, fmtPeriode } from '../api.js';

const fmtN = (n) => Number(n).toLocaleString('fr-FR');
import { Categorie, Statut, Taux } from '../components/Elements.jsx';

export default function VueEnsemble() {
  const etat = useDonnees('/tableau-de-bord');
  return <Etat etat={etat}>{(d) => <Contenu d={d} />}</Etat>;
}

function Contenu({ d }) {
  const s = d.synthese;
  const navigate = useNavigate();
  return (
    <>
      <div className="kpis">
        <div className="kpi hero">
          <div className="lab"><span className="dot T" /> Taux de migration national vers Open mSupply</div>
          <div className="val num">{fmtPct(s.taux_national)} <small>· {fmtN(s.migres)} sites migrés sur {fmtN(s.objectif_sites)}</small></div>
          <div className="bar"><span className="T" style={{ width: `${s.taux_national}%` }} /></div>
          <div className="foot">
            {s.evolution === null ? 'Premier import enregistré' : `${s.evolution >= 0 ? '+' : ''}${s.evolution} sites migrés depuis l'import précédent`}
            {' · '}Sites à migrer suivis dans l'extrait : {fmtN(s.sites)} ({fmtPct(s.taux)} migrés)
            {s.nouveaux > 0 && <> · <b>{fmtN(s.sites_open_msupply)}</b> sites au total sur Open mSupply (migrés + nouveaux)</>}
          </div>
        </div>
        <div className="kpi"><div className="lab">Sites restant à migrer</div><div className="val num">{fmtN(s.sites_restants)}</div><div className="foot">dont {fmtN(s.sites_hors_extrait)} pas encore dans l'extrait</div></div>
        <div className="kpi"><div className="lab">Régions</div><div className="val num">{s.regions_touchees} <small>/ {s.objectif_regions}</small></div><div className="foot">avec au moins un site migré · {s.regions_completes} complètes dans l'extrait</div></div>
        <div className="kpi"><div className="lab">Districts</div><div className="val num">{s.districts_touches} <small>/ {s.objectif_districts}</small></div><div className="foot">avec au moins un site migré · {s.districts_complets} complets dans l'extrait</div></div>
        <div className="kpi nouveau"><div className="lab"><span className="dot nv" /> Nouveaux sites</div>
          <div className="val num">{s.nouveaux_deployes} <small>/ {s.objectif_nouveaux || s.nouveaux}</small></div>
          <div className="foot">{s.nouveaux || s.objectif_nouveaux ? `déployés directement sur Open mSupply · ${s.nouveaux_en_cours} en cours` : 'aucun nouveau site dans l\'extrait (colonne « Type de site »)'}</div></div>
        <div className="kpi"><div className="lab"><span className="dot C" /> En cours</div><div className="val num">{s.en_cours}</div><div className="foot">{s.non_demarres} non démarrés · {s.en_retard} en retard</div></div>
      </div>

      <RegionsDistricts regions={d.regions} total={s} />

      <NouveauxSites />

      <div className="grid2">
        <section className="panel">
          <h2>Rythme de migration</h2>
          <p className="sub">Cumul des sites migrés à leur date de migration, comparé au planning (date prévue)</p>
          <Rythme rythme={d.rythme} total={s.sites} />
        </section>
        <section className="panel">
          <h2>Répartition par catégorie de site</h2>
          <p className="sub">ESPC (CSR, DR, CSI, CSU, FSU, CAT, ONG, DM), districts sanitaires (DS) et hôpitaux de référence (HG, EPHD, CHU, CHR), d'après le nom du site</p>
          <div className="tablewrap"><table>
            <thead><tr><th>Catégorie</th><th className="r">Sites à migrer</th><th className="r">Migrés</th><th>Taux de migration</th><th className="r">En cours</th><th className="r">Non démarrés</th><th className="r">Nouveaux</th></tr></thead>
            <tbody>{d.categories.map((c) => (
              <tr key={c.categorie} className="click" onClick={() => navigate(`/sites?categorie=${c.categorie}`)}>
                <td><Categorie categorie={c.categorie} /></td><td className="r num">{c.sites}</td><td className="r num">{c.migres}</td>
                <td><Taux valeur={c.taux} complet={c.complet} /></td><td className="r num">{c.en_cours}</td><td className="r num">{c.non_demarres}</td>
                <td className="r num">{c.nouveaux || '—'}</td></tr>
            ))}</tbody>
          </table></div>
          {d.categories.some((c) => c.categorie === 'A_CLASSER') && <p className="sub" style={{ marginTop: 8 }}>« À classer » : aucun sigle reconnu dans le nom ; renseignez la colonne « Catégorie de site » du fichier Excel.</p>}
        </section>
      </div>

      <Missions missions={d.missions} />

      <div className="grid2">
        <section className="panel">
          <h2>Avancement par vague</h2>
          <p className="sub">Répartition des sites de chaque vague</p>
          <div className="tablewrap"><table>
            <thead><tr><th>Vague</th><th className="r">Sites</th><th className="r">Migrés</th><th className="r">En cours</th><th className="r">Non démarrés</th><th>Taux</th></tr></thead>
            <tbody>{d.vagues.map((v) => (
              <tr key={v.vague ?? 'x'}><td><span className="chip">Vague {v.vague ?? '—'}</span></td><td className="r num">{v.sites}</td><td className="r num">{v.migres}</td><td className="r num">{v.en_cours}</td><td className="r num">{v.non_demarres}</td><td><Taux valeur={v.taux} complet={v.complet} /></td></tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="panel">
          <h2>Sites en retard</h2>
          <p className="sub">Date prévue dépassée et migration non terminée</p>
          {d.retards.length === 0 ? <div className="info">Aucun site en retard sur le planning.</div> : (
            <div className="tablewrap"><table>
              <thead><tr><th>Site</th><th>District</th><th>Prévu le</th><th>Statut</th></tr></thead>
              <tbody>{d.retards.map((r) => <tr key={r.id}><td>{r.site}</td><td>{r.district}</td><td className="num">{fmtDate(r.date_prevue)}</td><td><Statut statut={r.statut} /></td></tr>)}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}

function RegionsDistricts({ regions, total }) {
  const [ouvertes, setOuvertes] = useState(() => new Set());
  const navigate = useNavigate();
  const basculer = (id) => setOuvertes((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2>Taux de migration par région et par district</h2>
          <p className="sub">Régions et districts présents dans l'extrait : sites migrés rapportés au nombre de sites de chacun. Dépliez une région pour voir ses districts ; cliquez un district pour voir ses sites.</p>
        </div>
        <div className="actions">
          <button className="btn" type="button" onClick={() => setOuvertes(new Set(regions.map((r) => r.id)))}>Tout déplier</button>
          <button className="btn" type="button" onClick={() => setOuvertes(new Set())}>Tout replier</button>
        </div>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Région / district</th><th className="r">Sites à migrer</th><th className="r">Sites migrés</th><th>Taux de migration</th><th className="r">En cours</th><th className="r">Non démarrés</th><th className="r">Nouveaux sites<br /><span style={{ fontWeight: 400 }}>déployés / total</span></th><th>Période de migration<br /><span style={{ fontWeight: 400 }}>début → fin de mission</span></th></tr></thead>
        <tbody>
          {regions.map((r) => (
            <Fragment key={r.id}>
              <tr className="region" onClick={() => basculer(r.id)} onKeyDown={(e) => e.key === 'Enter' && basculer(r.id)} tabIndex={0} aria-expanded={ouvertes.has(r.id)}>
                <td><span className={`caret ${ouvertes.has(r.id) ? 'ouvert' : ''}`}>▸</span>{r.nom} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {r.districts.length} district{r.districts.length > 1 ? 's' : ''}</span></td>
                <td className="r num">{r.sites}</td><td className="r num">{r.migres}</td>
                <td><Taux valeur={r.taux} complet={r.complet} gras /></td>
                <td className="r num">{r.en_cours}</td><td className="r num">{r.non_demarres}</td>
                <td className="r num">{r.nouveaux ? `${r.nouveaux_deployes} / ${r.nouveaux}` : '—'}</td>
                <td />
              </tr>
              {ouvertes.has(r.id) && r.districts.map((d) => (
                <tr className="district" key={d.id}>
                  <td><button className="lien" type="button" onClick={() => navigate(`/sites?region=${r.id}&district=${d.id}`)}>{d.nom}</button></td>
                  <td className="r num">{d.sites}</td><td className="r num">{d.migres}</td>
                  <td><Taux valeur={d.taux} complet={d.complet} /></td>
                  <td className="r num">{d.en_cours}</td><td className="r num">{d.non_demarres}</td>
                  <td className="r num">{d.nouveaux ? `${d.nouveaux_deployes} / ${d.nouveaux}` : '—'}</td>
                  <td className="num">{fmtPeriode(d.debut_mission, d.fin_mission)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          <tr className="total"><td>Total</td><td className="r num">{total.sites}</td><td className="r num">{total.migres}</td><td>{fmtPct(total.taux)}</td><td className="r num">{total.en_cours}</td><td className="r num">{total.non_demarres}</td><td className="r num">{total.nouveaux ? `${total.nouveaux_deployes} / ${total.nouveaux}` : '—'}</td><td /></tr>
        </tbody>
      </table></div>
    </section>
  );
}

function Rythme({ rythme, total }) {
  // Fusionne les deux séries sur un même axe de dates (valeur reportée tant qu'elle ne change pas).
  const donnees = useMemo(() => {
    const dates = [...new Set([...rythme.reel, ...rythme.prevu].map((p) => p.date))].sort();
    let r = 0;
    let p = 0;
    const R = new Map(rythme.reel.map((x) => [x.date, x.cumul]));
    const P = new Map(rythme.prevu.map((x) => [x.date, x.cumul]));
    return dates.map((date) => {
      if (R.has(date)) r = R.get(date);
      if (P.has(date)) p = P.get(date);
      return { date, reel: r, prevu: p };
    });
  }, [rythme]);
  if (!donnees.length) return <p className="vide">Pas encore de dates à représenter.</p>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={donnees} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="#e2e7ea" vertical={false} />
        <XAxis dataKey="date" tickFormatter={(v) => fmtDate(v).slice(0, 5)} tick={{ fontSize: 11, fill: '#7d8a91' }} minTickGap={24} />
        <YAxis domain={[0, Math.ceil(total / 100) * 100]} tickCount={5} allowDecimals={false} tick={{ fontSize: 11, fill: '#7d8a91' }} />
        <ReferenceLine y={total} stroke="#7d8a91" strokeDasharray="2 4" label={{ value: `Total : ${total} sites`, position: 'insideTopLeft', fontSize: 11, fill: '#7d8a91' }} />
        <Tooltip labelFormatter={fmtDate} formatter={(v, n) => [v, n]} />
        <Legend verticalAlign="top" align="left" height={28} iconType="plainline" />
        <Area type="stepAfter" dataKey="reel" name="Migrés (réel)" stroke="#2a78d6" fill="#2a78d6" fillOpacity={0.1} strokeWidth={2} />
        <Line type="stepAfter" dataKey="prevu" name="Prévus (planning)" stroke="#eb6834" strokeDasharray="5 4" dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function NouveauxSites() {
  const etat = useDonnees('/sites?type=NOUVEAU');
  const navigate = useNavigate();
  const liste = etat.donnees?.sites || [];
  return (
    <section className="panel nouveaux">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2><span className="badge-nv">Nouveau</span> Nouveaux sites à déployer sur Open mSupply</h2>
          <p className="sub">Sites sans version commerciale, déployés directement sur Open mSupply (colonne « Type de site » = « Nouveau site »). Ils ne comptent pas dans le taux de migration.</p>
        </div>
        {liste.length > 0 && <button className="btn" type="button" onClick={() => navigate('/sites?type=NOUVEAU')}>Voir dans la liste des sites</button>}
      </div>
      {etat.chargement && !etat.donnees ? <p className="vide">Chargement…</p> : liste.length === 0 ? (
        <div className="info">Aucun nouveau site dans le dernier extrait. Renseignez « Nouveau site » dans la colonne « Type de site » du fichier Excel pour les faire apparaître ici.</div>
      ) : (
        <div className="tablewrap" style={{ maxHeight: 360, overflow: 'auto' }}><table>
          <thead><tr><th>Site</th><th>Région</th><th>District</th><th>Vague</th><th>Responsable</th><th>Statut</th><th>Prévu le</th><th>Date de déploiement</th></tr></thead>
          <tbody>{liste.map((x) => (
            <tr key={x.id}><td>{x.site}</td><td>{x.region}</td><td>{x.district}</td><td className="num">{x.vague ?? '—'}</td><td>{x.responsable_libelle || '—'}</td>
              <td><Statut statut={x.statut} /></td><td className="num">{fmtDate(x.date_prevue)}</td><td className="num">{fmtDate(x.date_migration)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Missions({ missions }) {
  const navigate = useNavigate();
  return (
    <section className="panel">
      <h2>Périodes de migration (missions)</h2>
      <p className="sub">Une mission par district et par vague : du début à la fin de la mission. Dates saisies dans le fichier Excel (« Début mission », « Fin mission ») ou, à défaut, premier début réel et dernière date de migration des sites du district.</p>
      <div className="tablewrap" style={{ maxHeight: 420, overflow: 'auto' }}><table>
        <thead><tr><th>Région</th><th>District</th><th>Vague</th><th>Début de mission</th><th>Fin de mission</th><th className="r">Durée</th><th className="r">Sites à migrer</th><th className="r">Migrés</th><th>Taux</th><th>État</th></tr></thead>
        <tbody>{missions.map((m) => (
          <tr key={`${m.district_id}-${m.vague}`} className="click" onClick={() => navigate(`/sites?district=${m.district_id}${m.vague !== null ? `&vague=${m.vague}` : ''}`)}>
            <td>{m.region}</td><td>{m.district}</td><td><span className="chip">Vague {m.vague ?? '—'}</span></td>
            <td className="num">{fmtDate(m.debut)}</td><td className="num">{fmtDate(m.fin)}{m.dates_saisies ? '' : m.debut ? <span className="sub" title="Calculée à partir des dates des sites"> *</span> : ''}</td>
            <td className="r num">{m.duree_jours ? `${m.duree_jours} j` : '—'}</td>
            <td className="r num">{m.sites}</td><td className="r num">{m.migres}</td><td><Taux valeur={m.taux} complet={m.complet} /></td>
            <td>{m.terminee ? <span className="pill"><span className="dot T" />Terminée</span> : m.debut ? <span className="pill"><span className="dot C" />En cours</span> : <span className="pill"><span className="dot N" />À planifier</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="sub" style={{ marginTop: 8 }}>* dates calculées à partir des sites (pas de dates de mission saisies).</p>
    </section>
  );
}
