-- Liste permanente des NOUVEAUX sites : établissements sans version commerciale mSupply, à déployer
-- directement sur Open mSupply. Elle vient d'un fichier propre (indépendant des extraits de la DAP) et
-- s'ajoute à chaque extrait ; un site déjà déclaré « Nouveau site » dans l'extrait n'est pas compté deux fois.
-- Une seule liste est conservée : un nouveau fichier remplace le précédent.
-- Les noms de région et de district sont les noms OFFICIELS (carte des districts sanitaires).

CREATE TABLE nouveau_site_import (
  id               SERIAL PRIMARY KEY,
  nom_fichier      TEXT NOT NULL,
  importe_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  importe_par      INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  nb_sites         INTEGER NOT NULL DEFAULT 0,
  avertissements   JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE nouveau_site (
  id           SERIAL PRIMARY KEY,
  import_id    INTEGER NOT NULL REFERENCES nouveau_site_import(id) ON DELETE CASCADE,
  nom          TEXT NOT NULL,
  region       TEXT NOT NULL,
  district     TEXT NOT NULL,
  raison       TEXT NOT NULL DEFAULT '',   -- pourquoi c'est un nouveau site (ex. « ouvert après le déploiement »)
  equipement   TEXT NOT NULL DEFAULT ''    -- MOBILE ou DESKTOP, pour information
);
CREATE INDEX nouveau_site_zone ON nouveau_site (region, district);
