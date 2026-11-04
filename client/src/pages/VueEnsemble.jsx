import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as Ic from '../components/Icones.jsx';
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
      <div className="stat-cartes">
        <CarteStat titre="Taux de migration national" valeur={fmtPct(s.taux_national)} Icone={Ic.IcCible} fond="grad-rouge"
          pied={<><Variation n={s.evolution} /> {fmtN(s.migres)} sites migrés sur {fmtN(s.objectif_sites)}</>} />
        <CarteStat titre="Sites migrés" valeur={<>{fmtN(s.migres)} <small>/ {fmtN(s.sites)} suivis</small></>} Icone={Ic.IcValide} fond="grad-orange"
          pied={<>{fmtPct(s.taux)} des sites de l'extrait · {fmtN(s.sites_restants)} restent à migrer</>} />
        <CarteStat titre="Districts" valeur={<>{s.districts_touches} <small>/ {s.objectif_districts}</small></>} Icone={Ic.IcDistrict} fond="grad-jaune"
          pied={<><span className="hausse">{s.districts_complets}</span> entièrement migrés · {s.regions_touchees} régions sur {s.objectif_regions}</>} />
        <CarteStat titre="Nouveaux sites" valeur={<>{s.nouveaux_deployes} <small>/ {s.objectif_nouveaux || s.nouveaux}</small></>} Icone={Ic.IcNouveau} fond="grad-cyan"
          pied={s.nouveaux || s.objectif_nouveaux ? <><Variation n={s.evolution_nouveaux} /> déployés directement sur Open mSupply</> : <>Aucun dans l'extrait · {s.en_cours} migrations en cours</>} />
      </div>

      <RegionsPrioritaires p={d.prioritaires} synthese={s} />

      <div className="graphes">
        <GrapheRythme rythme={d.rythme} total={s.sites} />
        <GrapheRegions regions={d.regions} />
      </div>

      <RegionsDistricts regions={d.regions} total={s} />

      <NouveauxSites />

      <div className="grid2">
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

function RegionsPrioritaires({ p, synthese }) {
  const navigate = useNavigate();
  const absentes = p.nb_regions - p.regions_presentes;
  return (
    <section className="panel prioritaires">
      <h2><span className="badge-prio">Prioritaires</span> Point sur les {p.nb_regions} régions prioritaires LHSPLA</h2>
      <p className="sub">Taux calculé sur les sites présents dans l'extrait : le nombre officiel de sites par région n'est pas encore connu. Cliquez une région pour voir ses sites.</p>
      <div className="prio-chiffres">
        <div><strong>{p.regions_touchees} <small>/ {p.nb_regions}</small></strong><span>régions avec au moins un site migré</span></div>
        <div><strong>{p.regions_completes}</strong><span>régions entièrement migrées</span></div>
        <div><strong>{fmtN(p.total.migres)} <small>/ {fmtN(p.total.sites)}</small></strong><span>sites migrés ({fmtPct(p.total.taux)})</span></div>
        <div><strong>{fmtPct(synthese.migres ? (100 * p.total.migres) / synthese.migres : 0)}</strong><span>des sites migrés du pays</span></div>
      </div>
      <div className="tablewrap"><table>
        <thead><tr><th>Région</th><th className="r">Districts<br /><span style={{ fontWeight: 400 }}>touchés / suivis</span></th><th className="r">Sites à migrer</th><th className="r">Sites migrés</th><th>Taux de migration</th><th className="r">En cours</th><th className="r">Non démarrés</th><th className="r">Nouveaux sites<br /><span style={{ fontWeight: 400 }}>déployés / total</span></th></tr></thead>
        <tbody>
          {p.regions.map((r) => (r.presente ? (
            <tr key={r.nom} className="click" onClick={() => navigate(`/sites?region=${r.id}`)}>
              <td>{r.nom}</td><td className="r num">{r.districts_touches} / {r.districts}</td>
              <td className="r num">{r.sites}</td><td className="r num">{r.migres}</td>
              <td><Taux valeur={r.taux} complet={r.complet} gras /></td>
              <td className="r num">{r.en_cours}</td><td className="r num">{r.non_demarres}</td>
              <td className="r num">{r.nouveaux ? `${r.nouveaux_deployes} / ${r.nouveaux}` : '—'}</td>
            </tr>
          ) : (
            <tr key={r.nom} className="absente"><td>{r.nom}</td><td colSpan={7}>Aucun site dans l'extrait</td></tr>
          )))}
          <tr className="total"><td>Total des {p.nb_regions} régions prioritaires</td><td /><td className="r num">{fmtN(p.total.sites)}</td><td className="r num">{fmtN(p.total.migres)}</td><td>{fmtPct(p.total.taux)}</td><td className="r num">{p.total.en_cours}</td><td className="r num">{p.total.non_demarres}</td><td className="r num">{p.total.nouveaux ? `${p.total.nouveaux_deployes} / ${p.total.nouveaux}` : '—'}</td></tr>
          <tr className="autres"><td>Autres régions de l'extrait</td><td /><td className="r num">{fmtN(p.autres.sites)}</td><td className="r num">{fmtN(p.autres.migres)}</td><td>{fmtPct(p.autres.taux)}</td><td className="r num">{p.autres.en_cours}</td><td className="r num">{p.autres.non_demarres}</td><td className="r num">{p.autres.nouveaux ? `${p.autres.nouveaux_deployes} / ${p.autres.nouveaux}` : '—'}</td></tr>
        </tbody>
      </table></div>
      {absentes > 0 && <p className="sub" style={{ marginTop: 8 }}>{absentes} région{absentes > 1 ? 's' : ''} prioritaire{absentes > 1 ? 's' : ''} sans aucun site dans l'extrait : avancement inconnu, pas forcément nul.</p>}
    </section>
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
                <td><span className={`caret ${ouvertes.has(r.id) ? 'ouvert' : ''}`}>▸</span>{r.nom} {r.prioritaire && <span className="badge-prio">Prioritaire</span>}<span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {r.districts.length} district{r.districts.length > 1 ? 's' : ''}</span></td>
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

/* ---------------------------------------------------------------- en-tête du tableau de bord */
function CarteStat({ titre, valeur, Icone, fond, pied }) {
  return (
    <div className="stat">
      <div className="stat-haut">
        <div><h5>{titre}</h5><div className="valeur">{valeur}</div></div>
        <span className={`stat-ic ${fond}`}><Icone /></span>
      </div>
      <div className="stat-pied">{pied}</div>
    </div>
  );
}

function Variation({ n }) {
  if (n === null || n === undefined) return <span>Premier import ·</span>;
  if (n >= 0) return <span className="hausse"><Ic.IcHaut width={13} height={13} />+{n}</span>;
  return <span className="baisse"><Ic.IcBas width={13} height={13} />{n}</span>;
}

/** Lundi de la semaine d'une date « AAAA-MM-JJ » */
function lundi(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function GrapheRythme({ rythme, total }) {
  const [mode, setMode] = useState('cumul');
  const donnees = useMemo(() => {
    if (mode === 'cumul') {
      const dates = [...new Set([...rythme.reel, ...rythme.prevu].map((p) => p.date))].sort();
      const R = new Map(rythme.reel.map((x) => [x.date, x.cumul]));
      const P = new Map(rythme.prevu.map((x) => [x.date, x.cumul]));
      let r = 0; let p = 0;
      return dates.map((date) => { if (R.has(date)) r = R.get(date); if (P.has(date)) p = P.get(date); return { date, reel: r, prevu: p }; });
    }
    // Sites migrés par semaine (à partir du cumul quotidien)
    const sem = new Map();
    let prec = 0;
    rythme.reel.forEach((x) => { const k = lundi(x.date); sem.set(k, (sem.get(k) || 0) + x.cumul - prec); prec = x.cumul; });
    return [...sem].sort().map(([date, n]) => ({ date, reel: n }));
  }, [rythme, mode]);
  const axe = { stroke: '#525f7f', tick: { fill: '#8898aa', fontSize: 11 }, tickLine: false, axisLine: false };
  return (
    <section className="carte-sombre">
      <div className="entete-graphe">
        <div><p className="surtitre">Vue d'ensemble</p><h3>Rythme de migration</h3></div>
        <div className="bascule" role="group" aria-label="Affichage">
          <button type="button" className={mode === 'cumul' ? 'actif' : ''} onClick={() => setMode('cumul')}>Cumul</button>
          <button type="button" className={mode === 'semaine' ? 'actif' : ''} onClick={() => setMode('semaine')}>Par semaine</button>
        </div>
      </div>
      {donnees.length === 0 ? <p className="note">Pas encore de dates de migration.</p> : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={donnees} margin={{ top: 10, right: 12, bottom: 0, left: -10 }}>
            <CartesianGrid stroke="#2a3f63" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" {...axe} tickFormatter={(v) => fmtDate(v).slice(0, 5)} minTickGap={28} />
            <YAxis {...axe} allowDecimals={false} domain={mode === 'cumul' ? [0, Math.ceil(total / 100) * 100] : [0, 'auto']} />
            <Tooltip contentStyle={{ background: '#fff', border: 0, borderRadius: 6, color: '#32325d' }} labelFormatter={(v) => (mode === 'cumul' ? fmtDate(v) : `Semaine du ${fmtDate(v)}`)}
              formatter={(v, n) => [v, n === 'reel' ? (mode === 'cumul' ? 'Sites migrés (cumul)' : 'Sites migrés') : 'Prévus (cumul)']} />
            {mode === 'cumul' && <Line type="monotone" dataKey="prevu" stroke="#8898aa" strokeDasharray="5 5" strokeWidth={2} dot={false} />}
            <Line type="monotone" dataKey="reel" stroke="#5e72e4" strokeWidth={4} dot={false} activeDot={{ r: 5, fill: '#fff', stroke: '#5e72e4', strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <p className="note">{mode === 'cumul' ? 'Trait plein : sites migrés à leur date de migration · pointillés : planning (dates prévues)' : 'Nombre de sites migrés chaque semaine (date de migration)'}</p>
    </section>
  );
}

function GrapheRegions({ regions }) {
  const navigate = useNavigate();
  const donnees = regions.filter((r) => r.sites > 0).slice(0, 8).map((r) => ({ id: r.id, nom: r.nom, migres: r.migres, sites: r.sites, taux: r.taux }));
  return (
    <section className="carte-blanche">
      <div className="entete-graphe"><div><p className="surtitre">Avancement</p><h3>Sites migrés par région</h3></div></div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={donnees} margin={{ top: 10, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#e9ecef" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="nom" tick={{ fill: '#8898aa', fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={60} />
          <YAxis tick={{ fill: '#8898aa', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: '#f6f9fc' }} formatter={(v, n, p) => [`${v} sur ${p.payload.sites} (${fmtPct(p.payload.taux)})`, 'Sites migrés']} />
          <Bar dataKey="migres" fill="#fb6340" radius={[4, 4, 0, 0]} barSize={12} style={{ cursor: 'pointer' }} onClick={(x) => navigate(`/sites?region=${x.id}`)} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
