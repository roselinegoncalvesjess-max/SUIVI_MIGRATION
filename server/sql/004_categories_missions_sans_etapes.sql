-- 03/11/2026 :
--  * les étapes de migration ne sont plus suivies : un site est migré quand son statut est « Terminé » ;
--  * la date de fin réelle est la DATE DE MIGRATION du site ;
--  * catégorie de site (ESPC, district sanitaire, hôpital de référence) ;
--  * période de migration = date de début et date de fin de la mission.

DROP VIEW IF EXISTS v_dernier_suivi;
DROP TABLE IF EXISTS suivi_etape;
DROP TABLE IF EXISTS etape;
ALTER TABLE suivi_site DROP COLUMN IF EXISTS etape_en_cours, DROP COLUMN IF EXISTS avancement;

CREATE TYPE categorie_site AS ENUM ('ESPC', 'DISTRICT_SANITAIRE', 'HOPITAL_REFERENCE', 'A_CLASSER');
ALTER TABLE suivi_site
  ADD COLUMN categorie categorie_site NOT NULL DEFAULT 'A_CLASSER',
  ADD COLUMN debut_mission DATE,
  ADD COLUMN fin_mission DATE;
COMMENT ON COLUMN suivi_site.fin_reelle IS 'Date de migration du site (date de fin réelle)';
COMMENT ON COLUMN suivi_site.debut_mission IS 'Début de la mission de migration (colonne Excel facultative)';
COMMENT ON COLUMN suivi_site.fin_mission IS 'Fin de la mission de migration (colonne Excel facultative)';

-- Dates de mission saisies pour l'affectation d'un membre à un district (facultatives)
ALTER TABLE affectation_district ADD COLUMN debut_mission DATE, ADD COLUMN fin_mission DATE;

CREATE VIEW v_dernier_suivi AS
SELECT s.*, s.fin_reelle AS date_migration, si.nom AS site_nom, d.id AS district_id, d.nom AS district_nom,
       r.id AS region_id, r.nom AS region_nom
FROM suivi_site s
JOIN site si ON si.id = s.site_id
JOIN district d ON d.id = si.district_id
JOIN region r ON r.id = d.region_id
WHERE s.import_id = (SELECT id FROM import_extrait ORDER BY importe_le DESC, id DESC LIMIT 1);
