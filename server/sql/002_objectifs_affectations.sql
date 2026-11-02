-- Objectifs nationaux et affectation des membres de l'équipe SI à des districts.

-- Paramètres modifiables par un administrateur
CREATE TABLE parametre (
  cle     TEXT PRIMARY KEY,
  valeur  INTEGER NOT NULL CHECK (valeur > 0),
  libelle TEXT NOT NULL
);
INSERT INTO parametre (cle, valeur, libelle) VALUES
  ('objectif_sites',     2905, 'Nombre total de sites à migrer en Côte d''Ivoire'),
  ('objectif_districts',  113, 'Nombre de districts sanitaires en Côte d''Ivoire'),
  ('objectif_regions',     33, 'Nombre de régions sanitaires en Côte d''Ivoire');

-- Un membre est responsable de la migration de TOUS les sites d'un district.
-- Les districts d'un membre = ses affectations + les districts où il est inscrit
-- comme « Responsable » d'au moins un site dans le dernier extrait.
CREATE TABLE affectation_district (
  id           SERIAL PRIMARY KEY,
  membre_id    INTEGER NOT NULL REFERENCES membre(id) ON DELETE CASCADE,
  district_id  INTEGER NOT NULL REFERENCES district(id) ON DELETE CASCADE,
  vague        SMALLINT,
  UNIQUE (membre_id, district_id)
);
