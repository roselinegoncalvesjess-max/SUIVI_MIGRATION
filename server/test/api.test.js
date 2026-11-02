// Tests sur l'extrait réel du 02/11/2026 (379 sites).
// Nécessite une base PostgreSQL de test : DATABASE_URL=postgres://…/suivi_test npm test
// ATTENTION : la base indiquée est entièrement vidée.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { pool } from '../src/db.js';
import { creerApp } from '../src/app.js';
import { initialiser } from '../src/scripts/init.js';
import { importerExtrait } from '../src/services/importer.js';

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
  assert.deepEqual([i.nb_sites, i.nb_termines, i.nb_en_cours, i.nb_non_demarres], [379, 221, 15, 143]);
  assert.equal(i.genere_par, 'Jessica Goncalves');
});

test('contrôle qualité', () => {
  const t = resultat.avertissements.join('\n');
  assert.match(t, /CSR NAFOUN/);
  assert.match(t, /SIRASSO/);
  assert.match(t, /Code DIST-011 utilisé pour plusieurs districts/);
});

test('tableau de bord : taux, régions et districts', async () => {
  const r = await get('/api/tableau-de-bord');
  assert.equal(r.status, 200);
  const s = r.body.synthese;
  assert.equal(s.taux, 58.3);
  assert.deepEqual([s.objectif_sites, s.objectif_districts, s.objectif_regions], [2905, 113, 33]);
  assert.equal(s.taux_national, 7.6);
  assert.equal(s.sites_restants, 2905 - 221);
  assert.deepEqual([s.regions, s.regions_touchees, s.districts, s.districts_touches, s.districts_complets], [10, 10, 22, 16, 14]);
  const belier = r.body.regions.find((x) => x.nom === 'BELIER');
  assert.deepEqual([belier.sites, belier.migres, belier.taux], [121, 116, 95.9]);
  const k1 = r.body.regions.flatMap((x) => x.districts).find((d) => d.nom === 'KORHOGO 1');
  assert.equal(k1.complet, true);
  assert.equal(r.body.etapes.length, 9);
});

test('équipe SI : tous les sites des districts de chaque membre', async () => {
  const r = await get('/api/equipe-si');
  const p = Object.fromEntries(r.body.membres.map((m) => [m.nom_complet, m]));
  const jess = p['GONCALVES JESSICA'];
  assert.deepEqual(jess.districts.map((d) => d.nom), ['KORHOGO 1']);
  assert.deepEqual([jess.sites, jess.migres, jess.taux], [53, 53, 100]); // tout Korhogo 1, pas seulement ses 13 sites
  assert.deepEqual(jess.vagues, [1]);
  const nina = p['SIE AMAN NINA'];
  assert.deepEqual([nina.districts[0].nom, nina.sites, nina.migres], ['YAMOUSSOUKRO', 32, 29]);
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
  assert.equal((await get('/api/tableau-de-bord')).body.synthese.taux_national, 7.4);
  await request(app).put('/api/parametres').set('Authorization', `Bearer ${admin}`).send({ sites: 2905 });
  assert.equal((await request(app).put('/api/parametres').set('Authorization', `Bearer ${lecteur}`).send({ sites: 1 })).status, 403);
});

test('filtres de la liste des sites', async () => {
  assert.equal((await get('/api/sites?statut=EN_COURS')).body.sites.length, 15);
  assert.equal((await get('/api/sites?q=korhogo')).body.sites.length, 69);
  const site = (await get('/api/sites?q=BEVOGO')).body.sites[0];
  assert.equal(site.etapes.length, 9);
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
