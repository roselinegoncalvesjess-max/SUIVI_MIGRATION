// Tests sur l'extrait réel du 02/11/2026 (379 sites).
// Nécessite une base PostgreSQL de test : DATABASE_URL=postgres://…/suivi_test npm test
// ATTENTION : la base indiquée est entièrement vidée.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { pool, transaction } from '../src/db.js';
import { corrigerZones } from '../src/services/corrigerZones.js';
import { reparerEncodage } from '../src/services/importer.js';
import { lireListeDepots } from '../src/services/referentiel.js';
import { creerApp } from '../src/app.js';
import { initialiser } from '../src/scripts/init.js';
import { importerExtrait } from '../src/services/importer.js';
import { regionPrioritaire } from '../src/services/regionsPrioritaires.js';
import { categorieDuNom } from '../src/services/categories.js';
import { reclasser, reclasserNouveaux } from '../src/scripts/reclasser.js';
import { classerNouveaux, cleSite, contexteNouveaux } from '../src/services/classementNouveaux.js';

const EXTRAIT = new URL('./fixtures/extrait_20261102.xlsx', import.meta.url);
const evenements = [];
const app = creerApp({ notifier: (e, d) => evenements.push([e, d]) });
let admin;
let lecteur;
let resultat;

before(async () => {
  if (!/test/.test(process.env.DATABASE_URL || '')) throw new Error('DATABASE_URL doit désigner une base de test (son nom doit contenir « test »).');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await initialiser({ admin: 'admin', motDePasse: 'admin-test-123', silencieux: true });
  resultat = await importerExtrait(await readFile(EXTRAIT), 'extrait_20261102.xlsx');
  admin = (await request(app).post('/api/auth/connexion').send({ identifiant: 'admin', motDePasse: 'admin-test-123' })).body.jeton;
  await request(app).post('/api/utilisateurs').set('Authorization', `Bearer ${admin}`)
    .send({ identifiant: 'lecteur', motDePasse: 'lecteur-test-123', role: 'lecteur' });
  lecteur = (await request(app).post('/api/auth/connexion').send({ identifiant: 'lecteur', motDePasse: 'lecteur-test-123' })).body.jeton;
});
after(() => pool.end());

const get = (url, jeton = lecteur) => request(app).get(url).set('Authorization', `Bearer ${jeton}`);

test('totaux de l\'import', () => {
  const i = resultat.import;
  assert.deepEqual([i.nb_sites, i.nb_termines, i.nb_en_cours, i.nb_non_demarres], [378, 220, 15, 143]); // CSU OLIVIA YACE (« Site nouvellement ajouté ») est un nouveau site déployé, plus une migration
  assert.equal(i.genere_par, 'Jessica Goncalves');
});

test('contrôle qualité', () => {
  const t = resultat.avertissements.join('\n');
  assert.match(t, /CSR NAFOUN/);
  assert.match(t, /SIRASSO/);
  assert.match(t, /Code DIST-011 utilisé pour plusieurs districts/);
  // Le district fixe la région : YOPOUGON-EST est dans ABIDJAN 1, pas dans LOH-DJIBOUA comme l'écrit l'extrait
  assert.match(t, /YOPOUGON-EST : région « LOH-DJIBOUA » dans l'extrait, rattaché à ABIDJAN 1 d'après la carte officielle \(1 site\)/);
  // Commentaire « Site nouvellement ajouté pour l'utilisation de mSupply » : nouveau site déployé directement sur Open mSupply
  assert.match(t, /CSU OLIVIA YACE : commentaire « Site nouvellement ajouté » : classé nouveau site/);
});

test('tableau de bord : taux, régions et districts', async () => {
  const r = await get('/api/tableau-de-bord');
  assert.equal(r.status, 200);
  const s = r.body.synthese;
  assert.equal(s.taux, 58.2);
  assert.deepEqual([s.objectif_sites, s.objectif_districts, s.objectif_regions], [2905, 113, 33]);
  assert.equal(s.taux_national, 7.6);
  assert.equal(s.sites_restants, 2905 - 220);
  assert.deepEqual([s.regions, s.regions_touchees, s.districts, s.districts_touches, s.districts_complets], [11, 10, 22, 16, 14]);
  const belier = r.body.regions.find((x) => x.nom === 'BELIER');
  assert.deepEqual([belier.sites, belier.migres, belier.taux], [120, 115, 95.8]);
  const k1 = r.body.regions.flatMap((x) => x.districts).find((d) => d.nom === 'KORHOGO 1');
  assert.equal(k1.complet, true);
  // Catégories déduites du nom des sites
  const cat = Object.fromEntries(r.body.categories.map((c) => [c.categorie, c.sites]));
  assert.deepEqual(cat, { ESPC: 335, DISTRICT_SANITAIRE: 13, HOPITAL_REFERENCE: 21, CMS: 6, INHP: 3 });
  // Période de migration de Korhogo 2 (vague 1) : du premier début réel à la dernière date de migration
  const k2 = r.body.missions.find((m) => m.district === 'KORHOGO 2' && m.vague === 1);
  assert.deepEqual([k2.debut, k2.fin, k2.duree_jours, k2.migres, k2.terminee], ['2026-10-26', '2026-10-29', 4, 16, true]);
});

test('régions prioritaires : les 10 régions, à côté du point global', async () => {
  const r = await get('/api/tableau-de-bord');
  const p = r.body.prioritaires;
  assert.equal(p.regions.length, 10);
  // LOH-DJIBOUA n'a plus son site migré : YOPOUGON-EST est rattaché à ABIDJAN 1 (région non prioritaire)
  assert.deepEqual([p.nb_regions, p.regions_presentes, p.regions_touchees, p.regions_completes], [10, 5, 4, 2]);
  assert.deepEqual([p.total.sites, p.total.migres, p.total.taux], [347, 189, 54.5]);
  // Le point prioritaire et les autres régions redonnent le total de l'extrait
  const s = r.body.synthese;
  assert.deepEqual([p.total.sites + p.autres.sites, p.total.migres + p.autres.migres], [s.sites, s.migres]);
  assert.deepEqual([p.autres.sites, p.autres.migres], [31, 31]);
  const poro = p.regions.find((x) => x.nom === 'PORO');
  assert.deepEqual([poro.sites, poro.migres, poro.taux, poro.districts, poro.districts_touches], [129, 69, 53.5, 5, 2]);
  // Une région absente de l'extrait reste listée, sans lien vers ses sites
  const tonkpi = p.regions.find((x) => x.nom === 'TONKPI');
  assert.deepEqual([tonkpi.presente, tonkpi.id, tonkpi.sites, tonkpi.taux], [false, null, 0, 0]);
  assert.equal(r.body.regions.find((x) => x.nom === 'BELIER').prioritaire, true);
  assert.equal(r.body.regions.find((x) => x.nom === 'BAGOUE').prioritaire, false);
});

