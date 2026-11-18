-- Référentiel des dépôts déployés sur mSupply (version commerciale) : liste officielle par district et région.
-- Il donne le nombre réel de sites à migrer par district et par région (dénominateur des taux de migration).
-- Un seul référentiel est conservé : un nouveau fichier remplace le précédent.
-- Les noms de région et de district sont les noms OFFICIELS (carte des districts sanitaires), pas ceux du fichier.

CREATE TABLE referentiel_import (
  id               SERIAL PRIMARY KEY,
  nom_fichier      TEXT NOT NULL,
  importe_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  importe_par      INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  nb_depots        INTEGER NOT NULL DEFAULT 0,
  avertissements   JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE referentiel_depot (
  id             SERIAL PRIMARY KEY,
  import_id      INTEGER NOT NULL REFERENCES referentiel_import(id) ON DELETE CASCADE,
  nom            TEXT NOT NULL,
  categorie      TEXT NOT NULL DEFAULT '',   -- catégorie du fichier (ESPC/PPS, Clients Directs…), pour information
  region         TEXT NOT NULL,
  district       TEXT NOT NULL
);
CREATE INDEX referentiel_depot_zone ON referentiel_depot (region, district);
