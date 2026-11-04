# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Suivi de la migration mSupply → Open mSupply (LHSPLA)

Répondre et commenter le code **en français**.

## Contexte métier

- Côte d'Ivoire : **2 905 sites** à migrer de mSupply (version commerciale) vers Open mSupply,
  dans **113 districts** et **33 régions** (valeurs dans la table `parametre`, modifiables).
- Source des données : extrait Excel de l'application de suivi de la **DAP** (Direction de
  l'Activité Pharmaceutique), feuille « Sites ». Chaque import est conservé (historique).
- **Les étapes de migration ne sont PAS suivies** (tables supprimées par `004_…sql`) : un site est migré quand
  son statut est `TERMINE`. Statuts : `TERMINE`, `EN_COURS`, `NON_DEMARRE`.
- **Date de migration** d'un site = `suivi_site.fin_reelle` (colonne Excel « Fin réelle »).
- **Catégorie de site** (`categorie_site`) déduite du sigle du nom (`server/src/services/categories.js`) :
  ESPC (CSR, DR, CSI, CSU, FSU, CAT, ONG, DM, + CSUS), DISTRICT_SANITAIRE (DS, « District sanitaire »),
  HOPITAL_REFERENCE (HG, EPHD, CHU, CHR, + « Hôpital général ») ; sinon A_CLASSER. La colonne Excel
  « Catégorie de site » l'emporte.
- **Période de migration** = mission par district et par vague : « Début mission » / « Fin mission » (Excel ou
  affectation), sinon MIN(debut_reel) et MAX(fin_reelle des sites terminés).