test('zones : un district mal rangé est ramené à sa région officielle', async () => {
  const { rows: [ab1] } = await pool.query(`SELECT d.id FROM district d JOIN region r ON r.id = d.region_id WHERE d.nom = 'YOPOUGON-EST' AND r.nom = 'ABIDJAN 1'`);
  const { rows: [loh] } = await pool.query(`SELECT id FROM region WHERE nom = 'LOH-DJIBOUA'`);
  const { rows: [membre] } = await pool.query('SELECT id FROM membre ORDER BY id LIMIT 1');
  // Ancien état : un 2e YOPOUGON-EST sous LOH-DJIBOUA (avec une affectation), une région « ME » avec le district ADZOPE et un site
  const { rows: [vieux] } = await pool.query(`INSERT INTO district (nom, region_id) VALUES ('YOPOUGON-EST', $1) RETURNING id`, [loh.id]);
  await pool.query('INSERT INTO affectation_district (membre_id, district_id) VALUES ($1, $2)', [membre.id, vieux.id]);
  const { rows: [me] } = await pool.query(`INSERT INTO region (nom) VALUES ('ME') RETURNING id`);
  const { rows: [adz] } = await pool.query(`INSERT INTO district (nom, region_id) VALUES ('ADZOPE', $1) RETURNING id`, [me.id]);
  const { rows: [site] } = await pool.query(`INSERT INTO site (nom, district_id) VALUES ('SITE TEST ZONES', $1) RETURNING id`, [adz.id]);
  try {
    assert.deepEqual(await transaction((c) => corrigerZones(c)), { deplaces: 1, fusionnes: 1, regionsSupprimees: 0 });
    // YOPOUGON-EST : une seule ligne, dans ABIDJAN 1, avec son site et l'affectation
    const { rows: yop } = await pool.query(`SELECT d.id, r.nom AS region, (SELECT count(*) FROM site s WHERE s.district_id = d.id)::int AS sites FROM district d JOIN region r ON r.id = d.region_id WHERE d.nom = 'YOPOUGON-EST'`);
    assert.deepEqual(yop.map((x) => [x.id, x.region, x.sites]), [[ab1.id, 'ABIDJAN 1', 1]]);
    assert.equal((await pool.query('SELECT 1 FROM affectation_district WHERE membre_id = $1 AND district_id = $2', [membre.id, ab1.id])).rowCount, 1);
    // « ME » devient « LA ME » avec son district et son site
    const { rows: regions } = await pool.query(`SELECT nom FROM region WHERE nom IN ('ME', 'LA ME')`);
    assert.deepEqual(regions.map((x) => x.nom), ['LA ME']);
    assert.equal((await pool.query(`SELECT 1 FROM site s JOIN district d ON d.id = s.district_id JOIN region r ON r.id = d.region_id WHERE s.id = $1 AND d.nom = 'ADZOPE' AND r.nom = 'LA ME'`, [site.id])).rowCount, 1);
    // Les filtres de la liste des sites ne montrent plus qu'un YOPOUGON-EST, dans ABIDJAN 1
    const f = (await get('/api/filtres')).body;
    const regionYop = f.regions.find((r) => r.id === f.districts.find((d) => d.nom === 'YOPOUGON-EST').region_id).nom;
    assert.deepEqual([f.districts.filter((d) => d.nom === 'YOPOUGON-EST').length, regionYop], [1, 'ABIDJAN 1']);
    // Rien d'autre à corriger
    assert.deepEqual(await transaction((c) => corrigerZones(c)), { deplaces: 0, fusionnes: 0, regionsSupprimees: 0 });
  } finally {
    await pool.query('DELETE FROM affectation_district WHERE membre_id = $1 AND district_id = $2', [membre.id, ab1.id]);
    await pool.query('DELETE FROM site WHERE id = $1', [site.id]);
    await pool.query('DELETE FROM district WHERE id = $1', [adz.id]);
    await pool.query(`DELETE FROM region WHERE nom = 'LA ME'`);
  }
});

