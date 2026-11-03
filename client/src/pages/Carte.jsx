import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Etat, useDonnees } from '../App.jsx';
import { CATEGORIES, STATUTS, fmtDate, fmtPct } from '../api.js';
import GEO from '../data/civ_geo.json';

/*
 * Cartographie des districts et des sites sur la carte de la Côte d'Ivoire.
 * - Fond : contours Natural Earth (domaine public) pré-projetés en SVG (data/civ_geo.json).
 * - Un district sanitaire est placé sur son chef-lieu (GeoNames) ; couleur = taux de migration.
 * - Un site est placé à ses coordonnées GPS si elles sont connues, sinon autour du chef-lieu de son district.
 * Les limites des districts sanitaires ne sont pas tracées (pas de contours libres disponibles).
 */
const { LON0, LAT1, K, S } = GEO.projection;
const proj = (lat, lon) => [(lon - LON0) * K * S, (LAT1 - lat) * S];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’'`]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const VILLES = new Map(GEO.villes.map((v) => [norm(v.nom), v]));

export function lieuDistrict(nom) {
  const n = norm(nom);
  return VILLES.get(n) || VILLES.get(n.replace(/\s+\d+$/, '')) || VILLES.get(n.split(' ')[0]) || null;
}

const couleurTaux = (t) => (t >= 100 ? '#0a7a0a' : t >= 50 ? '#3fa83f' : t > 0 ? '#9fd49f' : '#e3e8eb');
const COULEUR_STATUT = { TERMINE: '#0ca30c', EN_COURS: '#fab219', NON_DEMARRE: '#9aa6ad' };
const VUE_PAYS = [0, 0, GEO.largeur, GEO.hauteur];

export default function Carte() {
  const etat = useDonnees('/sites');
  return (
    <section className="panel">
      <h2>Cartographie des districts et des sites</h2>
      <p className="sub">Chaque district sanitaire est placé sur son chef-lieu ; sa couleur indique son taux de migration et sa taille son nombre de sites.
        Les sites sont regroupés autour du chef-lieu de leur district, sauf ceux dont les coordonnées GPS (colonnes « Latitude » et « Longitude ») sont renseignées.</p>
      <Etat etat={etat}>{(d) => <Carto sites={d.sites} />}</Etat>
    </section>
  );
}

