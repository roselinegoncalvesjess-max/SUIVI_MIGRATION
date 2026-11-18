// Régénère districts_geo.json : contours officiels des 113 districts et 33 régions sanitaires,
// simplifiés et projetés comme civ_geo.json (même repère SVG, pour se superposer à la carte du pays).
//
// Usage (les shapefiles ne sont pas versionnés) :
//   npm i topojson-server@3.0.1 topojson-simplify@3.0.3 topojson-client@3.1.0   (dans un dossier hors projet)
//   NODE_PATH=<ce dossier>/node_modules node generer_districts_geo.cjs "<dossier Régions&Districts>" [poids_min]
// Le dossier contient Regions/CI_REGION_SANITAIRE.* et Districts/CI_DISTRICT_SANITAIRE.* (UTM 30N, WGS 84).
// poids_min : aire minimale (unités SVG²) d'un point conservé ; plus il est grand, plus le fichier est léger.
const fs = require('node:fs');
const path = require('node:path');
const { topology } = require('topojson-server');
const { presimplify, simplify } = require('topojson-simplify');
const { feature, mesh } = require('topojson-client');

const [dossier, poidsArg] = process.argv.slice(2);
if (!dossier) {
  console.error('Usage : NODE_PATH=…/node_modules node generer_districts_geo.cjs "<dossier Régions&Districts>" [poids_min]');
  process.exit(1);
}
const POIDS_MIN = Number(poidsArg || 1);
const { projection: { LON0, LAT1, K, S }, largeur, hauteur } = JSON.parse(fs.readFileSync(path.join(__dirname, 'civ_geo.json'), 'utf8'));

// UTM zone 30 Nord (WGS 84) → [longitude, latitude] en degrés (formules de Snyder)
function utmVersLonLat(E, N) {
  const a = 6378137; const f = 1 / 298.257223563; const k0 = 0.9996; const lon0 = (-3 * Math.PI) / 180;
  const e2 = f * (2 - f); const ep2 = e2 / (1 - e2);
  const x = E - 500000;
  const mu = (N / k0) / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1); const c = Math.cos(phi1); const t = Math.tan(phi1);
  const C1 = ep2 * c * c; const T1 = t * t; const N1 = a / Math.sqrt(1 - e2 * s * s);
  const R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5; const D = x / (N1 * k0);
  const lat = phi1 - ((N1 * t) / R1) * (D ** 2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}
const vers = ([E, N]) => { const [lon, lat] = utmVersLonLat(E, N); return [(lon - LON0) * K * S, (LAT1 - lat) * S]; };

// Colonne NOM d'un fichier .dbf
function lireNoms(f, encodage) {
  const b = fs.readFileSync(f);
  const n = b.readUInt32LE(4); const hl = b.readUInt16LE(8); const rl = b.readUInt16LE(10);
  let deb = 1; let len = 0;
  for (let o = 32; b[o] !== 0x0d; o += 32) {
    if (b.toString('latin1', o, o + 11).replace(/\0.*/, '') === 'NOM') { len = b[o + 16]; break; }
    deb += b[o + 16];
  }
  return Array.from({ length: n }, (_, i) => b.toString(encodage, hl + i * rl + deb, hl + i * rl + deb + len).trim());
}

// Anneaux (en coordonnées UTM) de chaque forme d'un fichier .shp de polygones
function lireShp(f) {
  const b = fs.readFileSync(f);
  const formes = [];
  for (let o = 100; o < b.length;) {
    const lg = b.readInt32BE(o + 4) * 2;
    if (b.readInt32LE(o + 8) !== 5) throw new Error(`${f} : seuls les polygones sont gérés`);
    const nParts = b.readInt32LE(o + 44); const nPts = b.readInt32LE(o + 48);
    const parts = Array.from({ length: nParts }, (_, i) => b.readInt32LE(o + 52 + 4 * i));
    const p0 = o + 52 + 4 * nParts;
    const pts = Array.from({ length: nPts }, (_, i) => [b.readDoubleLE(p0 + 16 * i), b.readDoubleLE(p0 + 16 * i + 8)]);
    formes.push(parts.map((p, i) => pts.slice(p, parts[i + 1] ?? nPts)));
    o += 8 + lg;
  }
  return formes;
}

const aire = (a) => { let s = 0; for (let i = 0; i < a.length - 1; i++) s += a[i][0] * a[i + 1][1] - a[i + 1][0] * a[i][1]; return s / 2; };
const centroide = (a) => {
  let x = 0; let y = 0; let s = 0;
  for (let i = 0; i < a.length - 1; i++) { const c = a[i][0] * a[i + 1][1] - a[i + 1][0] * a[i][1]; x += (a[i][0] + a[i + 1][0]) * c; y += (a[i][1] + a[i + 1][1]) * c; s += c; }
  return s ? [x / (3 * s), y / (3 * s)] : a[0];
};
const dansAnneau = ([x, y], a) => {
  let d = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    if ((a[i][1] > y) !== (a[j][1] > y) && x < ((a[j][0] - a[i][0]) * (y - a[i][1])) / (a[j][1] - a[i][1]) + a[i][0]) d = !d;
  }
  return d;
};
const dansForme = (p, anneaux) => anneaux.filter((a) => dansAnneau(p, a)).length % 2 === 1; // règle pair-impair : gère les trous
const plusGrand = (anneaux) => anneaux.reduce((m, a) => (Math.abs(aire(a)) > Math.abs(aire(m)) ? a : m));

// Polygones (anneau extérieur + trous) : en UTM (y vers le haut), l'extérieur est orienté dans le sens horaire
function polygones(anneaux) {
  const polys = [];
  for (const a of anneaux) {
    if (aire(a) < 0 || !polys.length) polys.push([a]); else polys[polys.length - 1].push(a);
  }
  return polys;
}