test('référentiel des dépôts : effectifs réels et taux de migration', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Feuil1');
  ws.addRow([null, 'LISTE DES DEPOTS DEPLOYES mSupply PAR DISTRICT ET REGION']);
  ws.addRow([]);
  ws.addRow([null, 'Nom du dépôt', 'Catégorie', 'District', 'Region']);
  const ajouter = (district, region, n) => { for (let i = 1; i <= n; i++) ws.addRow([null, `DEPOT ${district} ${i}`, 'ESPC/PPS', district, region]); };
  ajouter('KORHOGO 1', 'PORO', 60); ajouter('KORHOGO 2', 'PORO', 16); ajouter("M'BENGUE", 'PORO', 30);
  ajouter('SINEMATIALI', 'PORO', 21); ajouter('DIKODOUGOU', 'PORO', 15);
  ajouter('MAN', 'TONKPI ', 4); ws.addRow([null, 'DEPOT MAN 1', 'NONE', 'MAN', 'TONKPI']); // doublon, sans catégorie
  ajouter('DANANE', 'TONKPI', 3);
  ajouter('ADZOPE', 'ME', 2);              // région écrite autrement : LA ME
  ajouter('OUANGOLO', 'TCHOLOGO', 2);      // district écrit autrement : OUANGOLODOUGOU
  ajouter('YOPOUGON-EST', 'LOH-DJIBOUA', 1); // mauvaise région : ABIDJAN 1
  ajouter('DISTRICT INCONNU', 'PORO', 1);  // ignoré
  const fichier = Buffer.from(await wb.xlsx.writeBuffer());
  try {
    // Seul un administrateur charge le référentiel
    assert.equal((await request(app).post('/api/referentiel').set('Authorization', `Bearer ${lecteur}`).attach('fichier', fichier, 'liste.xlsx')).status, 403);
    assert.equal((await request(app).post('/api/referentiel').set('Authorization', `Bearer ${admin}`)).status, 400);
    const rep = await request(app).post('/api/referentiel').set('Authorization', `Bearer ${admin}`).attach('fichier', fichier, 'liste.xlsx');
    assert.equal(rep.status, 201, rep.body.erreur);
    assert.equal(rep.body.referentiel.nb_depots, 155);
    const t = rep.body.avertissements.join('\n');
    assert.match(t, /District « DISTRICT INCONNU » inconnu : 1 dépôt\(s\) ignoré\(s\)/);
    assert.match(t, /YOPOUGON-EST : « LOH-DJIBOUA » dans le fichier, ABIDJAN 1 d'après la carte/);
    assert.match(t, /1 nom\(s\) de dépôt en double dans un même district/);
    assert.match(t, /1 dépôt\(s\) sans catégorie/);
    const ref = (await get('/api/referentiel')).body.referentiel;
    assert.deepEqual(ref.regions.map((x) => [x.region, x.depots]), [['PORO', 142], ['TONKPI', 8], ['LA ME', 2], ['TCHOLOGO', 2], ['ABIDJAN 1', 1]]);

    const d = (await get('/api/tableau-de-bord')).body;
    const region = (nom) => d.regions.find((x) => x.nom === nom);
    const poro = region('PORO');
    // Taux sur les dépôts du référentiel (142), plus sur les seuls sites de l'extrait (129)
    assert.deepEqual([poro.depots, poro.base, poro.migres, poro.taux, poro.taux_extrait], [142, 142, 69, 48.6, 53.5]);
    const k1 = poro.districts.find((x) => x.nom === 'KORHOGO 1');
    assert.deepEqual([k1.depots, k1.sites, k1.migres, k1.taux, k1.complet], [60, 53, 53, 88.3, false]);
    // Dépôts d'un district : jamais moins que les sites de l'extrait (taux ≤ 100 %)
    assert.equal(poro.districts.find((x) => x.nom === 'KORHOGO 2').taux, 100);
    // Régions et districts absents de l'extrait : listés avec leurs dépôts, sans lien vers des sites
    const tonkpi = region('TONKPI');
    assert.deepEqual([tonkpi.id, tonkpi.sites, tonkpi.depots, tonkpi.taux, tonkpi.districts.length], [null, 0, 8, 0, 2]);
    assert.equal(region('LA ME').depots, 2);
    assert.equal(region('TCHOLOGO').districts[0].nom, 'OUANGOLODOUGOU');
    // YOPOUGON-EST : région officielle ABIDJAN 1
    assert.deepEqual([region('ABIDJAN 1').sites, region('ABIDJAN 1').migres, region('ABIDJAN 1').depots, region('ABIDJAN 1').complet], [1, 1, 1, true]);
    assert.deepEqual([d.synthese.depots_referentiel, d.synthese.sites], [155, 378]);
    // Total national = somme des bases des districts (142 PORO + 1 + 8 + 2 + 2 + 249 sites d'autres districts)
    assert.deepEqual([d.synthese.base_depots, d.synthese.taux_depots, d.synthese.sites_restants], [403, 54.6, 183]);
    const prio = d.prioritaires.regions.find((x) => x.nom === 'TONKPI');
    assert.deepEqual([prio.presente, prio.depots, prio.taux], [false, 8, 0]);
    // Avec une vague choisie, le référentiel (qui ignore les vagues) n'est pas utilisé
    const v1 = (await get('/api/tableau-de-bord?vague=1')).body;
    assert.equal(v1.regions.find((x) => x.nom === 'PORO').depots, undefined);
    assert.equal(v1.synthese.depots_referentiel, null);
    // La carte reçoit les effectifs par district
    const f = (await get('/api/filtres')).body.referentiel;
    assert.equal(f.length, 10);
    assert.equal(f.find((x) => x.district === 'KORHOGO 1').n, 60);
  } finally {
    await pool.query('DELETE FROM referentiel_import'); // les tests suivants se font sans référentiel
  }
});

