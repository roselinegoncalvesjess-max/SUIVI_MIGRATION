# Suivi de la migration mSupply → Open mSupply (LHSPLA)

Application web qui permet à l'équipe LHSPLA de suivre **en temps réel** la migration des sites
de mSupply (version commerciale) vers Open mSupply, à partir des extraits Excel de l'application
de suivi de la Direction de l'Activité Pharmaceutique (DAP).

| Partie | Technologies |
|---|---|
| Interface | **React 18** + Vite, React Router, Recharts, Socket.IO (client) |
| Serveur | **Node.js 22** + Express, Socket.IO, ExcelJS (lecture des extraits), JWT + bcrypt |
| Base de données | **PostgreSQL 16** |
| Déploiement | Docker Compose |

## Fonctionnalités

- **Vue d'ensemble** : **taux de migration national** (sites migrés / 2 905 sites à migrer),
  sites restants, régions (sur 33) et districts (sur 113) ayant au moins un site migré ; tableau **par région et par district** dépliable ; rythme réel comparé au
  planning ; progression par étape ; avancement par vague ; sites en retard.
- **Sites** : liste filtrable (recherche, région, district, statut, vague, retard) avec les 9 étapes.
- **Équipe SI** : participation **par district** : chaque membre est responsable de **tous les
  sites** des districts qui lui sont rattachés (districts affectés + districts où il est inscrit
  comme « Responsable ») ; taux de migration par membre et par district, vagues, tableau membre × vague.
- **Historique** : chaque extrait importé, avec son taux, l'évolution et les incohérences relevées.
- **Importer** (contributeurs) : dépôt d'un fichier .xlsx ; **contrôle qualité** automatique.
- **Administration** (administrateurs) : objectifs nationaux (2 905 sites, 113 districts,
  33 régions), affectation des districts aux membres, alias, ajout de districts absents des
  extraits, comptes utilisateurs.
- **Temps réel** : dès qu'un extrait est importé ou que l'équipe change, tous les écrans ouverts
  se mettent à jour (Socket.IO) et un message s'affiche.

## Démarrage rapide avec Docker

```bash
cp .env.example .env      # modifier les mots de passe et JWT_SECRET
docker compose up -d --build
```

Ouvrir http://localhost:8080 et se connecter avec `ADMIN_IDENTIFIANT` / `ADMIN_MOT_DE_PASSE`.
Au premier démarrage, la base est créée et les cinq membres de l'équipe SI sont enregistrés.

Importer un extrait en ligne de commande (par exemple dans une tâche planifiée) :

```bash
docker compose cp extrait.xlsx app:/tmp/extrait.xlsx
docker compose exec app node src/scripts/import.js /tmp/extrait.xlsx
```

## Développement (sans Docker)

Prérequis : Node.js 20 ou plus, PostgreSQL 14 ou plus.

```sql
-- dans psql, en tant qu'administrateur PostgreSQL
CREATE USER suivi WITH PASSWORD 'motdepasse';
CREATE DATABASE suivi_migration OWNER suivi;
```

```bash
# 1. Serveur (port 4000)
cd server
npm install
echo "DATABASE_URL=postgres://suivi:motdepasse@localhost:5432/suivi_migration" > .env
npm run init -- admin MotDePasseAdmin     # tables + équipe SI + compte admin
npm run import -- test/fixtures/extrait_20261102.xlsx
npm run dev

# 2. Interface (port 5173), dans un autre terminal
cd client
npm install
npm run dev
```

Ouvrir http://localhost:5173. Vite redirige `/api` et `/socket.io` vers le serveur.

## Structure

```
server/
  sql/001_schema.sql          schéma PostgreSQL (tables, vue v_dernier_suivi, 9 étapes)
  src/index.js                démarrage HTTP + Socket.IO
  src/app.js                  application Express
  src/routes/auth.js          connexion (JWT)
  src/routes/api.js           API : tableau de bord, sites, équipe, imports, administration
  src/services/importer.js    lecture de l'extrait Excel + contrôle qualité + enregistrement
  src/services/statistiques.js  calculs (taux par région/district, vagues, étapes, équipe…)
  src/services/membres.js     rapprochement « Responsable » ↔ membres de l'équipe
  src/scripts/                migrate.js, init.js, import.js
  test/api.test.js            tests sur l'extrait réel du 02/11/2026
client/
  src/App.jsx                 mise en page, navigation, temps réel
  src/pages/                  VueEnsemble, Sites, EquipeSI, Historique, Importer, Administration, Connexion
  src/components/Elements.jsx statut, étapes, barre de taux
```

