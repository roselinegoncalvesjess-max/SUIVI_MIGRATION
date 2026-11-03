-- Nouveaux sites : sites déployés directement sur Open mSupply (sans version commerciale à migrer).
-- Ils sont identifiés par la colonne « Type de site » du fichier Excel (« Migration » ou « Nouveau site »)
-- et comptés à part : le taux de migration national reste calculé sur les 2 905 sites à migrer.

CREATE TYPE type_site AS ENUM ('MIGRATION', 'NOUVEAU');

-- Une étape peut ne pas s'appliquer (ex. étape 3 « Synchronisation complète (version commerciale) »
-- pour un nouveau site).
ALTER TYPE statut_migration ADD VALUE IF NOT EXISTS 'NON_APPLICABLE';

ALTER TABLE suivi_site ADD COLUMN type_site type_site NOT NULL DEFAULT 'MIGRATION';
CREATE INDEX suivi_site_import_type ON suivi_site (import_id, type_site);

ALTER TABLE import_extrait
  ADD COLUMN nb_nouveaux INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN nb_nouveaux_deployes INTEGER NOT NULL DEFAULT 0;

-- 0 = objectif pas encore défini
ALTER TABLE parametre DROP CONSTRAINT IF EXISTS parametre_valeur_check;
ALTER TABLE parametre ADD CONSTRAINT parametre_valeur_check CHECK (valeur >= 0);
INSERT INTO parametre (cle, valeur, libelle) VALUES
  ('objectif_nouveaux_sites', 0, 'Nombre de nouveaux sites à déployer directement sur Open mSupply (0 = non défini)')
ON CONFLICT (cle) DO NOTHING;

-- La vue reprend la nouvelle colonne
DROP VIEW IF EXISTS v_dernier_suivi;
CREATE VIEW v_dernier_suivi AS
SELECT s.*, si.nom AS site_nom, d.id AS district_id, d.nom AS district_nom,
       r.id AS region_id, r.nom AS region_nom
FROM suivi_site s
JOIN site si ON si.id = s.site_id
JOIN district d ON d.id = si.district_id
JOIN region r ON r.id = d.region_id
WHERE s.import_id = (SELECT id FROM import_extrait ORDER BY importe_le DESC, id DESC LIMIT 1);