/** Classeur « Nouveaux sites » : en-tête en ligne 1, tableau des sites puis, à droite, un récapitulatif par DS à ignorer. */
async function classeurNouveaux(lignes) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Feuil2');
  ws.addRow(['N°', 'REGION', 'DISTRICT', "NOM D'ETABLISSEMENT", 'RAISON', 'STATUT', 'TYPE SITE', null, 'DS PREVU ', 'DESKTOP PREVU', 'MOBILE PREVU']);
  lignes.forEach((l, i) => ws.addRow([i + 1, ...l]));
  ws.getRow(2).getCell(9).value = 'AGBOVILLE'; ws.getRow(2).getCell(10).value = 0; ws.getRow(2).getCell(11).value = 3;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('référentiel : export du tableau de bord mSupply (accents abîmés, type de structure, dépôts sans district)', async () => {
  // Accents relus en Windows-1252 : réparés ; texte correct inchangé
  assert.equal(reparerEncodage('Nom du dÃ©pot'), 'Nom du dépot');
  assert.equal(reparerEncodage('CSR BLÃŠ'), 'CSR BLÊ');
  assert.equal(reparerEncodage('CMS CONFESIONNEL Ste ThÃ©rÃ¨se'), 'CMS CONFESIONNEL Ste Thérèse');
  assert.equal(reparerEncodage('Catégorie déjà correcte'), 'Catégorie déjà correcte');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Données brutes complètes-data-2');
  ws.addRow(['N°', 'Nom du dÃ©pot', 'CatÃ©gorie', 'District', 'Region', 'Type de structure']);
  ws.addRow([1, 'CAT-DS AdzopÃ©', 'NONE', 'ADZOPE', 'ME', 'CAT']);
  ws.addRow([2, 'HG PUBLIC de KOUMASSI', 'Clients Directs', 'KOUMASSI', 'ABIDJAN 2', 'HG']);
  ws.addRow([3, 'INHP SIEGE - PHARMACIE', 'Clients Directs', 'INHP-SIEGE', 'INHP-CENTRAL', 'INHP']);
  ws.addRow([4, 'CHR PUBLIC de GAGNOA-ARV', 'NONE', 'NONE', 'NONE', 'CHR']);
  const { depots, avertissements } = await lireListeDepots(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.deepEqual(depots.map((d) => [d.nom, d.district, d.region, d.type]), [['CAT-DS Adzopé', 'ADZOPE', 'LA ME', 'CAT'], ['HG PUBLIC de KOUMASSI', 'KOUMASSI', 'ABIDJAN 2', 'HG']]);
  const t = avertissements.join('\n');
  assert.match(t, /District « INHP-SIEGE » inconnu : 1 dépôt\(s\) ignoré\(s\)/);
  assert.match(t, /District « NONE » inconnu : 1 dépôt\(s\) ignoré\(s\)/);
});

test('liste des nouveaux sites : comptés au tableau de bord', async () => {
  const OUV = 'NOUVEAU SITE OUVERT APRES LE DEPLOIEMENT';
  const fichier = await classeurNouveaux([
    ['TONKPI ', 'DANANE', 'DR A', OUV, 'OUI', 'MOBILE'], ['TONKPI ', 'DANANE', 'CSR B', OUV, 'OUI', 'MOBILE'], ['TONKPI ', 'DANANE', 'DR C', OUV, 'OUI', 'DESKTOP'],
    ['ME', 'ALEPE', 'CSR D', 'NOUVEAU', 'OUI', 'MOBILE'], ['ME', 'ALEPE', 'CSR E', 'NOUVEAU', 'OUI', 'MOBILE'], // ME → LA ME
    ['PORO', 'KORHOGO', 'CSR F', OUV, 'OUI', 'MOBILE'], ['PORO', 'KORHOGO', 'CSR G', OUV, 'OUI', 'MOBILE'], // KORHOGO → KORHOGO 1
    ['PORO', "M'BENGUE", 'CSR H', OUV, 'OUI', 'MOBILE'],
    ['PORO', "M'BENGUE", null, 'NOUVEAU', 'OUI', 'MOBILE'], // sans nom : ignoré
    ['PORO', 'DISTRICT INCONNU', 'CSR I', OUV, 'OUI', 'MOBILE'], // district inconnu : ignoré
    ['PORO', 'SINEMATIALI', 'CSR J', OUV, 'NON', 'MOBILE'], // statut autre que OUI ou NOUVEAU SITE : ignoré
    ['PORO', 'SINEMATIALI', 'CSR L', OUV, 'NOUVEAU SITE', 'MOBILE'], // « NOUVEAU SITE » vaut « OUI »
  ]);
  const poster = (jeton) => request(app).post('/api/nouveaux-sites').set('Authorization', `Bearer ${jeton}`).attach('fichier', fichier, 'Nouveaux sites mSupply.xlsx');
  try {
    assert.equal((await poster(lecteur)).status, 403);
    assert.equal((await request(app).post('/api/nouveaux-sites').set('Authorization', `Bearer ${admin}`)).status, 400);
    const rep = await poster(admin);
    assert.equal(rep.status, 201, rep.body.erreur);
    assert.equal(rep.body.liste.nb_sites, 9);
    const t = rep.body.avertissements.join('\n');
    assert.match(t, /Ligne \d+ sans nom d'établissement/);
    assert.match(t, /District « DISTRICT INCONNU » inconnu : 1 site\(s\) ignoré\(s\)/);
    assert.match(t, /District « KORHOGO » ambigu .* 2 site\(s\) rattaché\(s\) à KORHOGO 1/);
    assert.match(t, /1 ligne\(s\) dont le STATUT n'est ni « OUI » ni « NOUVEAU SITE »/);
    assert.deepEqual((await get('/api/nouveaux-sites')).body.liste.regions.map((x) => [x.region, x.n]), [['PORO', 4], ['TONKPI', 3], ['LA ME', 2]]);

    const d = (await get('/api/tableau-de-bord')).body;
    // L'extrait n'a aucun nouveau site : les 8 viennent de la liste, tous « à déployer »
    assert.deepEqual([d.synthese.nouveaux, d.synthese.nouveaux_liste, d.synthese.nouveaux_deployes, d.synthese.sites], [10, 9, 1, 378]); // 9 de la liste + 1 de l'extrait (OLIVIA YACE, déployé)
    assert.equal(d.nouveaux_sites.length, 9);
    const region = (nom) => d.regions.find((x) => x.nom === nom);
    assert.equal(region('PORO').nouveaux, 4);
    assert.equal(region('PORO').districts.find((x) => x.nom === 'KORHOGO 1').nouveaux, 2);
    // Région absente de l'extrait : listée grâce à ses nouveaux sites, sans lien vers des sites
    assert.deepEqual([region('TONKPI').id, region('TONKPI').sites, region('TONKPI').nouveaux], [null, 0, 3]);
    assert.equal(region('LA ME').nouveaux, 2);
    assert.deepEqual([d.prioritaires.regions.find((x) => x.nom === 'TONKPI').presente, d.prioritaires.total.nouveaux], [true, 10]);
    // Sans référentiel : pas de dépôts, les taux restent ceux de l'extrait
    assert.equal(region('PORO').depots, null);
    assert.equal(region('PORO').taux, 53.5);
    // Avec une vague choisie, la liste (sans vagues) n'est pas utilisée
    const v1 = (await get('/api/tableau-de-bord?vague=1')).body;
    assert.deepEqual([v1.synthese.nouveaux, v1.nouveaux_sites.length], [1, 0]); // 1 de l'extrait (vague 1), aucun de la liste
    const f = (await get('/api/filtres')).body.nouveaux;
    assert.deepEqual(f.map((x) => `${x.district}:${x.n}`).sort(), ['ALEPE:2', 'DANANE:3', 'KORHOGO 1:2', "M'BENGUE:1", 'SINEMATIALI:1']);
  } finally {
    await pool.query('DELETE FROM nouveau_site_import');
  }
});

test('nouveaux sites : liste des nouveaux sites + tableau de bord mSupply + commentaire « nouvellement ajouté »', async () => {
  // Le commentaire classe CSU OLIVIA YACE (terminé) en nouveau site déployé directement sur Open mSupply
  const olivia = (await get('/api/sites?q=OLIVIA')).body.sites[0];
  assert.deepEqual([olivia.type_site, olivia.statut], ['NOUVEAU', 'TERMINE']);

  // Référentiel = tableau de bord mSupply (tous les sites en service) : « CSR PRESENTE » y figure (nouveau site déjà
  // déployé), pas « CSR NEUVE » ni « CSR ALLOKOKRO »
  const wbR = new ExcelJS.Workbook();
  const wsR = wbR.addWorksheet('Feuil1');
  wsR.addRow([null, 'Nom du dépôt', 'Catégorie', 'District', 'Region']);
  wsR.addRow([null, 'PRESENTE (CSR-D PUBLIC)', 'ESPC/PPS', 'DANANE', 'TONKPI']);
  wsR.addRow([null, 'AUTRE DEPOT', 'ESPC/PPS', 'DIDIEVI', 'BELIER']);
  // Liste des nouveaux sites (fichier 2) : l'un est déjà déployé sur mSupply, l'un est dans l'extrait (CSR ALLOKOKRO, migration)
  const liste = await classeurNouveaux([
    ['TONKPI', 'DANANE', 'CSR PRESENTE', 'NOUVEAU', 'OUI', 'MOBILE'],
    ['TONKPI', 'DANANE', 'CSR NEUVE', 'NOUVEAU', 'OUI', 'MOBILE'],
    ['BELIER', 'DIDIEVI', 'CSR ALLOKOKRO', 'NOUVEAU', 'OUI', 'MOBILE'],
    ['BELIER', 'YAMOUSSOUKRO', 'CSU OLIVIA YACE NGOKRO', 'NOUVEAU', 'NOUVEAU SITE', 'MOBILE'], // = CSU OLIVIA YACE de l'extrait (nom complété) : pas recompté
  ]);
  const jeton = `Bearer ${admin}`;
  try {
    assert.equal((await request(app).post('/api/referentiel').set('Authorization', jeton).attach('fichier', Buffer.from(await wbR.xlsx.writeBuffer()), 'liste.xlsx')).status, 201);
    assert.equal((await request(app).post('/api/nouveaux-sites').set('Authorization', jeton).attach('fichier', liste, 'nouveaux.xlsx')).status, 201);
    // Un site de la liste présent au tableau de bord mSupply est un nouveau site déjà déployé
    const l = (await get('/api/nouveaux-sites')).body.liste;
    assert.deepEqual(l.deja_deployes.map((x) => `${x.nom} (${x.district})`), ['CSR PRESENTE (DANANE)']);
    // Avant reclassement : CSR ALLOKOKRO (dans l'extrait) n'est pas recompté ; CSR NEUVE (à déployer) et CSR PRESENTE (déployé) s'ajoutent
    let d = (await get('/api/tableau-de-bord')).body;
    let s = d.synthese;
    assert.deepEqual([s.nouveaux, s.nouveaux_liste, s.nouveaux_deployes], [3, 2, 2]); // OLIVIA YACE (extrait, déployé) + NEUVE + PRESENTE (déployé)
    assert.deepEqual(d.nouveaux_sites.map((x) => [x.nom, x.deploye]).sort(), [['CSR NEUVE', false], ['CSR PRESENTE', true]]);
    // Sites à migrer : le dépôt « PRESENTE » (nouveau site déjà déployé) est retiré de DANANE
    const danane = d.regions.find((r) => r.nom === 'TONKPI').districts.find((x) => x.nom === 'DANANE');
    assert.deepEqual([danane.depots, danane.base, danane.nouveaux, danane.nouveaux_deployes], [0, 0, 2, 1]);
    assert.equal(d.regions.find((r) => r.nom === 'BELIER').districts.find((x) => x.nom === 'DIDIEVI').depots, 1);
    assert.equal((await get('/api/filtres')).body.referentiel.find((x) => x.district === 'DANANE').nouveaux, 1);
    // La règle : dans la liste des nouveaux sites ⇒ nouveau site (ALLOKOKRO et PRESENTE)
    const ctx = await contexteNouveaux();
    const lignes = [
      { site: 'CSR ALLOKOKRO', district: 'DIDIEVI', commentaires: '', typeSite: 'MIGRATION' },
      { site: 'CSR PRESENTE', district: 'DANANE', commentaires: '', typeSite: 'MIGRATION' },
      { site: 'CSR ASSIHUE', district: 'DIDIEVI', commentaires: 'RAS', typeSite: 'MIGRATION' },
      { site: 'CSR NOUVELLEMENT', district: 'DIDIEVI', commentaires: "Site nouvellement ajouté  pour l'utilisation de mSupply.", typeSite: 'MIGRATION' },
    ];
    const notes = classerNouveaux(lignes, ctx);
    assert.deepEqual(lignes.map((x) => x.typeSite), ['NOUVEAU', 'NOUVEAU', 'MIGRATION', 'NOUVEAU']);
    assert.equal(notes.length, 3);
    assert.match(notes[0], /CSR ALLOKOKRO : dans la liste des nouveaux sites : classé nouveau site/);
    // Sur l'import existant : reclassement (un site, CSR ALLOKOKRO) et compteurs de l'import recalculés
    assert.equal(await reclasserNouveaux(), 1);
    s = (await get('/api/tableau-de-bord')).body.synthese;
    assert.deepEqual([s.nouveaux, s.nouveaux_liste, s.nouveaux_deployes, s.sites], [4, 2, 3, 377]); // + ALLOKOKRO (extrait, terminé)
    assert.equal(await reclasserNouveaux(), 0);
  } finally {
    await pool.query('DELETE FROM nouveau_site_import');
    await pool.query('DELETE FROM referentiel_import');
    // Retour à l'état de l'extrait pour les tests suivants
    await pool.query(`UPDATE suivi_site SET type_site = 'MIGRATION' WHERE site_id = (SELECT id FROM site WHERE nom = 'CSR ALLOKOKRO')`);
    await reclasserNouveaux();
  }
});

test('tableau de bord : filtre sur la vague de migration', async () => {
  const tout = (await get('/api/tableau-de-bord')).body;
  const v0 = (await get('/api/tableau-de-bord?vague=0')).body;
  const v1 = (await get('/api/tableau-de-bord?vague=1')).body;
  assert.equal(tout.vague, null);
  assert.deepEqual([v0.vague, v1.vague], [0, 1]);
  assert.deepEqual([v0.synthese.sites, v0.synthese.migres, v0.synthese.taux, v0.synthese.regions, v0.synthese.districts], [38, 38, 100, 10, 12]);
  assert.deepEqual([v1.synthese.sites, v1.synthese.migres, v1.synthese.en_cours, v1.synthese.regions, v1.synthese.districts], [340, 182, 15, 3, 12]);
  // Taux national : sites migrés de la vague rapportés à l'objectif national
  assert.equal(v1.synthese.taux_national, 6.3);
  // Pas de comparaison entre imports quand une vague est choisie
  assert.equal(v1.synthese.evolution, undefined);
  assert.notEqual(tout.synthese.evolution, undefined);
  // Régions, catégories, missions et rythme se limitent à la vague ; le tableau « par vague » reste complet
  assert.deepEqual(v1.regions.map((r) => r.nom).sort(), ['BELIER', 'LOH-DJIBOUA', 'PORO']);
  assert.equal(v1.categories.reduce((n, c) => n + c.sites, 0), 340);
  assert.ok(v1.missions.every((m) => m.vague === 1));
  assert.equal(v1.rythme.reel.at(-1).cumul, 182);
  assert.equal(v1.vagues.length, 2);
  // Régions prioritaires : LOH-DJIBOUA garde ses 93 sites de la vague 1, ABIDJAN 2 n'en a aucun
  assert.deepEqual([v1.prioritaires.total.sites, v1.prioritaires.total.migres], [340, 182]);
  assert.equal(v1.prioritaires.regions.find((r) => r.nom === 'ABIDJAN 2').presente, false);
  // Valeur invalide : ignorée (toutes les vagues)
  assert.equal((await get('/api/tableau-de-bord?vague=abc')).body.vague, null);
});

test('filtres : liste des régions prioritaires pour la carte', async () => {
  const r = await get('/api/filtres');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.prioritaires, ['ABIDJAN 2', 'AGNEBY-TIASSA', 'BELIER', 'GBEKE', 'HAUT-SASSANDRA', 'INDENIE-DJUABLIN', 'LA ME', 'LOH-DJIBOUA', 'PORO', 'TONKPI']);
});

test('catégories : INHP, CMS et ESPC déduits du nom', async () => {
  const attendu = {
    INHP: ['ANTENNE PORT BOUET-VRIDI', 'ANTENNE YOPOUGON', 'INHP SIEGE'],
    CMS: ['CMS Baptiste de TORGOKAHA', 'CMS CONFESSIONNEL de BEVOGO', 'CMS PALMCI DIVO', "Notre Dame de l'Incarnation de SUIBIAKRO (CMS CONF )", 'Centre de Santé Confessionnel et Nutritionnel Simé', 'ENERGIE de YAMOUSSOUKRO (CM PRIVE)'],
    ESPC: ['DU SANHARA', 'INF-MAC DIVO', 'INFIRMERIE MAC TOUMODI', 'INPHB-CENTRE PUBLIC de YAMASSOUKRO', 'CSR ALLOKOKRO'],
    HOPITAL_REFERENCE: ['HG PUBLIC de KOUMASSI'],
    A_CLASSER: ['CENTRE SANS SIGLE CONNU'],
  };
  for (const [categorie, noms] of Object.entries(attendu)) for (const nom of noms) assert.equal(categorieDuNom(nom), categorie, nom);
  // Les filtres de la liste des sites acceptent les nouvelles catégories
  assert.equal((await get('/api/sites?categorie=INHP')).body.sites.length, 3);
  assert.equal((await get('/api/sites?categorie=CMS')).body.sites.length, 6);
  // Reclasser : un site « À classer » retrouve sa catégorie d'après les règles
  await pool.query(`UPDATE suivi_site SET categorie = 'A_CLASSER' WHERE site_id = (SELECT id FROM site WHERE nom = 'INHP SIEGE')`);
  assert.equal((await get('/api/sites?categorie=A_CLASSER')).body.sites.length, 1);
  assert.equal(await reclasser(), 1);
  assert.equal((await get('/api/sites?categorie=A_CLASSER')).body.sites.length, 0);
  assert.equal(await reclasser(), 0);
});

test('régions prioritaires : graphies acceptées', () => {
  assert.equal(regionPrioritaire('ME'), 'LA ME');
  assert.equal(regionPrioritaire('la mé'), 'LA ME');
  assert.equal(regionPrioritaire('Tonpki'), 'TONKPI');
  assert.equal(regionPrioritaire('Bélier'), 'BELIER');
  assert.equal(regionPrioritaire('BAGOUE'), null);
});

test('équipe SI : tous les sites des districts de chaque membre', async () => {
  const r = await get('/api/equipe-si');
  const p = Object.fromEntries(r.body.membres.map((m) => [m.nom_complet, m]));
  const jess = p['GONCALVES JESSICA'];
  assert.deepEqual(jess.districts.map((d) => d.nom), ['KORHOGO 1']);
  assert.deepEqual([jess.sites, jess.migres, jess.taux], [53, 53, 100]); // tout Korhogo 1, pas seulement ses 13 sites
  assert.deepEqual(jess.vagues, [1]);
  const nina = p['SIE AMAN NINA'];
  assert.deepEqual([nina.districts[0].nom, nina.sites, nina.migres], ['YAMOUSSOUKRO', 31, 28]);
  const dj = p["Mme KOUAKOU ABLIMAN THERESE D'AVILA epse DJEREKE"];
  assert.deepEqual([dj.districts[0].nom, dj.sites, dj.migres, dj.en_cours], ['SINEMATIALI', 21, 0, 9]);
  assert.equal(p['TEKI JOEL ACHI FABIEN'].sites, 0);
});

test('affectation d\'un district à un membre', async () => {
  const membres = (await get('/api/membres')).body.membres;
  const guei = membres.find((m) => m.nom_complet.startsWith('GUEI'));
  const divo = (await get('/api/districts')).body.districts.find((d) => d.nom === 'DIVO');
  const r = await request(app).post(`/api/membres/${guei.id}/districts`).set('Authorization', `Bearer ${admin}`).send({ district_id: divo.id, vague: 2 });
  assert.equal(r.status, 201);
  const g = (await get('/api/equipe-si')).body.membres.find((m) => m.id === guei.id);
  assert.deepEqual([g.sites, g.migres, g.non_demarres], [42, 0, 42]);
  assert.deepEqual(g.districts[0].origines, ['affectation']);
  assert.equal((await request(app).post(`/api/membres/${guei.id}/districts`).set('Authorization', `Bearer ${lecteur}`).send({ district_id: divo.id })).status, 403);
  await request(app).delete(`/api/affectations/${r.body.affectation.id}`).set('Authorization', `Bearer ${admin}`);
});

test('objectifs nationaux modifiables par un administrateur', async () => {
  const r = await request(app).put('/api/parametres').set('Authorization', `Bearer ${admin}`).send({ sites: 3000 });
  assert.equal(r.body.sites, 3000);
  assert.equal((await get('/api/tableau-de-bord')).body.synthese.taux_national, 7.3);
  await request(app).put('/api/parametres').set('Authorization', `Bearer ${admin}`).send({ sites: 2905 });
  assert.equal((await request(app).put('/api/parametres').set('Authorization', `Bearer ${lecteur}`).send({ sites: 1 })).status, 403);
});

test('filtres de la liste des sites', async () => {
  assert.equal((await get('/api/sites?statut=EN_COURS')).body.sites.length, 15);
  assert.equal((await get('/api/sites?q=korhogo')).body.sites.length, 69);
  const site = (await get('/api/sites?q=KAPELE')).body.sites[0];
  assert.equal(site.categorie, 'ESPC');
  assert.equal(site.date_migration, '2026-10-28');
  assert.equal((await get('/api/sites?categorie=HOPITAL_REFERENCE')).body.sites.length, 21);
});

test('droits : un lecteur ne peut pas importer ni gérer l\'équipe', async () => {
  assert.equal((await get('/api/tableau-de-bord', 'jeton-invalide')).status, 401);
  const imp = await request(app).post('/api/imports').set('Authorization', `Bearer ${lecteur}`).attach('fichier', Buffer.from('x'), 'a.xlsx');
  assert.equal(imp.status, 403);
  assert.equal((await request(app).post('/api/membres').set('Authorization', `Bearer ${lecteur}`).send({ nom_complet: 'X' })).status, 403);
});

test('import par l\'API et notification temps réel', async () => {
  const r = await request(app).post('/api/imports').set('Authorization', `Bearer ${admin}`)
    .attach('fichier', await readFile(EXTRAIT), 'extrait_20261102.xlsx');
  assert.equal(r.status, 201);
  assert.ok(evenements.some(([e]) => e === 'import'));
  const h = (await get('/api/historique')).body.imports;
  assert.equal(h.length, 2);
  assert.equal(h[0].evolution, 0);
  const bad = await request(app).post('/api/imports').set('Authorization', `Bearer ${admin}`).attach('fichier', Buffer.from('pas un excel'), 'faux.xlsx');
  assert.equal(bad.status, 400);
});

test('un alias ajouté relie aussitôt les sites', async () => {
  const membres = (await get('/api/membres')).body.membres;
  const teki = membres.find((m) => m.nom_complet === 'TEKI JOEL ACHI FABIEN');
  const r = await request(app).post(`/api/membres/${teki.id}/alias`).set('Authorization', `Bearer ${admin}`).send({ libelle: 'Ouattara Idriss' });
  assert.equal(r.status, 201);
  const p = (await get('/api/equipe-si')).body.membres.find((m) => m.id === teki.id);
  // « Ouattara Idriss » est responsable de sites à Sinématiali : tout le district (21 sites) est rattaché
  assert.deepEqual([p.districts.map((d) => d.nom), p.sites], [['SINEMATIALI'], 21]);
  await request(app).delete(`/api/alias/${r.body.alias.id}`).set('Authorization', `Bearer ${admin}`);
});

test('nouveaux sites : colonne « Type de site » comptée à part', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFile(EXTRAIT));
  const ws = wb.getWorksheet('Sites');
  const col = ws.getRow(4).cellCount + 1;
  ws.getRow(4).getCell(col).value = 'Type de site';
  // On déclare comme « nouveaux » 3 sites : 2 terminés (lignes 5 et 6) et 1 site non démarré de Divo
  let divo = null;
  ws.eachRow((row, n) => {
    if (n < 5) return;
    row.getCell(col).value = 'Migration';
    if (!divo && row.getCell(5).value === 'DIVO') divo = n;
  });
  for (const n of [5, 6, divo]) ws.getRow(n).getCell(col).value = 'Nouveau site';
  const fichier = Buffer.from(await wb.xlsx.writeBuffer());

  const r = await request(app).post('/api/imports').set('Authorization', `Bearer ${admin}`).attach('fichier', fichier, 'avec_nouveaux.xlsx');
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.import.nb_sites, r.body.import.nb_nouveaux, r.body.import.nb_nouveaux_deployes], [375, 4, 3]); // 3 déclarés + OLIVIA YACE (commentaire)
  const s = (await get('/api/tableau-de-bord')).body.synthese;
  assert.deepEqual([s.sites, s.migres, s.nouveaux, s.nouveaux_deployes, s.sites_open_msupply], [375, 218, 4, 3, 221]);
  assert.equal(s.taux_national, 7.5); // 219 / 2905
  assert.equal((await get('/api/sites?type=NOUVEAU')).body.sites.length, 4);
  const divoD = (await get('/api/tableau-de-bord')).body.regions.flatMap((x) => x.districts).find((d) => d.nom === 'DIVO');
  assert.deepEqual([divoD.sites, divoD.nouveaux], [41, 1]);
});

