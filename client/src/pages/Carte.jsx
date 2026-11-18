import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Etat, useDonnees } from '../App.jsx';
import { CATEGORIES, fmtPct } from '../api.js';
import { Taux } from '../components/Elements.jsx';
import GEO from '../data/civ_geo.json';
import DG from '../data/districts_geo.json';

/*
 * Une seule carte des districts sanitaires, deux couleurs :
 *  - rouge : les sites déployés sur mSupply (version commerciale, à migrer) et les nouveaux sites
 *    (sans version commerciale, à déployer directement sur Open mSupply) ;
 *  - vert forêt : les sites migrés vers Open mSupply.
 * Chaque district est rempli de bas en haut en vert à hauteur de son taux de migration (migrés / sites sous mSupply),
 * le reste en rouge ; les nouveaux sites sont des pastilles rouges numérotées.
 * Fond : contours officiels des districts et des régions (data/districts_geo.json, simplifiés) sur le
 * contour du pays et les pays voisins (data/civ_geo.json). Aucune tuile en ligne.
 * Un site est rattaché au district de la carte de même nom (pas à son code, peu fiable) ; sa région est celle
 * de la carte, qui peut différer de celle de l'extrait (ex. YOPOUGON-EST, ABIDJAN 1).
 */
const { LON0, LAT1, K, S } = DG.projection;
const proj = (lat, lon) => [(lon - LON0) * K * S, (LAT1 - lat) * S];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’'`]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const fmtN = (n) => Number(n).toLocaleString('fr-FR');

// Écarts d'écriture connus entre l'extrait et le fichier officiel des districts
const ALIAS = { 'bouake nord ouest': 'bouake nourd ouest' };
const PAR_NOM = new Map(DG.districts.map((d) => [norm(d.nom), d]));
const geoDe = (nom) => { const n = norm(nom); return PAR_NOM.get(ALIAS[n] || n) || null; };
const REGIONS = [...new Set(DG.districts.map((d) => d.region))].sort((a, b) => a.localeCompare(b, 'fr'));
const REGION_PAR_NOM = new Map(DG.regions.map((r) => [r.nom, r]));

const boiteDe = (liste) => {
  const b = liste.map((d) => d.b);
  return [Math.min(...b.map((x) => x[0])), Math.min(...b.map((x) => x[1])), Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))];
};
// Vue [x, y, largeur, hauteur] englobant une boîte, avec une marge et une taille minimale
const vueDe = ([x0, y0, x1, y1]) => {
  const m = Math.max(x1 - x0, y1 - y0) * 0.05 + 6;
  const w = Math.max(x1 - x0 + 2 * m, 70);
  const h = Math.max(y1 - y0 + 2 * m, 70);
  return [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h];
};
const VUE_PAYS = vueDe(boiteDe(DG.districts));
const VUE_ABIDJAN = vueDe(boiteDe(DG.districts.filter((d) => d.region.startsWith('ABIDJAN'))));

// Couleurs : sites migrés vers Open mSupply en vert forêt ; sites sous mSupply et nouveaux sites en rouge
const VERT = '#228b22';
const ROUGE = '#d62828';
const PRIORITAIRE = '#7b1530';
const MARINE = '#0b1f4b';

const taux = (migres, sites) => (sites ? Math.round((1000 * migres) / sites) / 10 : 0);

