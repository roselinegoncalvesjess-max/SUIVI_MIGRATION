// Régénère civ_geo.json (à lancer dans un dossier où sont installés world-atlas@2.0.2, all-the-cities et topojson-client).
// Construit civ_geo.json : contour de la Côte d'Ivoire et des voisins (Natural Earth 10m, domaine public,
// via world-atlas) projetés en SVG, et chefs-lieux (GeoNames via all-the-cities, CC-BY).
const fs=require('fs');const topo=require('topojson-client');const cities=require('all-the-cities');
const w=JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-10m.json'));
const all=topo.feature(w,w.objects.countries).features;
const CIV='384', VOISINS={'430':'Liberia','324':'Guinée','466':'Mali','854':'Burkina Faso','288':'Ghana'};
// Projection équirectangulaire corrigée à la latitude moyenne
const LON0=-8.75, LON1=-2.35, LAT0=4.15, LAT1=10.85, K=Math.cos(7.5*Math.PI/180);
const W=1000, S=W/((LON1-LON0)*K), H=Math.round((LAT1-LAT0)*S);
const P=([lon,lat])=>[+(((lon-LON0)*K*S).toFixed(1)), +(((LAT1-lat)*S).toFixed(1))];
function chemin(geom){
  const polys=geom.type==='Polygon'?[geom.coordinates]:geom.coordinates;
  let d='';
  for(const poly of polys) for(const ring of poly){
    // garde les anneaux qui touchent la zone affichée
    if(!ring.some(([x,y])=>x>LON0-3&&x<LON1+3&&y>LAT0-3&&y<LAT1+3)) continue;
    let prev=null, out=[];
    for(const pt of ring){ const q=P(pt); if(prev&&Math.abs(q[0]-prev[0])+Math.abs(q[1]-prev[1])<1.2) continue; out.push(q); prev=q; }
    if(out.length>2) d+='M'+out.map(q=>q.join(',')).join('L')+'Z';
  }
  return d;
}
const civ=all.find(f=>f.id===CIV);
const voisins=all.filter(f=>VOISINS[f.id]).map(f=>({nom:VOISINS[f.id],d:chemin(f.geometry)}));
const villes=cities.filter(c=>c.country==='CI').map(c=>({nom:c.name,lat:+c.loc.coordinates[1].toFixed(4),lon:+c.loc.coordinates[0].toFixed(4)}));
// Communes / districts sanitaires d'Abidjan (absents de GeoNames cities) : positions approximatives
const abidjan=[['Koumassi',5.297,-3.950],['Port-Bouët',5.257,-3.926],['Port-Bouët-Vridi',5.257,-3.926],['Treichville',5.297,-4.008],['Marcory',5.303,-3.983],['Treichville-Marcory',5.300,-3.995],['Yopougon',5.335,-4.090],['Yopougon-Est',5.345,-4.060],['Yopougon-Ouest',5.330,-4.120],['Cocody',5.355,-3.985],['Abobo',5.420,-4.020],['Adjamé',5.365,-4.025],['Attécoubé',5.335,-4.040],['Plateau',5.325,-4.020],['Anyama',5.495,-4.052],['Bingerville',5.355,-3.885],['Songon',5.310,-4.250]];
abidjan.forEach(([n,lat,lon])=>villes.push({nom:n,lat,lon,approx:true}));
const out={source:"Contours : Natural Earth (domaine public). Chefs-lieux : GeoNames (CC BY 4.0). Communes d'Abidjan : positions approximatives.",
  projection:{LON0,LAT1,K,S},largeur:W,hauteur:H,civ:chemin(civ.geometry),voisins,villes};
fs.writeFileSync('civ_geo.json',JSON.stringify(out));
console.log('W',W,'H',H,'civ',out.civ.length,'voisins',voisins.map(v=>v.nom+':'+v.d.length).join(' '),'villes',villes.length,'taille',JSON.stringify(out).length);