test('liste des nouveaux sites : pas de double compte avec l\'extrait', async () => {
  // Le dernier extrait compte déjà 4 nouveaux sites (3 déclarés + 1 par commentaire) : l'un d'eux figure aussi dans la liste
  const deja = (await get('/api/sites?type=NOUVEAU')).body.sites[0];
  const fichier = await classeurNouveaux([
    [deja.region, deja.district, deja.site, 'NOUVEAU', 'OUI', 'MOBILE'], // déjà dans l'extrait (même district) : pas recompté
    ['TONKPI', 'DANANE', 'CSR K', 'NOUVEAU', 'OUI', 'MOBILE'],
  ]);
  try {
    const rep = await request(app).post('/api/nouveaux-sites').set('Authorization', `Bearer ${admin}`).attach('fichier', fichier, 'liste.xlsx');
    assert.equal(rep.status, 201, rep.body.erreur);
    const d = (await get('/api/tableau-de-bord')).body;
    assert.deepEqual([d.synthese.nouveaux, d.synthese.nouveaux_liste, d.synthese.nouveaux_deployes], [5, 1, 3]);
    assert.deepEqual(d.nouveaux_sites.map((x) => x.nom), ['CSR K']);
  } finally {
    await pool.query('DELETE FROM nouveau_site_import');
  }
});