function Carto({ sites }) {
  const navigate = useNavigate();
  const boite = useRef(null);
  const [vue, setVue] = useState(VUE_PAYS);
  const [opt, setOpt] = useState({ districts: true, sites: true, noms: true, vague: '', categorie: '', type: '' });
  const [taille, setTaille] = useState({ w: 1000, h: 760 });
  const [info, setInfo] = useState(null);
  const glisse = useRef(null);

  useEffect(() => {
    const maj = () => boite.current && setTaille({ w: boite.current.clientWidth, h: boite.current.clientHeight });
    maj();
    window.addEventListener('resize', maj);
    return () => window.removeEventListener('resize', maj);
  }, []);

  const vagues = useMemo(() => [...new Set(sites.map((s) => s.vague).filter((v) => v !== null))].sort((a, b) => a - b), [sites]);
  const filtres = sites.filter((s) => (!opt.vague || String(s.vague) === opt.vague)
    && (!opt.categorie || s.categorie === opt.categorie) && (!opt.type || s.type_site === opt.type));

  // Regroupement par district et placement
  const { places, nonPlaces } = useMemo(() => {
    const ds = new Map();
    filtres.forEach((s) => {
      const k = `${s.district_id}`;
      if (!ds.has(k)) ds.set(k, { id: s.district_id, nom: s.district, region: s.region, sites: [] });
      ds.get(k).sites.push(s);
    });
    const occupe = new Map();
    const places = [];
    const nonPlaces = [];
    ds.forEach((d) => {
      const v = lieuDistrict(d.nom);
      if (!v) { nonPlaces.push(d); return; }
      let [x, y] = proj(v.lat, v.lon);
      const cle = `${Math.round(x)},${Math.round(y)}`;
      const n = occupe.get(cle) || 0;
      occupe.set(cle, n + 1);
      if (n) { x += Math.cos(n * 2.2) * 22; y += Math.sin(n * 2.2) * 22; } // ex. Korhogo 1 et Korhogo 2
      const m = d.sites.filter((s) => s.type_site !== 'NOUVEAU');
      const migres = m.filter((s) => s.statut === 'TERMINE').length;
      const debuts = d.sites.map((s) => s.debut_mission || s.debut_reel).filter(Boolean).sort();
      const fins = d.sites.map((s) => s.fin_mission || (s.statut === 'TERMINE' ? s.date_migration : null)).filter(Boolean).sort();
      places.push({
        ...d, x, y, approx: !!v.approx, aMigrer: m.length, migres, taux: m.length ? Math.round((1000 * migres) / m.length) / 10 : 0,
        enCours: m.filter((s) => s.statut === 'EN_COURS').length, nouveaux: d.sites.length - m.length,
        debut: debuts[0] || null, fin: fins[fins.length - 1] || null,
      });
    });
    places.sort((a, b) => b.sites.length - a.sites.length);
    return { places, nonPlaces };
  }, [filtres]);

  const u = Math.max(vue[2] / taille.w, vue[3] / taille.h); // unités de carte par pixel
  const zoom = (f, cx, cy) => setVue((v) => {
    const w = Math.min(Math.max(v[2] * f, 40), GEO.largeur * 1.3);
    const h = (w * v[3]) / v[2];
    const x = cx ?? v[0] + v[2] / 2;
    const y = cy ?? v[1] + v[3] / 2;
    return [x - ((x - v[0]) * w) / v[2], y - ((y - v[1]) * h) / v[3], w, h];
  });
  const pointCarte = (e) => {
    const r = boite.current.getBoundingClientRect();
    const ox = vue[0] + (vue[2] - r.width * u) / 2;
    const oy = vue[1] + (vue[3] - r.height * u) / 2;
    return [ox + (e.clientX - r.left) * u, oy + (e.clientY - r.top) * u];
  };

  // Marqueurs (taille constante à l'écran)
  const posees = [];
  const marqueurs = places.map((d) => {
    const rB = (5 + Math.sqrt(d.sites.length) * 1.9) * u;
    const points = opt.sites ? d.sites.map((s, i) => {
      let sx; let sy; let gps = false;
      if (s.latitude != null && s.longitude != null) { [sx, sy] = proj(s.latitude, s.longitude); gps = true; } else {
        const a = i * 2.39996;
        const rr = 3.3 * Math.sqrt(i + 1) * u + (opt.districts ? rB + 2 * u : 0);
        sx = d.x + Math.cos(a) * rr; sy = d.y + Math.sin(a) * rr;
      }
      return (
        <circle key={s.id} cx={sx} cy={sy} r={2.8 * u} fill={COULEUR_STATUT[s.statut]} style={{ cursor: 'pointer' }}
          stroke={s.type_site === 'NOUVEAU' ? '#6250d6' : '#fff'} strokeWidth={(s.type_site === 'NOUVEAU' ? 1.5 : 0.6) * u}
          onMouseEnter={(e) => setInfo({ e, html: <><b>{s.site}</b><br />{CATEGORIES[s.categorie]} · {STATUTS[s.statut]}{s.type_site === 'NOUVEAU' ? ' · nouveau site' : ''}<br />Date de migration : {fmtDate(s.date_migration)}{gps ? <><br />Position GPS</> : null}</> })}
          onMouseLeave={() => setInfo(null)} />
      );
    }) : null;
    let nom = null;
    if (opt.noms) {
      const ext = (opt.sites ? rB + 3.3 * Math.sqrt(d.sites.length + 1) * u : rB) + 4 * u;
      const lx = d.x + ext; const ly = d.y + 4 * u; const lw = d.nom.length * 7.4 * u; const lh = 13 * u;
      if (!posees.some((b) => lx < b[0] + b[2] && lx + lw > b[0] && ly - lh < b[1] && ly > b[1] - b[3])) {
        posees.push([lx, ly, lw, lh]);
        nom = <text x={lx} y={ly} className="map-lbl" style={{ fontSize: 11 * u, strokeWidth: 3 * u }}>{d.nom}</text>;
      }
    }
    return (
      <g key={d.id}>
        {opt.districts && (
          <circle cx={d.x} cy={d.y} r={rB} fill={couleurTaux(d.taux)} fillOpacity={opt.sites ? 0.7 : 0.92}
            stroke={d.enCours ? '#fab219' : '#2f3d44'} strokeWidth={(d.enCours ? 2.4 : 1) * u} style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/sites?district=${d.id}`)}
            onMouseEnter={(e) => setInfo({ e, html: <><b>{d.nom}</b> · {d.region}{d.approx ? ' (position approximative)' : ''}<br />{d.aMigrer} sites à migrer · {d.migres} migrés ({fmtPct(d.taux)})<br />{d.enCours} en cours{d.nouveaux ? ` · ${d.nouveaux} nouveau(x) site(s)` : ''}<br />Mission : {d.debut || d.fin ? `${fmtDate(d.debut)} → ${fmtDate(d.fin)}` : '—'}</> })}
            onMouseLeave={() => setInfo(null)} />
        )}
        {points}
        {nom}
      </g>
    );
  });

  const nbGps = filtres.filter((s) => s.latitude != null).length;
  const coche = (cle, libelle) => (
    <label className="sub" style={{ margin: 0, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" checked={opt[cle]} onChange={(e) => setOpt({ ...opt, [cle]: e.target.checked })} /> {libelle}
    </label>
  );

  return (
    <>
      <div className="filtres">
        {coche('districts', 'Districts')}{coche('sites', 'Sites')}{coche('noms', 'Noms des districts')}
        <select aria-label="Vague" value={opt.vague} onChange={(e) => setOpt({ ...opt, vague: e.target.value })}>
          <option value="">Toutes les vagues</option>{vagues.map((v) => <option key={v} value={v}>Vague {v}</option>)}
        </select>
        <select aria-label="Catégorie" value={opt.categorie} onChange={(e) => setOpt({ ...opt, categorie: e.target.value })}>
          <option value="">Toutes les catégories</option>{Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Type" value={opt.type} onChange={(e) => setOpt({ ...opt, type: e.target.value })}>
          <option value="">Migrations et nouveaux sites</option><option value="MIGRATION">Migrations</option><option value="NOUVEAU">Nouveaux sites</option>
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn" type="button" onClick={() => { const [x, y] = proj(5.33, -4.02); setVue([x - 120, y - 70, 240, (240 * GEO.hauteur) / GEO.largeur]); }}>Zoom sur Abidjan</button>
        <button className="btn" type="button" onClick={() => setVue(VUE_PAYS)}>Toute la Côte d'Ivoire</button>
      </div>
      <div className="mapwrap">
        <svg ref={boite} viewBox={vue.join(' ')} className="mapsvg" role="img" aria-label="Carte de la Côte d'Ivoire : districts et sites"
          onWheel={(e) => { const [x, y] = pointCarte(e); zoom(e.deltaY > 0 ? 1.25 : 0.8, x, y); }}
          onPointerDown={(e) => { if (e.target.tagName !== 'circle') glisse.current = { x: e.clientX, y: e.clientY, v: vue }; }}
          onPointerMove={(e) => { const g = glisse.current; if (g) setVue([g.v[0] - (e.clientX - g.x) * u, g.v[1] - (e.clientY - g.y) * u, g.v[2], g.v[3]]); }}
          onPointerUp={() => { glisse.current = null; }} onPointerLeave={() => { glisse.current = null; }}>
          <rect x={-2000} y={-2000} width={5000} height={5000} fill="#dcebf7" />
          {GEO.voisins.map((v) => <path key={v.nom} d={v.d} fill="#eef0ee" stroke="#b9c2c6" strokeWidth={u} />)}
          <path d={GEO.civ} fill="#fbfcfb" stroke="#4a5860" strokeWidth={1.4 * u} />
          {marqueurs}
        </svg>
        <div className="mapzoom">
          <button className="btn" type="button" aria-label="Zoom avant" onClick={() => zoom(0.67)}>+</button>
          <button className="btn" type="button" aria-label="Zoom arrière" onClick={() => zoom(1.5)}>−</button>
        </div>
        <div className="maplegend">
          <b>Districts : taux de migration</b>
          {[['#0a7a0a', '100 %'], ['#3fa83f', '50 à 99 %'], ['#9fd49f', '1 à 49 %'], ['#e3e8eb', '0 %']].map(([c, l]) => (
            <div className="row" key={l}><i style={{ background: c, border: '1px solid #2f3d44' }} />{l}</div>
          ))}
          <div className="row"><i style={{ background: '#fff', border: '2px solid #fab219' }} />migration en cours</div>
          <b style={{ marginTop: 4 }}>Sites</b>
          <div className="row"><i style={{ background: COULEUR_STATUT.TERMINE }} />migré</div>
          <div className="row"><i style={{ background: COULEUR_STATUT.EN_COURS }} />en cours</div>
          <div className="row"><i style={{ background: COULEUR_STATUT.NON_DEMARRE }} />non démarré</div>
          <div className="row"><i style={{ background: '#fff', border: '2px solid #6250d6' }} />nouveau site</div>
        </div>
        {info && <div className="tip" style={{ opacity: 1, left: info.e.clientX + 14, top: info.e.clientY - 10 }}>{info.html}</div>}
      </div>
      <p className="sub" style={{ marginTop: 8 }}>
        {places.length} districts et {filtres.length} sites affichés · {nbGps ? `${nbGps} sites placés par GPS` : 'aucune coordonnée GPS de site : sites regroupés autour du chef-lieu'}
        {nonPlaces.length > 0 && <> · <b>Non placés</b> (chef-lieu inconnu) : {nonPlaces.map((d) => d.nom).join(', ')}</>}
        <br />{GEO.source} Les limites des districts sanitaires ne sont pas tracées.
      </p>
    </>
  );
}
