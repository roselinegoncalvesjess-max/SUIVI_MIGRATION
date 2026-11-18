import { Router } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { connecte, role } from '../middleware/auth.js';
import { ErreurImport, importerExtrait } from '../services/importer.js';
import { rapprocherTout } from '../services/membres.js';
import * as stats from '../services/statistiques.js';
import { REGIONS_PRIORITAIRES } from '../services/regionsPrioritaires.js';
import { effectifsAMigrer, importerReferentiel, referentielActuel } from '../services/referentiel.js';
import { importerNouveaux, nouveauxActuels, nouveauxEnPlus } from '../services/nouveauxSites.js';
import { DECISIONS, enregistrerCorrection, listeCorrections, supprimerCorrection } from '../services/corrections.js';
import { reclasserNouveaux } from '../scripts/reclasser.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const asynchrone = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Crée le routeur ; `notifier(evenement, donnees)` prévient les navigateurs connectés (Socket.IO). */
export default function api(notifier = () => {}) {
  const r = Router();
  r.use(connecte);

  // Charge le dernier import (404 si aucun)
  const avecImport = asynchrone(async (req, res, next) => {
    req.imp = await stats.dernierImport();
    if (!req.imp) return res.status(404).json({ erreur: 'Aucun extrait importé.', aucunImport: true });
    next();
  });

  r.get('/tableau-de-bord', avecImport, asynchrone(async (req, res) => {
    const id = req.imp.id;
    // ?vague=N limite le tableau de bord à une vague de migration (le tableau « par vague » reste complet)
    const vague = /^\d+$/.test(req.query.vague || '') ? Number(req.query.vague) : null;
    const [synthese, regions, vagues, categories, missions, rythme] = await Promise.all([
      stats.synthese(req.imp, vague), stats.regionsEtDistricts(id, vague), stats.parVague(id), stats.parCategorie(id, vague),
      stats.missions(id, vague), stats.rythme(id, vague),
    ]);
    const retards = await stats.sites(id, { retard: '1', vague: vague === null ? '' : String(vague) });
    // + dépôts du référentiel et nouveaux sites de la liste permanente, s'ils sont chargés
    const regionsRef = await stats.avecReferentiel(regions, vague, id);
    const nouveauxListe = vague === null ? (await nouveauxEnPlus(id)).sites : [];
    if (regionsRef.some((r) => r.depots !== null && r.depots !== undefined)) {
      // Avec le référentiel, le total national est la somme des bases des districts : il colle au tableau par région
      const base = regionsRef.reduce((s, r) => s + r.base, 0);
      Object.assign(synthese, { base_depots: base, taux_depots: stats.taux(synthese.migres, base), sites_restants: Math.max(base - synthese.migres, 0) });
    }
    res.json({
      import: req.imp, vague, synthese, regions: regionsRef, prioritaires: stats.pointPrioritaires(regionsRef), vagues, categories, missions, rythme, retards,
      nouveaux_sites: nouveauxListe,
    });
  }));

  r.get('/sites', avecImport, asynchrone(async (req, res) => {
    res.json({ import: req.imp, sites: await stats.sites(req.imp.id, req.query) });
  }));

  r.get('/filtres', avecImport, asynchrone(async (req, res) => {
    const { rows: regions } = await query('SELECT id, nom FROM region ORDER BY nom');
    const { rows: districts } = await query('SELECT id, nom, region_id FROM district ORDER BY nom');
    const { rows: vagues } = await query(
      'SELECT DISTINCT vague FROM suivi_site WHERE import_id = $1 AND vague IS NOT NULL ORDER BY vague', [req.imp.id]);
    res.json({ regions, districts, vagues: vagues.map((v) => v.vague), prioritaires: REGIONS_PRIORITAIRES.map(([nom]) => nom), referentiel: await effectifsAMigrer(req.imp.id),
      nouveaux: [...(await nouveauxEnPlus(req.imp.id)).parDistrict].map(([cle, n]) => { const [region, district] = cle.split('|'); return { region, district, n }; }),
      // Sites corrigés « migré » absents de l'extrait (la carte les compte suivis et migrés)
      migres_hors_extrait: [...(await stats.migresHors(req.imp.id)).parDistrict].map(([cle, n]) => { const [region, district] = cle.split('|'); return { region, district, n }; }) });
  }));

  // Corrections manuelles sur des sites (migré, ancien site, nouveau site) : appliquées aussitôt aux imports existants
  r.get('/corrections', asynchrone(async (req, res) => res.json({ corrections: await listeCorrections(), decisions: DECISIONS })));

  r.post('/corrections', role('admin'), asynchrone(async (req, res) => {
    try {
      const correction = await enregistrerCorrection(req.body || {}, req.utilisateur.id);
      const modifies = await reclasserNouveaux();
      notifier('corrections', {});
      res.status(201).json({ correction, modifies, corrections: await listeCorrections() });
    } catch (e) {
      if (e instanceof ErreurImport) return res.status(400).json({ erreur: e.message });
      throw e;
    }
  }));

  r.delete('/corrections/:id', role('admin'), asynchrone(async (req, res) => {
    if (!(await supprimerCorrection(+req.params.id))) return res.status(404).json({ erreur: 'Correction introuvable.' });
    await reclasserNouveaux();
    notifier('corrections', {});
    res.json({ corrections: await listeCorrections() });
  }));

  // Liste permanente des nouveaux sites (sans version commerciale, à déployer sur Open mSupply)
  r.get('/nouveaux-sites', asynchrone(async (req, res) => res.json({ liste: await nouveauxActuels() })));

  r.post('/nouveaux-sites', role('admin'), upload.single('fichier'), asynchrone(async (req, res) => {
    if (!req.file) return res.status(400).json({ erreur: 'Aucun fichier reçu (champ « fichier »).' });
    try {
      const resultat = await importerNouveaux(req.file.buffer, req.file.originalname, req.utilisateur.id);
      notifier('nouveaux', { id: resultat.import.id });
      res.status(201).json({ liste: await nouveauxActuels(), avertissements: resultat.avertissements });
    } catch (e) {
      if (e instanceof ErreurImport) return res.status(400).json({ erreur: e.message });
      throw e;
    }
  }));

  // Référentiel des dépôts déployés sur mSupply (nombre réel de sites par district et région)
  r.get('/referentiel', asynchrone(async (req, res) => res.json({ referentiel: await referentielActuel() })));

  r.post('/referentiel', role('admin'), upload.single('fichier'), asynchrone(async (req, res) => {
    if (!req.file) return res.status(400).json({ erreur: 'Aucun fichier reçu (champ « fichier »).' });
    try {
      const resultat = await importerReferentiel(req.file.buffer, req.file.originalname, req.utilisateur.id);
      notifier('referentiel', { id: resultat.import.id });
      res.status(201).json({ referentiel: await referentielActuel(), avertissements: resultat.avertissements });
    } catch (e) {
      if (e instanceof ErreurImport) return res.status(400).json({ erreur: e.message });
      throw e;
    }
  }));

  r.get('/equipe-si', avecImport, asynchrone(async (req, res) => {
    res.json({ import: req.imp, membres: await stats.participationEquipe(req.imp.id) });
  }));

  r.get('/historique', asynchrone(async (req, res) => res.json({ imports: await stats.historique() })));

  r.get('/imports/:id/avertissements', asynchrone(async (req, res) => {
    const { rows: [i] } = await query('SELECT avertissements FROM import_extrait WHERE id = $1', [+req.params.id]);
    if (!i) return res.status(404).json({ erreur: 'Import introuvable.' });
    res.json({ avertissements: i.avertissements });
  }));

  r.post('/imports', role('contributeur'), upload.single('fichier'), asynchrone(async (req, res) => {
    if (!req.file) return res.status(400).json({ erreur: 'Aucun fichier reçu.' });
    if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ erreur: 'Seuls les fichiers .xlsx sont acceptés.' });
    try {
      const resultat = await importerExtrait(req.file.buffer, req.file.originalname, req.utilisateur.id);
      notifier('import', { id: resultat.import.id });
      res.status(201).json(resultat);
    } catch (e) {
      if (e instanceof ErreurImport) return res.status(400).json({ erreur: e.message });
      throw e;
    }
  }));

  // ---------------------------------------------------------------- membres (admin)
  const apresChangementEquipe = async () => {
    const imp = await stats.dernierImport();
    if (imp) await rapprocherTout(imp.id);
    notifier('equipe', {});
  };

  r.get('/membres', asynchrone(async (req, res) => {
    const { rows } = await query(
      `SELECT m.*,
         COALESCE((SELECT json_agg(json_build_object('id', a.id, 'libelle', a.libelle) ORDER BY a.libelle)
                   FROM alias_membre a WHERE a.membre_id = m.id), '[]') AS alias,
         COALESCE((SELECT json_agg(json_build_object('id', x.id, 'district_id', d.id, 'district', d.nom, 'region', r.nom, 'vague', x.vague, 'debut_mission', x.debut_mission, 'fin_mission', x.fin_mission) ORDER BY d.nom)
                   FROM affectation_district x JOIN district d ON d.id = x.district_id JOIN region r ON r.id = d.region_id
                   WHERE x.membre_id = m.id), '[]') AS affectations
       FROM membre m ORDER BY m.nom_complet`);
    res.json({ membres: rows });
  }));

  // ---------------------------------------------------------------- affectations de districts (admin)
  r.post('/membres/:id/districts', role('admin'), asynchrone(async (req, res) => {
    const districtId = +req.body?.district_id;
    const vague = req.body?.vague === '' || req.body?.vague == null ? null : +req.body.vague;
    const dateOuNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
    const debut = dateOuNull(req.body?.debut_mission);
    const fin = dateOuNull(req.body?.fin_mission);
    if (debut && fin && fin < debut) return res.status(400).json({ erreur: 'La fin de mission est antérieure au début.' });
    if (!districtId) return res.status(400).json({ erreur: 'Choisissez un district.' });
    try {
      const { rows: [a] } = await query(
        `INSERT INTO affectation_district (membre_id, district_id, vague, debut_mission, fin_mission) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (membre_id, district_id) DO UPDATE SET vague = EXCLUDED.vague,
           debut_mission = EXCLUDED.debut_mission, fin_mission = EXCLUDED.fin_mission RETURNING *`,
        [+req.params.id, districtId, Number.isFinite(vague) ? vague : null, debut, fin]);
      notifier('equipe', {});
      res.status(201).json({ affectation: a });
    } catch (e) {
      if (e.code === '23503') return res.status(404).json({ erreur: 'Membre ou district introuvable.' });
      throw e;
    }
  }));

  r.delete('/affectations/:id', role('admin'), asynchrone(async (req, res) => {
    await query('DELETE FROM affectation_district WHERE id = $1', [+req.params.id]);
    notifier('equipe', {});
    res.status(204).end();
  }));

  // Référentiel : liste complète des districts, et ajout d'un district absent des extraits
  r.get('/districts', asynchrone(async (req, res) => {
    const { rows } = await query(
      'SELECT d.id, d.nom, r.id AS region_id, r.nom AS region FROM district d JOIN region r ON r.id = d.region_id ORDER BY r.nom, d.nom');
    const { rows: regions } = await query('SELECT id, nom FROM region ORDER BY nom');
    res.json({ districts: rows, regions });
  }));

  r.post('/districts', role('admin'), asynchrone(async (req, res) => {
    const nom = String(req.body?.nom || '').trim().toUpperCase();
    const region = String(req.body?.region || '').trim().toUpperCase();
    if (!nom || !region) return res.status(400).json({ erreur: 'Nom du district et de la région obligatoires.' });
    const { rows: [rg] } = await query(
      'INSERT INTO region (nom) VALUES ($1) ON CONFLICT (nom) DO UPDATE SET nom = EXCLUDED.nom RETURNING id', [region]);
    const { rows: [d] } = await query(
      `INSERT INTO district (nom, region_id) VALUES ($1, $2)
       ON CONFLICT (nom, region_id) DO UPDATE SET nom = EXCLUDED.nom RETURNING *`, [nom, rg.id]);
    res.status(201).json({ district: d });
  }));

  // ---------------------------------------------------------------- objectifs nationaux
  r.get('/parametres', asynchrone(async (req, res) => res.json(await stats.objectifs())));

  r.put('/parametres', role('admin'), asynchrone(async (req, res) => {
    const valeurs = { objectif_sites: req.body?.sites, objectif_districts: req.body?.districts, objectif_regions: req.body?.regions,
      objectif_nouveaux_sites: req.body?.nouveaux };
    for (const [cle, v] of Object.entries(valeurs)) {
      if (v === undefined) continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || (n === 0 && cle !== 'objectif_nouveaux_sites')) {
        return res.status(400).json({ erreur: 'Les objectifs doivent être des nombres entiers positifs.' });
      }
      await query('UPDATE parametre SET valeur = $2 WHERE cle = $1', [cle, n]);
    }
    notifier('import', {}); // les écrans recalculent les taux
    res.json(await stats.objectifs());
  }));

  r.post('/membres', role('admin'), asynchrone(async (req, res) => {
    const nom = String(req.body?.nom_complet || '').trim();
    if (!nom) return res.status(400).json({ erreur: 'Le nom complet est obligatoire.' });
    const { rows: [m] } = await query(
      'INSERT INTO membre (nom_complet, equipe) VALUES ($1, $2) ON CONFLICT (nom_complet) DO UPDATE SET actif = TRUE RETURNING *',
      [nom, req.body?.equipe || 'SI']);
    await apresChangementEquipe();
    res.status(201).json({ membre: m });
  }));

  r.put('/membres/:id', role('admin'), asynchrone(async (req, res) => {
    const { nom_complet: nom, actif } = req.body || {};
    const { rows: [m] } = await query(
      'UPDATE membre SET nom_complet = COALESCE($2, nom_complet), actif = COALESCE($3, actif) WHERE id = $1 RETURNING *',
      [+req.params.id, nom?.trim() || null, typeof actif === 'boolean' ? actif : null]);
    if (!m) return res.status(404).json({ erreur: 'Membre introuvable.' });
    await apresChangementEquipe();
    res.json({ membre: m });
  }));

  r.post('/membres/:id/alias', role('admin'), asynchrone(async (req, res) => {
    const libelle = String(req.body?.libelle || '').trim();
    if (!libelle) return res.status(400).json({ erreur: 'Le libellé de l\'alias est obligatoire.' });
    try {
      const { rows: [a] } = await query('INSERT INTO alias_membre (membre_id, libelle) VALUES ($1, $2) RETURNING *', [+req.params.id, libelle]);
      await apresChangementEquipe();
      res.status(201).json({ alias: a });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ erreur: 'Cet alias est déjà attribué à un membre.' });
      if (e.code === '23503') return res.status(404).json({ erreur: 'Membre introuvable.' });
      throw e;
    }
  }));

  r.delete('/alias/:id', role('admin'), asynchrone(async (req, res) => {
    await query('DELETE FROM alias_membre WHERE id = $1', [+req.params.id]);
    await apresChangementEquipe();
    res.status(204).end();
  }));

  // ---------------------------------------------------------------- utilisateurs (admin)
  r.get('/utilisateurs', role('admin'), asynchrone(async (req, res) => {
    const { rows } = await query('SELECT id, identifiant, nom, role, actif, cree_le FROM utilisateur ORDER BY identifiant');
    res.json({ utilisateurs: rows });
  }));

  r.post('/utilisateurs', role('admin'), asynchrone(async (req, res) => {
    const { identifiant, nom = '', motDePasse, role: roleU = 'lecteur' } = req.body || {};
    if (!identifiant || !motDePasse || motDePasse.length < 8) {
      return res.status(400).json({ erreur: 'Identifiant et mot de passe (8 caractères minimum) requis.' });
    }
    if (!['lecteur', 'contributeur', 'admin'].includes(roleU)) return res.status(400).json({ erreur: 'Rôle inconnu.' });
    try {
      const { rows: [u] } = await query(
        'INSERT INTO utilisateur (identifiant, nom, mot_de_passe, role) VALUES ($1, $2, $3, $4) RETURNING id, identifiant, nom, role, actif',
        [identifiant.trim(), nom.trim(), await bcrypt.hash(motDePasse, 10), roleU]);
      res.status(201).json({ utilisateur: u });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ erreur: 'Cet identifiant existe déjà.' });
      throw e;
    }
  }));

  r.put('/utilisateurs/:id', role('admin'), asynchrone(async (req, res) => {
    const { role: roleU, actif, motDePasse } = req.body || {};
    if (roleU && !['lecteur', 'contributeur', 'admin'].includes(roleU)) return res.status(400).json({ erreur: 'Rôle inconnu.' });
    if (motDePasse !== undefined && String(motDePasse).length < 8) return res.status(400).json({ erreur: 'Mot de passe : 8 caractères minimum.' });
    const { rows: [u] } = await query(
      `UPDATE utilisateur SET role = COALESCE($2::role_utilisateur, role), actif = COALESCE($3, actif),
         mot_de_passe = COALESCE($4, mot_de_passe) WHERE id = $1 RETURNING id, identifiant, nom, role, actif`,
      [+req.params.id, roleU || null, typeof actif === 'boolean' ? actif : null, motDePasse ? await bcrypt.hash(motDePasse, 10) : null]);
    if (!u) return res.status(404).json({ erreur: 'Utilisateur introuvable.' });
    res.json({ utilisateur: u });
  }));

  return r;
}