test('fichier sans colonnes d\'étapes, avec catégorie et dates de mission', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFile(EXTRAIT));
  const ws = wb.getWorksheet('Sites');
  ws.spliceColumns(15, 9); // retire les 9 colonnes d'étapes
  const n = ws.getRow(4).cellCount;
  ws.getRow(4).getCell(n + 1).value = 'Catégorie de site';
  ws.getRow(4).getCell(n + 2).value = 'Début mission';
  ws.getRow(4).getCell(n + 3).value = 'Fin mission';
  ws.getRow(4).getCell(n + 4).value = 'Latitude';
  ws.getRow(4).getCell(n + 5).value = 'Longitude';
  ws.eachRow((row, i) => {
    if (i < 5) return;
    if (row.getCell(5).value === 'LAKOTA') { row.getCell(n + 2).value = '10/11/2026'; row.getCell(n + 3).value = '20/11/2026'; }
    if (String(row.getCell(1).value).startsWith('CMS PALMCI')) { row.getCell(n + 1).value = 'ESPC'; row.getCell(n + 4).value = '5,8412'; row.getCell(n + 5).value = -5.3601; }
    if (String(row.getCell(1).value).startsWith('CSR KAPELE')) { row.getCell(n + 4).value = 48.85; row.getCell(n + 5).value = 2.35; } // hors Côte d'Ivoire
  });
  const r = await request(app).post('/api/imports').set('Authorization', `Bearer ${admin}`)
    .attach('fichier', Buffer.from(await wb.xlsx.writeBuffer()), 'sans_etapes.xlsx');
  assert.equal(r.status, 201, r.body.erreur);
  assert.equal(r.body.import.nb_termines, 220);
  const d = (await get('/api/tableau-de-bord')).body;
  const lakota = d.missions.find((m) => m.district === 'LAKOTA');
  assert.deepEqual([lakota.debut, lakota.fin, lakota.duree_jours, lakota.dates_saisies], ['2026-11-10', '2026-11-20', 11, true]);
  assert.equal(d.categories.some((c) => c.categorie === 'A_CLASSER'), false); // plus aucun site « À classer »
  const site = (await get('/api/sites?q=CMS%20PALMCI')).body.sites[0];
  assert.equal(site.categorie, 'ESPC'); // la colonne « Catégorie de site » l'emporte sur la règle (CMS d'après le nom)
  assert.deepEqual([site.latitude, site.longitude], [5.8412, -5.3601]);
  assert.match(r.body.avertissements.join('\n'), /CSR KAPELE : coordonnées GPS hors/);
});

