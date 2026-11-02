-- Schéma du suivi de la migration mSupply → Open mSupply (LHSPLA)
-- Chaque extrait importé est conservé : import_extrait + une « photo » de chaque site (suivi_site)
-- et de ses 9 étapes (suivi_etape).

CREATE TYPE statut_migration AS ENUM ('TERMINE', 'EN_COURS', 'NON_DEMARRE');
CREATE TYPE role_utilisateur AS ENUM ('lecteur', 'contributeur', 'admin');

CREATE TABLE utilisateur (
  id            SERIAL PRIMARY KEY,
  identifiant   TEXT NOT NULL UNIQUE,
  nom           TEXT NOT NULL DEFAULT '',
  mot_de_passe  TEXT NOT NULL,              -- empreinte bcrypt
  role          role_utilisateur NOT NULL DEFAULT 'lecteur',
  actif         BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE region (
  id    SERIAL PRIMARY KEY,
  nom   TEXT NOT NULL UNIQUE,
  code  TEXT NOT NULL DEFAULT ''            -- indicatif : les codes de l'extrait peuvent être réutilisés
);

-- Un district est identifié par son nom ET sa région : dans l'extrait du 02/11/2026,
-- DIST-011 et DIST-012 désignent chacun deux districts différents.
CREATE TABLE district (
  id         SERIAL PRIMARY KEY,
  nom        TEXT NOT NULL,
  region_id  INTEGER NOT NULL REFERENCES region(id),
  code       TEXT NOT NULL DEFAULT '',
  UNIQUE (nom, region_id)
);

CREATE TABLE site (
  id           SERIAL PRIMARY KEY,
  nom          TEXT NOT NULL UNIQUE,
  district_id  INTEGER NOT NULL REFERENCES district(id),
  latitude     NUMERIC(9,6),
  longitude    NUMERIC(9,6)
);

CREATE TABLE etape (
  ordre    SMALLINT PRIMARY KEY,
  libelle  TEXT NOT NULL
);

CREATE TABLE membre (
  id           SERIAL PRIMARY KEY,
  nom_complet  TEXT NOT NULL UNIQUE,
  equipe       TEXT NOT NULL DEFAULT 'SI',
  actif        BOOLEAN NOT NULL DEFAULT TRUE
);

-- Libellé sous lequel un membre apparaît dans la colonne « Responsable » de l'extrait
CREATE TABLE alias_membre (
  id         SERIAL PRIMARY KEY,
  membre_id  INTEGER NOT NULL REFERENCES membre(id) ON DELETE CASCADE,
  libelle    TEXT NOT NULL UNIQUE
);

CREATE TABLE mission (
  id           SERIAL PRIMARY KEY,
  membre_id    INTEGER NOT NULL REFERENCES membre(id) ON DELETE CASCADE,
  district_id  INTEGER NOT NULL REFERENCES district(id),
  vague        SMALLINT NOT NULL,
  date_debut   DATE NOT NULL,
  date_fin     DATE,
  notes        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE import_extrait (
  id               SERIAL PRIMARY KEY,
  nom_fichier      TEXT NOT NULL,
  genere_le        TIMESTAMPTZ,
  genere_par       TEXT NOT NULL DEFAULT '',
  importe_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  importe_par      INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  nb_sites         INTEGER NOT NULL DEFAULT 0,
  nb_termines      INTEGER NOT NULL DEFAULT 0,
  nb_en_cours      INTEGER NOT NULL DEFAULT 0,
  nb_non_demarres  INTEGER NOT NULL DEFAULT 0,
  avertissements   JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE suivi_site (
  id                   SERIAL PRIMARY KEY,
  import_id            INTEGER NOT NULL REFERENCES import_extrait(id) ON DELETE CASCADE,
  site_id              INTEGER NOT NULL REFERENCES site(id),
  vague                SMALLINT,
  responsable_libelle  TEXT NOT NULL DEFAULT '',
  responsable_id       INTEGER REFERENCES membre(id) ON DELETE SET NULL,
  version_msupply      TEXT NOT NULL DEFAULT '',
  date_prevue          DATE,
  debut_reel           DATE,
  fin_reelle           DATE,
  statut               statut_migration NOT NULL,
  avancement           SMALLINT NOT NULL DEFAULT 0,
  etape_en_cours       TEXT NOT NULL DEFAULT '',
  commentaires         TEXT NOT NULL DEFAULT '',
  difficultes          TEXT NOT NULL DEFAULT '',
  UNIQUE (import_id, site_id)
);
CREATE INDEX suivi_site_import_statut ON suivi_site (import_id, statut);

CREATE TABLE suivi_etape (
  suivi_id     INTEGER NOT NULL REFERENCES suivi_site(id) ON DELETE CASCADE,
  etape_ordre  SMALLINT NOT NULL REFERENCES etape(ordre),
  statut       statut_migration NOT NULL,
  PRIMARY KEY (suivi_id, etape_ordre)
);

INSERT INTO etape (ordre, libelle) VALUES
  (1, 'Planification'),
  (2, 'Préparation'),
  (3, 'Synchronisation complète (version commerciale)'),
  (4, 'Première synchronisation réussie (Open mSupply)'),
  (5, 'Import dans Open mSupply'),
  (6, 'Validation des données'),
  (7, 'Tests fonctionnels'),
  (8, 'Migration réussie'),
  (9, 'Clôture / stabilisation');

-- Vue pratique : le dernier import, site par site, avec région et district
CREATE VIEW v_dernier_suivi AS
SELECT s.*, si.nom AS site_nom, d.id AS district_id, d.nom AS district_nom,
       r.id AS region_id, r.nom AS region_nom
FROM suivi_site s
JOIN site si ON si.id = s.site_id
JOIN district d ON d.id = si.district_id
JOIN region r ON r.id = d.region_id
WHERE s.import_id = (SELECT id FROM import_extrait ORDER BY importe_le DESC, id DESC LIMIT 1);