- **Taux de migration national** = sites `TERMINE` **de type MIGRATION** du dernier import / `objectif_sites`.
- **Régions prioritaires LHSPLA** (10 sur 33, `server/src/services/regionsPrioritaires.js`) : ABIDJAN 2,
  AGNEBY-TIASSA, BELIER, GBEKE, HAUT-SASSANDRA, INDENIE-DJUABLIN, LA ME, LOH-DJIBOUA, PORO, TONKPI. Point dédié
  à côté du point global ; toujours listées, même absentes de l'extrait. Taux = sites de l'extrait (pas
  d'objectif officiel par région).
- **Nouveaux sites** : colonne Excel « Type de site » = « Nouveau site » → `suivi_site.type_site = 'NOUVEAU'`
  (déploiement direct sur Open mSupply). Comptés à part (`nouveaux`, `nouveaux_deployes`) ; toutes les
  statistiques « sites / migres / en_cours / non_demarres » ne portent que sur `MIGRATION`.
- Alimentation : fichier Excel au format de `docs/Modele_alimentation_suivi_migration.xlsx`
  (colonnes reconnues par leur nom ; feuille « Sites »).

### Règle de l'équipe SI (importante)
Un membre de l'équipe Système d'information est responsable de **tous les sites d'un district**,
pas seulement des sites où il est inscrit comme « Responsable ». Ses districts =
1. ses affectations (`affectation_district`, avec la vague) ;
2. les districts où il est « Responsable » d'au moins un site dans le dernier import.

Rapprochement « Responsable » ↔ membre (`server/src/services/membres.js`) : alias exact, ou tous
les mots du libellé (≥ 2) présents dans le nom complet (accents et apostrophes ignorés).

Membres actuels : Mme KOUAKOU ABLIMAN THERESE D'AVILA epse DJEREKE (alias « Djereke Davila »),
GONCALVES JESSICA, TEKI JOEL ACHI FABIEN, SIE AMAN NINA, GUEI CHRISTIAN RICHARD DESGUEYES.

### Pièges connus des extraits
- Les **codes de district ne sont pas fiables** (DIST-011 et DIST-012 servent pour deux districts
  chacun) : un district est identifié par **nom + région**, jamais par son code.
- Les dates sont des textes « JJ/MM/AAAA » ; l'en-tête du tableau est en ligne 4 et une ligne
  « Généré le … par … » le précède. Les colonnes d'étapes, « Avancement % » et « Étape en cours » de
  l'export DAP sont ignorées.
- « RAS » dans la colonne Difficultés signifie « rien à signaler ».

### Carte
`client/src/pages/Carte.jsx` + `client/src/data/civ_geo.json` (contours Natural Earth pré-projetés en SVG,
chefs-lieux GeoNames ; régénérable avec `data/generer_civ_geo.js`). Un district est placé sur son chef-lieu
(`lieuDistrict`), un site à ses coordonnées GPS (`site.latitude/longitude`, colonnes Excel « Latitude » /
« Longitude », ignorées hors Côte d'Ivoire) sinon autour du chef-lieu. Aucune tuile en ligne.

## Architecture

```
server/   Node.js 22, Express 4, PostgreSQL (pg), Socket.IO, ExcelJS, JWT + bcrypt — ES modules
  sql/NNN_*.sql            migrations SQL appliquées dans l'ordre (ne jamais modifier une migration
                           déjà livrée : en ajouter une nouvelle, ex. 003_….sql)
  src/routes/api.js        toutes les routes /api (protégées par JWT ; rôles lecteur < contributeur < admin)
  src/services/importer.js lecture de l'extrait + contrôle qualité + enregistrement (transaction)
  src/services/statistiques.js  tous les calculs (SQL) : synthèse, régions/districts, équipe SI…
  test/api.test.js         tests sur l'extrait réel test/fixtures/extrait_20261102.xlsx
client/   React 18 + Vite, React Router, Recharts, socket.io-client
  src/App.jsx              mise en page, navigation, temps réel (useDonnees recharge à chaque événement)
  src/pages/*.jsx          un fichier par écran
  src/styles.css           styles (variables CSS en tête)
```

Temps réel : après un import ou un changement d'équipe/objectifs, le serveur émet `import` ou
`equipe` via Socket.IO ; le client recharge les données de la page affichée.

Points de liaison utiles :
- `creerApp({ notifier })` (`server/src/app.js`) construit l'app Express sans Socket.IO : `index.js` branche
  le vrai `notifier`, les tests en passent un qui enregistre les événements. `/api/auth` est dans
  `routes/auth.js`, le reste dans `routes/api.js`. Si `CLIENT_DIST` est défini, le serveur sert aussi `client/dist`.
- Migrations : `scripts/migrate.js` applique les `sql/*.sql` absents de la table `schema_migrations`
  (une transaction par fichier, ordre alphabétique) ; `npm run init` l'appelle.
- Client : `api.js` (fetch `/api…` + jeton JWT dans `localStorage`, erreurs → `ErreurApi`),
  `tempsReel.js` (`useTempsReel`), `auth.jsx` (session). En dev, Vite relaie `/api` et `/socket.io`
  vers `API_URL` (défaut `http://localhost:4000`).

## Commandes

```bash
# Serveur (dans server/) — nécessite DATABASE_URL (voir ../.env.example)
npm install
npm run init -- admin MotDePasseAdmin   # migrations + équipe SI + compte admin
npm run import -- test/fixtures/extrait_20261102.xlsx
npm run dev                              # http://localhost:4000

# Tests (base dédiée dont le nom contient « test » : elle est VIDÉE)
DATABASE_URL=postgres://suivi:motdepasse@localhost:5432/suivi_test npm test
# Un seul test (filtre sur le nom passé à test(…))
DATABASE_URL=… node --test --test-name-pattern="équipe SI" test/api.test.js

# Interface (dans client/)
npm install
npm run dev                              # http://localhost:5173 (proxy vers :4000)
npm run build

# Tout en Docker (à la racine)
cp .env.example .env && docker compose up -d --build   # http://localhost:8080
```

## Interface

Mise en page type « Argon Dashboard » : `App.jsx` (`Cadre` : menu latéral `MENU`, bandeau `.bandeau`,
contenu `.contenu` remonté sur le bandeau), icônes SVG maison dans `components/Icones.jsx`, thème en fin de
`styles.css` (couleurs du bandeau : `--marine` #0b1f4b et `--bordeaux` #7b1530 ; variables `--a-*`, cartes `.panel`, `.stat`, `.carte-sombre`, `.carte-blanche`). Police Open Sans.
Ne pas reprendre le logo ni le nom « argon ».

## Conventions

- Textes de l'interface, messages d'erreur et commentaires en **français**, phrases courtes.
- Nombres et dates au format français (`toLocaleString('fr-FR')`, « JJ/MM/AAAA », « 58,3 % »).
- Toute requête SQL est paramétrée (`$1`, `$2`…) ; jamais de concaténation de valeurs utilisateur.
- Les routes qui modifient des données vérifient le rôle avec `role('contributeur')` ou `role('admin')`
  et appellent `notifier(...)` pour le temps réel.
- Après une modification du serveur : lancer `npm test` ; ajouter un test pour toute nouvelle règle.
  Les tests (`node:test` + supertest) sont séquentiels : `before()` vide le schéma, initialise et importe
  l'extrait une seule fois, puis les tests partagent cet état. Il n'y a pas de linter.
- Après une modification de l'interface : `npm run build` doit passer sans erreur.

## Pistes d'évolution

1. Charger la liste officielle des 2 905 sites (district, région) pour suivre aussi les districts
   absents de l'extrait.
2. Alimentation automatique depuis l'application de la DAP (API) au lieu de l'import manuel.
3. Écran de saisie des missions (table `mission` déjà présente).
4. Comparaison détaillée entre deux imports ; carte des sites ; exports Excel/PDF.