test('corrections manuelles : migré, ancien site, nouveau site à déployer', async () => {
  // Les chiffres d'un nom comptent : « Koutoukro 1 » n'est pas « KOUTOUKRO 2 »
  assert.notEqual(cleSite('CSR-D Public Koutoukro 1'), cleSite('CSR-DM PUBLIC de KOUTOUKRO 2'));
  assert.equal(cleSite('DR LISSOLO SOBARA'), cleSite('CSR-I PUBLIC de LISSOLO SOBARA'));

  const poster = (corps, jeton = admin) => request(app).post('/api/corrections').set('Authorization', `Bearer ${jeton}`).send(corps);
  const ligne = async (nom) => (await pool.query(
    `SELECT s.id, s.statut, s.type_site FROM suivi_site s JOIN site si ON si.id = s.site_id WHERE si.nom = $1 AND s.import_id = (SELECT max(id) FROM import_extrait)`, [nom])).rows[0];
  const { rows: origine } = await pool.query(
    `SELECT s.id, s.statut, s.type_site FROM suivi_site s JOIN site si ON si.id = s.site_id WHERE si.nom IN ('HG PUBLIC de GUITRY', 'CSR-DM PUBLIC de KONI')`);
  try {
    // Seul un administrateur corrige ; district et décision sont vérifiés
    assert.equal((await poster({ nom: 'X', district: 'GUITRY', decision: 'MIGRE' }, lecteur)).status, 403);
    assert.equal((await poster({ nom: 'X', district: 'INCONNU', decision: 'MIGRE' })).status, 400);
    assert.equal((await poster({ nom: 'X', district: 'GUITRY', decision: 'AUTRE' })).status, 400);

    // MIGRE : un site de l'extrait non démarré passe « Terminé » ; un site hors extrait compte suivi et migré
    const avant = (await get('/api/tableau-de-bord')).body.synthese;
    assert.notEqual((await ligne('HG PUBLIC de GUITRY')).statut, 'TERMINE');
    const r1 = await poster({ nom: 'HG PUBLIC de GUITRY', district: 'GUITRY', decision: 'MIGRE', note: 'migré hors DAP' });
    assert.equal(r1.status, 201, r1.body.erreur);
    assert.equal((await ligne('HG PUBLIC de GUITRY')).statut, 'TERMINE');
    assert.equal((await poster({ nom: 'CSUS-CAT PUBLIC de BOUAFLE', district: 'BOUAFLE', decision: 'MIGRE' })).status, 201);
    let d = (await get('/api/tableau-de-bord')).body;
    assert.deepEqual([d.synthese.migres, d.synthese.sites, d.synthese.migres_hors_extrait], [avant.migres + 2, avant.sites + 1, 1]);
    const bouafle = d.regions.flatMap((r) => r.districts).find((x) => x.nom === 'BOUAFLE');
    assert.deepEqual([bouafle.sites, bouafle.migres], [2, 2]);
    assert.deepEqual((await get('/api/filtres')).body.migres_hors_extrait.map((x) => `${x.district}:${x.n}`), ['BOUAFLE:1']);

    // Liste des nouveaux sites : CSR KONI (dans l'extrait) devient nouveau site… puis la correction ANCIEN le remet en migration
    const liste = await classeurNouveaux([
      ['PORO', 'KORHOGO', 'CSR KONI', 'ND', 'NOUVEAU SITE', 'MOBILE'],
      ['TONKPI', 'DANANE', 'CSR NEUVE2', 'NOUVEAU', 'NOUVEAU SITE', 'MOBILE'],
      ['ME', 'ALEPE', 'CSR-D Public Koutoukro 1', 'NOUVEAU', 'NOUVEAU SITE', 'MOBILE'],
    ]);
    assert.equal((await request(app).post('/api/nouveaux-sites').set('Authorization', `Bearer ${admin}`).attach('fichier', liste, 'n.xlsx')).status, 201);
    await reclasserNouveaux();
    assert.equal((await ligne('CSR-DM PUBLIC de KONI')).type_site, 'NOUVEAU');
    const ancien = await poster({ nom: 'CSR-DM PUBLIC de KONI', district: 'KORHOGO 1', decision: 'ANCIEN', note: 'CSR KONI' });
    assert.equal(ancien.status, 201, ancien.body.erreur);
    assert.equal((await ligne('CSR-DM PUBLIC de KONI')).type_site, 'MIGRATION');

    // Tableau de bord mSupply : KOUTOUKRO 2 et « CSR FORCE » ; la correction NOUVEAU fait de CSR FORCE un nouveau site à déployer
    const wbR = new ExcelJS.Workbook();
    const wsR = wbR.addWorksheet('Feuil1');
    wsR.addRow(['N°', 'Nom du dépot', 'Catégorie', 'District', 'Region', 'Type de structure']);
    wsR.addRow([1, 'CSR-DM PUBLIC de KOUTOUKRO 2', 'ESPC/PPS', 'ALEPE', 'ME', 'ESPC']);
    wsR.addRow([2, 'CSR FORCE', 'ESPC/PPS', 'ALEPE', 'ME', 'ESPC']);
    assert.equal((await request(app).post('/api/referentiel').set('Authorization', `Bearer ${admin}`).attach('fichier', Buffer.from(await wbR.xlsx.writeBuffer()), 'r.xlsx')).status, 201);
    assert.equal((await poster({ nom: 'CSR FORCE', district: 'ALEPE', decision: 'NOUVEAU' })).status, 201);
    d = (await get('/api/tableau-de-bord')).body;
    // KONI exclu (ancien) ; NEUVE2, Koutoukro 1 (≠ KOUTOUKRO 2) et CSR FORCE sont des nouveaux sites à déployer
    assert.deepEqual(d.nouveaux_sites.map((x) => [x.nom, x.deploye]).sort(), [['CSR FORCE', false], ['CSR NEUVE2', false], ['CSR-D Public Koutoukro 1', false]]);
    assert.equal(d.synthese.nouveaux_liste, 3);
    // Sites à migrer d'ALEPE : KOUTOUKRO 2 seulement (CSR FORCE est un nouveau site)
    const alepe = (await get('/api/filtres')).body.referentiel.find((x) => x.district === 'ALEPE');
    assert.deepEqual([alepe.n, alepe.nouveaux], [1, 1]);
    assert.equal((await get('/api/corrections')).body.corrections.length, 4);

    // Retirer la correction ANCIEN : CSR KONI redevient un nouveau site (liste)
    const id = (await get('/api/corrections')).body.corrections.find((c) => c.decision === 'ANCIEN').id;
    assert.equal((await request(app).delete(`/api/corrections/${id}`).set('Authorization', `Bearer ${lecteur}`)).status, 403);
    assert.equal((await request(app).delete(`/api/corrections/${id}`).set('Authorization', `Bearer ${admin}`)).status, 200);
    assert.equal((await ligne('CSR-DM PUBLIC de KONI')).type_site, 'NOUVEAU');
  } finally {
    await pool.query('DELETE FROM correction_site');
    await pool.query('DELETE FROM nouveau_site_import');
    await pool.query('DELETE FROM referentiel_import');
    for (const o of origine) await pool.query('UPDATE suivi_site SET statut = $2, type_site = $3 WHERE id = $1', [o.id, o.statut, o.type_site]);
    await reclasserNouveaux();
  }
});