## Modèle de données

```
region ─< district ─< site
etape (les 9 étapes)
membre ─< alias_membre
membre ─< mission >─ district
import_extrait ─< suivi_site >─ site          (une « photo » de chaque site par import)
                  suivi_site ─< suivi_etape >─ etape
membre ─< affectation_district >─ district   (le membre prend en charge tous les sites du district)
parametre (objectif_sites = 2905, objectif_districts = 113, objectif_regions = 33)
utilisateur (rôles : lecteur, contributeur, admin)
```

Les districts sont identifiés par **leur nom et leur région**, pas par leur code : l'extrait du
02/11/2026 utilise le même code pour deux districts (DIST-011 : Port Bouët-Vridi et Didiévi ;
DIST-012 : Yopougon-Est et Toumodi).

Requête utile (taux par région et district du dernier import) :

```sql
SELECT region_nom, district_nom,
       COUNT(*) AS sites,
       COUNT(*) FILTER (WHERE statut = 'TERMINE') AS migres,
       ROUND(100.0 * COUNT(*) FILTER (WHERE statut = 'TERMINE') / COUNT(*), 1) AS taux
FROM v_dernier_suivi
GROUP BY ROLLUP (region_nom, district_nom)
ORDER BY region_nom NULLS LAST, district_nom NULLS FIRST;
```

## Équipe SI : participation par district

Un membre est responsable de la migration de **tous les sites d'un district**. Ses districts sont :

1. les districts que lui affecte un administrateur (avec la vague), dans **Administration** ;
2. les districts où il est inscrit comme « Responsable » d'au moins un site dans le dernier extrait.

Le libellé « Responsable » est relié à un membre s'il correspond à un **alias** (ex. « Djereke
Davila ») ou si tous ses mots figurent dans son nom complet (ex. « Aman Nina » ↔ « SIE AMAN NINA »).

Exemple sur l'extrait du 02/11/2026 : GONCALVES Jessica est responsable de 13 sites à Korhogo 1 ;
elle est donc rattachée à tout le district de Korhogo 1, soit **53 sites, 53 migrés (100 %)**.

## API (extrait)

| Méthode | Chemin | Rôle minimum |
|---|---|---|
| POST | `/api/auth/connexion` | — |
| GET | `/api/tableau-de-bord` | lecteur |
| GET | `/api/sites?region=&district=&statut=&vague=&q=&retard=1` | lecteur |
| GET | `/api/equipe-si` | lecteur |
| GET | `/api/historique` | lecteur |
| POST | `/api/imports` (multipart, champ `fichier`) | contributeur |
| GET/PUT | `/api/parametres` (objectifs nationaux) | lecteur / admin |
| POST/DELETE | `/api/membres/:id/districts`, `/api/affectations/:id` | admin |
| GET/POST | `/api/districts` | lecteur / admin |
| GET/POST/PUT | `/api/membres`, `/api/membres/:id/alias`, `/api/utilisateurs` | admin |

Événements Socket.IO : `import` (nouvel extrait), `equipe` (membres ou alias modifiés).

## Tests

```bash
cd server
DATABASE_URL=postgres://suivi:motdepasse@localhost:5432/suivi_test npm test
```

La base indiquée est **entièrement vidée** : son nom doit contenir « test ». Les tests vérifient,
sur l'extrait réel, les totaux (379 sites, 221 migrés ; 7,6 % de l'objectif national de 2 905),
les taux par région et district, la participation de l'équipe SI par district, les affectations,
les objectifs, les filtres, les droits et la notification temps réel.

## Pistes d'évolution

1. Alimentation automatique depuis l'application de la DAP (API ou copie de base) au lieu de
   l'import manuel.
2. Charger la liste officielle des 113 districts et 33 régions (et des 2 905 sites) pour
   suivre aussi les districts qui n'apparaissent pas encore dans l'extrait.
3. Comparaison détaillée entre deux imports (sites passés à « Terminé », sites bloqués).
4. Carte des sites (colonnes `latitude` et `longitude` de la table `site`).
5. Export Excel et PDF des synthèses.