/** Compte les sites par district de la carte (sites à migrer, migrés, en cours, nouveaux…). */
/** `depots` : nombre de dépôts du référentiel par district de la carte (Map), ou null. */
function agreger(sites, depots, nouveauxPlus, migresHors) {
  const parDistrict = new Map();
  const inconnus = new Map();
  const ecarts = new Map();
  for (const s of sites) {
    const g = geoDe(s.district);
    if (!g) { inconnus.set(s.district, (inconnus.get(s.district) || 0) + 1); continue; }
    if (norm(s.region) !== norm(g.region)) ecarts.set(g.nom, { extrait: s.region, carte: g.region });
    let a = parDistrict.get(g.nom);
    if (!a) {
      a = { geo: g, id: s.district_id, sites: 0, migres: 0, enCours: 0, nonDemarres: 0, nouveaux: 0, nouveauxDeployes: 0 };
      parDistrict.set(g.nom, a);
    }
    if (s.type_site === 'NOUVEAU') {
      a.nouveaux++;
      if (s.statut === 'TERMINE') a.nouveauxDeployes++;
    } else {
      a.sites++;
      if (s.statut === 'TERMINE') a.migres++;
      else if (s.statut === 'EN_COURS') a.enCours++;
      else if (s.statut === 'NON_DEMARRE') a.nonDemarres++;
    }
  }
  // Référentiel : tous les districts ont leurs dépôts, même sans site dans l'extrait ; la base ne descend jamais sous les sites suivis
  if (depots) {
    for (const [nom, n] of depots) {
      if (!parDistrict.has(nom)) parDistrict.set(nom, { geo: PAR_NOM.get(norm(nom)), id: null, sites: 0, migres: 0, enCours: 0, nonDemarres: 0, nouveaux: 0, nouveauxDeployes: 0 });
      parDistrict.get(nom).depots = n;
    }
  }
  // Nouveaux sites de la liste permanente (absents de l'extrait)
  if (nouveauxPlus) {
    for (const [nom, n] of nouveauxPlus) {
      if (!parDistrict.has(nom)) parDistrict.set(nom, { geo: PAR_NOM.get(norm(nom)), id: null, sites: 0, migres: 0, enCours: 0, nonDemarres: 0, nouveaux: 0, nouveauxDeployes: 0 });
      parDistrict.get(nom).nouveaux += n;
    }
  }
  // Sites corrigés « migré » absents de l'extrait (migrés hors du suivi de la DAP) : comptés suivis et migrés
  if (migresHors) {
    for (const [nom, n] of migresHors) {
      if (!parDistrict.has(nom)) parDistrict.set(nom, { geo: PAR_NOM.get(norm(nom)), id: null, sites: 0, migres: 0, enCours: 0, nonDemarres: 0, nouveaux: 0, nouveauxDeployes: 0 });
      const a = parDistrict.get(nom);
      a.sites += n;
      a.migres += n;
    }
  }
  parDistrict.forEach((a) => { a.base = Math.max(a.depots ?? 0, a.sites); a.taux = taux(a.migres, a.base); });
  return { parDistrict, inconnus, ecarts };
}

export default function Carte() {
  const etat = useDonnees('/sites');
  const filtres = useDonnees('/filtres');
  return (
    <Etat etat={etat}>{(d) => <Cartes sites={d.sites} filtres={filtres.donnees} />}</Etat>
  );
}