const regions = (() => {
  const d = path.join(dossier, 'Regions', 'CI_REGION_SANITAIRE');
  const noms = lireNoms(`${d}.dbf`, 'latin1'); const formes = lireShp(`${d}.shp`);
  return noms.map((nom, i) => {
    const pts = formes[i].flat();
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    return { nom, anneaux: formes[i], boite: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
})();
const dist = (() => {
  const d = path.join(dossier, 'Districts', 'CI_DISTRICT_SANITAIRE');
  const noms = lireNoms(`${d}.dbf`, 'utf8'); const formes = lireShp(`${d}.shp`);
  return noms.map((nom, i) => ({ nom, anneaux: formes[i] }));
})();

// Région d'un district : celle qui contient la plus grande part de sa surface (échantillonnage)
for (const d of dist) {
  const g = plusGrand(d.anneaux);
  const xs = g.map((p) => p[0]); const ys = g.map((p) => p[1]);
  const [xa, xb, ya, yb] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const voix = new Map(); let total = 0;
  for (let i = 1; i < 40; i++) {
    for (let j = 1; j < 40; j++) {
      const p = [xa + ((xb - xa) * i) / 40, ya + ((yb - ya) * j) / 40];
      if (!dansForme(p, d.anneaux)) continue;
      total++;
      for (const r of regions) {
        const [a, b, c, e] = r.boite;
        if (p[0] >= a && p[0] <= c && p[1] >= b && p[1] <= e && dansForme(p, r.anneaux)) voix.set(r.nom, (voix.get(r.nom) || 0) + 1);
      }
    }
  }
  const [meilleure, n] = [...voix].sort((x, y) => y[1] - x[1])[0] || [null, 0];
  if (!meilleure || n / total < 0.9) console.warn(`! ${d.nom} : région incertaine (${meilleure} ${Math.round((100 * n) / (total || 1))} %)`);
  d.region = meilleure;
}

// Topologie partagée : les frontières communes sont simplifiées une seule fois (pas de fentes entre districts)
const geo = {
  type: 'FeatureCollection',
  features: dist.map((d) => ({
    type: 'Feature', id: d.nom, properties: { nom: d.nom, region: d.region },
    geometry: { type: 'MultiPolygon', coordinates: polygones(d.anneaux).map((p) => p.map((a) => a.map(vers))) },
  })),
};
const topo = topology({ districts: geo }, 0);
const simple = simplify(presimplify(topo), POIDS_MIN);
const objet = simple.objects.districts;

const arrondi = (v) => Math.round(v * 10) / 10;
const chemin = (anneaux, ferme) => anneaux.map((a) => {
  const pts = []; let prec = '';
  for (const p of a) { const c = `${arrondi(p[0])},${arrondi(p[1])}`; if (c !== prec) pts.push(c); prec = c; }
  return pts.length > 2 || !ferme ? `M${pts.join('L')}${ferme ? 'Z' : ''}` : '';
}).join('');

let nbPoints = 0;
const districts = feature(simple, objet).features.map((f) => {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const anneaux = polys.flat();
  nbPoints += anneaux.reduce((n, a) => n + a.length, 0);
  const grand = plusGrand(anneaux);
  const [x, y] = centroide(grand);
  const xs = anneaux.flatMap((a) => a.map((p) => p[0])); const ys = anneaux.flatMap((a) => a.map((p) => p[1]));
  return {
    nom: f.properties.nom, region: f.properties.region, x: arrondi(x), y: arrondi(y),
    b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(arrondi),
    d: chemin(anneaux, true), surface: Math.abs(aire(grand)),
  };
});

// Contour de chaque région (frontières avec les autres régions + côte) et ensemble des frontières de régions
const regionDe = (g) => g.properties.region;
const lignes = (m) => chemin(m.coordinates, false);
const regionsSortie = regions.map((r) => {
  const miens = districts.filter((d) => d.region === r.nom);
  const poids = miens.reduce((s, d) => s + d.surface, 0) || 1;
  return {
    nom: r.nom,
    x: arrondi(miens.reduce((s, d) => s + d.x * d.surface, 0) / poids), y: arrondi(miens.reduce((s, d) => s + d.y * d.surface, 0) / poids),
    d: lignes(mesh(simple, objet, (a, b) => (a === b ? regionDe(a) === r.nom : (regionDe(a) === r.nom) !== (regionDe(b) === r.nom)))),
  };
});
const frontieres = lignes(mesh(simple, objet, (a, b) => a === b || regionDe(a) !== regionDe(b)));

const sortie = {
  source: "Régions et districts sanitaires de Côte d'Ivoire (fichiers CI_REGION_SANITAIRE et CI_DISTRICT_SANITAIRE, 2019-2020), contours simplifiés.",
  projection: { LON0, LAT1, K, S }, largeur, hauteur,
  districts: districts.map(({ surface, ...d }) => d),
  regions: regionsSortie, frontieres,
};
const fichier = path.join(__dirname, 'districts_geo.json');
fs.writeFileSync(fichier, JSON.stringify(sortie));
const brut = dist.reduce((n, d) => n + d.anneaux.reduce((m, a) => m + a.length, 0), 0);
console.log(`${districts.length} districts, ${regionsSortie.length} régions ; points ${brut} → ${nbPoints} (poids min ${POIDS_MIN}) ; ${(fs.statSync(fichier).size / 1024).toFixed(0)} Ko`);
const manquants = regions.filter((r) => !districts.some((d) => d.region === r.nom)).map((r) => r.nom);
if (manquants.length) console.warn(`! régions sans district : ${manquants.join(', ')}`);