function Cartes({ sites, filtres }) {
  const navigate = useNavigate();
  // La vague vient de l'adresse (?vague=), partagée avec le filtre du bandeau
  const [params, setParams] = useSearchParams();
  const vague = params.get('vague') || '';
  const changerVague = (v) => {
    const p = new URLSearchParams(params);
    v ? p.set('vague', v) : p.delete('vague');
    setParams(p, { replace: true });
  };
  const [g, setG] = useState({ region: '', district: '', categorie: '' });
  const f = { ...g, vague };
  const setF = (n) => { setG({ region: n.region, district: n.district, categorie: n.categorie }); if (n.vague !== vague) changerVague(n.vague); };
  const [noms, setNoms] = useState(true);
  const [vue, setVue] = useState(VUE_PAYS);
  const [info, setInfo] = useState(null);
  const prioritaires = useMemo(() => new Set((filtres?.prioritaires || []).map(norm)), [filtres]);
  const vagues = filtres?.vagues || [];

  const filtres_sites = useMemo(
    () => sites.filter((s) => (!f.vague || String(s.vague) === f.vague) && (!f.categorie || s.categorie === f.categorie)),
    [sites, f.vague, f.categorie]);
  // Le référentiel ne connaît ni les vagues ni les catégories du fichier : il n'est utilisé que sans filtre de vague ou de catégorie
  const depots = useMemo(() => {
    if (!filtres?.referentiel?.length || vague || g.categorie) return null;
    const m = new Map();
    for (const e of filtres.referentiel) { const gd = geoDe(e.district); if (gd) m.set(gd.nom, (m.get(gd.nom) || 0) + e.n); }
    return m;
  }, [filtres, vague, g.categorie]);
  const nouveauxPlus = useMemo(() => {
    if (!filtres?.nouveaux?.length || vague || g.categorie) return null;
    const m = new Map();
    for (const e of filtres.nouveaux) { const gd = geoDe(e.district); if (gd) m.set(gd.nom, (m.get(gd.nom) || 0) + e.n); }
    return m;
  }, [filtres, vague, g.categorie]);
  const migresHors = useMemo(() => {
    if (!filtres?.migres_hors_extrait?.length || vague || g.categorie) return null;
    const m = new Map();
    for (const e of filtres.migres_hors_extrait) { const gd = geoDe(e.district); if (gd) m.set(gd.nom, (m.get(gd.nom) || 0) + e.n); }
    return m;
  }, [filtres, vague, g.categorie]);
  const { parDistrict, inconnus, ecarts } = useMemo(
    () => agreger(filtres_sites, depots, nouveauxPlus, migresHors), [filtres_sites, depots, nouveauxPlus, migresHors]);

  const dansPortee = (g) => (f.region === '' || (f.region === '*' ? prioritaires.has(norm(g.region)) : g.region === f.region))
    && (f.district === '' || g.nom === f.district);
  const portee = DG.districts.filter(dansPortee);
  const clePortee = `${f.region}|${f.district}`;
  useEffect(() => { setVue(portee.length && portee.length < DG.districts.length ? vueDe(boiteDe(portee)) : VUE_PAYS); }, [clePortee]); // eslint-disable-line react-hooks/exhaustive-deps

  const lignes = portee.map((g) => parDistrict.get(g.nom)).filter(Boolean).sort((a, b) => b.base - a.base || a.geo.nom.localeCompare(b.geo.nom, 'fr'));
  const tot = lignes.reduce((t, a) => ({
    sites: t.sites + a.base, migres: t.migres + a.migres, enCours: t.enCours + a.enCours, nonDemarres: t.nonDemarres + Math.max(a.base - a.migres - a.enCours, 0),
    nouveaux: t.nouveaux + a.nouveaux, nouveauxDeployes: t.nouveauxDeployes + a.nouveauxDeployes,
  }), { sites: 0, migres: 0, enCours: 0, nonDemarres: 0, nouveaux: 0, nouveauxDeployes: 0 });

  const districtsListe = DG.districts.filter((g) => f.region === '' || (f.region === '*' ? prioritaires.has(norm(g.region)) : g.region === f.region))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const choisirRegion = (region) => setF({ ...f, region, district: '' });
  const choisirDistrict = (g) => {
    if (f.district === g.nom) setF({ ...f, district: '' });
    else setF({ ...f, region: f.region === '*' && prioritaires.has(norm(g.region)) ? '*' : g.region, district: g.nom });
  };
  const filtreActif = f.region || f.district || f.vague || f.categorie;
  const commun = { parDistrict, dansPortee, prioritaires, f, vue, setVue, setInfo, noms, choisirDistrict, sites: filtres_sites };

  return (
    <>
      <section className="panel">
        <div className="filtres">
          <select aria-label="Région" value={f.region} onChange={(e) => choisirRegion(e.target.value)}>
            <option value="">Toutes les régions</option>
            {prioritaires.size > 0 && <option value="*">★ Les {prioritaires.size} régions prioritaires LHSPLA</option>}
            {REGIONS.map((r) => <option key={r} value={r}>{prioritaires.has(norm(r)) ? '★ ' : ''}{r}</option>)}
          </select>
          <select aria-label="District" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })}>
            <option value="">Tous les districts</option>
            {districtsListe.map((g) => <option key={g.nom} value={g.nom}>{g.nom}</option>)}
          </select>
          <select aria-label="Vague" value={f.vague} onChange={(e) => setF({ ...f, vague: e.target.value })}>
            <option value="">Toutes les vagues</option>{vagues.map((v) => <option key={v} value={v}>Vague {v}</option>)}
          </select>
          <select aria-label="Catégorie" value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
            <option value="">Toutes les catégories</option>{Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label className="sub" style={{ margin: 0, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={noms} onChange={(e) => setNoms(e.target.checked)} /> Noms des districts
          </label>
          <span style={{ flex: 1 }} />
          {filtreActif && <button className="btn" type="button" onClick={() => setF({ region: '', district: '', vague: '', categorie: '' })}>Réinitialiser</button>}
          <button className="btn" type="button" onClick={() => setVue(VUE_ABIDJAN)}>Zoom sur Abidjan</button>
          <button className="btn" type="button" onClick={() => setVue(portee.length && portee.length < DG.districts.length ? vueDe(boiteDe(portee)) : VUE_PAYS)}>Recentrer</button>
        </div>
        <div className="prio-chiffres">
          <div><strong>{fmtN(tot.sites)}</strong><span>sites sous mSupply (version commerciale){depots ? ' : dépôts du référentiel' : ''}</span></div>
          <div><strong>{fmtN(tot.migres)} <small>/ {fmtN(tot.sites)}</small></strong><span>migrés vers Open mSupply ({fmtPct(taux(tot.migres, tot.sites))})</span></div>
          <div><strong>{fmtN(tot.enCours)} · {fmtN(tot.nonDemarres)}</strong><span>en cours · non démarrés</span></div>
          <div><strong>{fmtN(tot.nouveaux)}</strong><span>nouveaux sites ({fmtN(tot.nouveauxDeployes)} déployés sur Open mSupply)</span></div>
        </div>
      </section>

      <CarteDistricts {...commun} />

      <section className="panel">
        <h2>Districts affichés</h2>
        <p className="sub">{lignes.length} district{lignes.length > 1 ? 's' : ''} avec des sites dans l'extrait sur {portee.length} dans la sélection. Cliquez un district sur une carte pour le sélectionner.</p>
        {lignes.length === 0 ? <div className="info">Aucun site dans l'extrait pour cette sélection.</div> : (
          <div className="tablewrap" style={{ maxHeight: 420, overflow: 'auto' }}><table>
            <thead><tr><th>Région</th><th>District</th><th className="r">Sites sous mSupply</th><th className="r">Migrés</th><th>Taux de migration</th><th className="r">En cours</th><th className="r">Non démarrés</th><th className="r">Nouveaux sites<br /><span style={{ fontWeight: 400 }}>déployés / total</span></th></tr></thead>
            <tbody>{lignes.map((a) => (
              <tr key={a.geo.nom} className={a.id ? 'click' : ''} onClick={() => a.id && navigate(`/sites?district=${a.id}`)}>
                <td>{prioritaires.has(norm(a.geo.region)) && <span className="badge-prio">★</span>}{a.geo.region}</td><td>{a.geo.nom}</td>
                <td className="r num">{a.base}</td><td className="r num">{a.migres}</td>
                <td>{a.base ? <Taux valeur={a.taux} complet={a.migres === a.base} /> : '—'}</td>
                <td className="r num">{a.enCours}</td><td className="r num">{Math.max(a.base - a.migres - a.enCours, 0)}</td>
                <td className="r num">{a.nouveaux ? `${a.nouveauxDeployes} / ${a.nouveaux}` : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {ecarts.size > 0 && (
          <p className="sub" style={{ marginTop: 8 }}>
            Régions d'après la carte officielle : {[...ecarts].map(([nom, e]) => `${nom} est dans ${e.carte} (l'extrait indique ${e.extrait})`).join(' ; ')}.
          </p>
        )}
        {inconnus.size > 0 && (
          <p className="sub" style={{ marginTop: 8 }}>
            <b>Non placés</b> (district absent de la carte officielle) : {[...inconnus].map(([nom, n]) => `${nom} (${n})`).join(', ')}.
          </p>
        )}
        <p className="sub" style={{ marginTop: 8 }}>{DG.source} Fond : {GEO.source}</p>
      </section>
      {info && <div className="tip" style={{ opacity: 1, left: info.e.clientX + 14, top: info.e.clientY - 10 }}>{info.html}</div>}
    </>
  );
}

function CarteDistricts({ parDistrict, dansPortee, prioritaires, f, vue, setVue, setInfo, noms, choisirDistrict, sites }) {
  const boite = useRef(null);
  const glisse = useRef(null);
  const [taille, setTaille] = useState({ w: 900, h: 700 });

  useEffect(() => {
    const maj = () => boite.current && setTaille({ w: boite.current.clientWidth, h: boite.current.clientHeight });
    maj();
    window.addEventListener('resize', maj);
    return () => window.removeEventListener('resize', maj);
  }, []);

  const u = Math.max(vue[2] / taille.w, vue[3] / taille.h); // unités de carte par pixel
  const zoom = (fact, cx, cy) => setVue((v) => {
    const w = Math.min(Math.max(v[2] * fact, 20), DG.largeur * 1.3);
    const h = (w * v[3]) / v[2];
    const x = cx ?? v[0] + v[2] / 2;
    const y = cy ?? v[1] + v[3] / 2;
    return [x - ((x - v[0]) * w) / v[2], y - ((y - v[1]) * h) / v[3], w, h];
  });
  const pointCarte = (e) => {
    const r = boite.current.getBoundingClientRect();
    return [vue[0] + (vue[2] - r.width * u) / 2 + (e.clientX - r.left) * u, vue[1] + (vue[3] - r.height * u) / 2 + (e.clientY - r.top) * u];
  };

  // Remplissage : vert (migrés) en bas jusqu'au taux de migration, rouge (restant à migrer) au-dessus
  const aDesSites = (g) => parDistrict.get(g.nom)?.base > 0;
  const remplissage = (g, dedans) => {
    if (!dedans) return '#f4f6f7';
    const a = parDistrict.get(g.nom);
    if (!a?.base) return a?.nouveaux ? '#fbe3e3' : 'url(#hachure)';
    return `url(#niveau-${g.nom.replace(/[^A-Za-z0-9]/g, '_')})`;
  };

  const resume = (g, a) => (
    <>
      <b>{g.nom}</b> · {g.region}{prioritaires.has(norm(g.region)) ? ' ★ prioritaire' : ''}<br />
      {a ? <>
        <span style={{ color: '#ff8a8a' }}>■</span> {a.base} site{a.base > 1 ? 's' : ''} déployé{a.base > 1 ? 's' : ''} sur mSupply{a.depots != null ? ' (référentiel)' : ''}<br />
        <span style={{ color: '#6fd36f' }}>■</span> {a.migres} migré{a.migres > 1 ? 's' : ''} vers Open mSupply ({fmtPct(a.taux)})<br />
        {a.enCours} en cours · {Math.max(a.base - a.migres - a.enCours, 0)} non démarré{a.base - a.migres - a.enCours > 1 ? 's' : ''}
        {a.nouveaux ? <><br /><span style={{ color: '#ff8a8a' }}>●</span> {a.nouveaux} nouveau{a.nouveaux > 1 ? 'x' : ''} site{a.nouveaux > 1 ? 's' : ''} ({a.nouveauxDeployes} déployé{a.nouveauxDeployes > 1 ? 's' : ''} sur Open mSupply)</> : null}
      </> : 'Aucun site dans l\'extrait'}
    </>
  );

  // Étiquettes : nom, sites migrés / sites sous mSupply, sans chevauchement
  const posees = [];
  const etiquettes = !noms ? null : DG.districts.filter(dansPortee)
    .sort((a, b) => (parDistrict.get(b.nom)?.base || 0) - (parDistrict.get(a.nom)?.base || 0))
    .map((g) => {
      const a = parDistrict.get(g.nom);
      const texte = a?.base ? `${g.nom} · ${a.migres}/${a.base}` : g.nom;
      const lw = texte.length * 6.3 * u; const lh = 12 * u;
      const lx = g.x - lw / 2; const ly = g.y;
      if (g.x < vue[0] || g.x > vue[0] + vue[2] || g.y < vue[1] || g.y > vue[1] + vue[3]) return null;
      if (posees.some((b) => lx < b[0] + b[2] && lx + lw > b[0] && ly - lh < b[1] && ly > b[1] - b[3])) return null;
      posees.push([lx, ly, lw, lh]);
      return <text key={g.nom} x={g.x} y={g.y + 3.5 * u} textAnchor="middle" className="map-lbl" style={{ fontSize: 10.5 * u, strokeWidth: 3 * u }}>{texte}</text>;
    });

  // Pastilles rouges « nouveaux sites » et sites placés par GPS (vert : migré ; rouge : sous mSupply ou nouveau)
  const pastilles = DG.districts.filter(dansPortee).map((g) => {
    const a = parDistrict.get(g.nom);
    if (!a?.nouveaux) return null;
    const r = (6 + Math.sqrt(a.nouveaux) * 1.6) * u;
    return (
      <g key={g.nom} pointerEvents="none">
        <circle cx={g.x + 12 * u} cy={g.y - 11 * u} r={r} fill={ROUGE} stroke="#fff" strokeWidth={1.4 * u} />
        <text x={g.x + 12 * u} y={g.y - 11 * u + 3.4 * u} textAnchor="middle" fill="#fff" style={{ fontSize: 9.5 * u, fontWeight: 700 }}>{a.nouveaux}</text>
      </g>
    );
  });
  const points = sites.filter((s) => s.latitude != null && s.longitude != null)
    .filter((s) => { const g = geoDe(s.district); return g && dansPortee(g); })
    .map((s) => {
      const [x, y] = proj(s.latitude, s.longitude);
      const migre = s.type_site !== 'NOUVEAU' && s.statut === 'TERMINE';
      return <circle key={s.id} cx={x} cy={y} r={2.8 * u} fill={migre ? VERT : ROUGE} stroke="#fff" strokeWidth={0.9 * u} pointerEvents="none" />;
    });

  const choisie = f.district ? DG.districts.find((g) => g.nom === f.district) : null;
  const regionChoisie = f.region && f.region !== '*' ? REGION_PAR_NOM.get(f.region) : null;

  return (
    <section className="carte-bloc">
      <div className="carte-titre">
        <h3>Sites déployés sur mSupply, nouveaux sites et sites migrés vers Open mSupply</h3>
        <p className="sub">
          <b style={{ color: ROUGE }}>Rouge</b> : sites sous la version commerciale (à migrer) et nouveaux sites sans version commerciale.{' '}
          <b style={{ color: VERT }}>Vert forêt</b> : sites migrés vers Open mSupply.
          Taux de migration : sites migrés sur sites sous mSupply, par district.
        </p>
      </div>
      <div className="mapwrap">
        <svg ref={boite} viewBox={vue.join(' ')} className="mapsvg" role="img" aria-label="Carte des districts : sites sous mSupply et migrés vers Open mSupply"
          onWheel={(e) => { const [x, y] = pointCarte(e); zoom(e.deltaY > 0 ? 1.25 : 0.8, x, y); }}
          onPointerDown={(e) => { glisse.current = { x: e.clientX, y: e.clientY, v: vue, bouge: false }; }}
          onPointerMove={(e) => {
            const g = glisse.current;
            if (!g) return;
            if (Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y) > 4) g.bouge = true;
            if (g.bouge) setVue([g.v[0] - (e.clientX - g.x) * u, g.v[1] - (e.clientY - g.y) * u, g.v[2], g.v[3]]);
          }}
          onPointerUp={() => { setTimeout(() => { glisse.current = null; }, 0); }} onPointerLeave={() => { glisse.current = null; }}>
          <defs>
            <pattern id="hachure" width={6 * u} height={6 * u} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={6 * u} height={6 * u} fill="#f1f3f4" />
              <line x1="0" y1="0" x2="0" y2={6 * u} stroke="#d2d8dc" strokeWidth={2 * u} />
            </pattern>
            {DG.districts.filter(aDesSites).map((g) => {
              const t = parDistrict.get(g.nom).taux / 100;
              return (
                <linearGradient key={g.nom} id={`niveau-${g.nom.replace(/[^A-Za-z0-9]/g, '_')}`} x1="0" y1="1" x2="0" y2="0">
                  <stop offset={0} stopColor={VERT} /><stop offset={t} stopColor={VERT} />
                  <stop offset={t} stopColor={ROUGE} /><stop offset={1} stopColor={ROUGE} />
                </linearGradient>
              );
            })}
          </defs>
          <rect x={-2000} y={-2000} width={5000} height={5000} fill="#dcebf7" />
          {GEO.voisins.map((v) => <path key={v.nom} d={v.d} fill="#eef0ee" stroke="#b9c2c6" strokeWidth={u} />)}
          <path d={GEO.civ} fill="#fbfcfb" />
          {DG.districts.map((g) => (
            <path key={g.nom} d={g.d} fillRule="evenodd" fill={remplissage(g, dansPortee(g))}
              stroke="#6f7c84" strokeWidth={0.5 * u} strokeLinejoin="round" style={{ cursor: 'pointer' }}
              onClick={() => { if (!glisse.current?.bouge) choisirDistrict(g); }}
              onMouseMove={(e) => setInfo({ e, html: resume(g, parDistrict.get(g.nom)) })} onMouseLeave={() => setInfo(null)} />
          ))}
          <path d={DG.frontieres} fill="none" stroke="#4a5860" strokeWidth={1.1 * u} strokeLinejoin="round" pointerEvents="none" />
          {DG.regions.filter((r) => prioritaires.has(norm(r.nom))).map((r) => (
            <path key={r.nom} d={r.d} fill="none" stroke={PRIORITAIRE} strokeWidth={2.4 * u} strokeLinejoin="round" pointerEvents="none" />
          ))}
          {regionChoisie && !prioritaires.has(norm(regionChoisie.nom)) && <path d={regionChoisie.d} fill="none" stroke={MARINE} strokeWidth={2.4 * u} pointerEvents="none" />}
          {choisie && <path d={choisie.d} fillRule="evenodd" fill="none" stroke={MARINE} strokeWidth={2.6 * u} strokeLinejoin="round" pointerEvents="none" />}
          {points}
          {pastilles}
          {etiquettes}
        </svg>
        <div className="mapzoom">
          <button className="btn" type="button" aria-label="Zoom avant" onClick={() => zoom(0.67)}>+</button>
          <button className="btn" type="button" aria-label="Zoom arrière" onClick={() => zoom(1.5)}>−</button>
        </div>
      </div>
      <div className="legende-ligne">
        <span><i style={{ background: VERT }} />sites migrés vers Open mSupply</span>
        <span><i style={{ background: ROUGE }} />sites déployés sur mSupply (à migrer)</span>
        <span><i className="rond" style={{ background: ROUGE }} />nouveaux sites (nombre)</span>
        <span><i className="hachure" />aucun site dans l'extrait</span>
        <span><i className="contour" style={{ borderColor: PRIORITAIRE }} />région prioritaire</span>
        <span className="sub" style={{ margin: 0 }}>Dans chaque district, la part en vert (du bas vers le haut) est son taux de migration.</span>
      </div>
    </section>
  );
}
