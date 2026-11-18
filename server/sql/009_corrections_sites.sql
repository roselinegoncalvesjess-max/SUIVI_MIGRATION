-- Corrections manuelles de l'équipe LHSPLA sur des sites, qui l'emportent sur les fichiers :
--  MIGRE   : site migré vers Open mSupply (statut « Terminé » dans l'extrait ; compté migré s'il n'est pas dans l'extrait) ;
--  ANCIEN  : ancien site mSupply (version commerciale), donc PAS un nouveau site, même s'il figure dans la liste des nouveaux sites ;
--  NOUVEAU : nouveau site à déployer sur Open mSupply, même s'il figure dans la liste des dépôts du tableau de bord.
-- Un site est identifié par son nom et son district (noms officiels).
CREATE TYPE decision_site AS ENUM ('MIGRE', 'ANCIEN', 'NOUVEAU');

CREATE TABLE correction_site (
  id          SERIAL PRIMARY KEY,
  nom         TEXT NOT NULL,
  region      TEXT NOT NULL,
  district    TEXT NOT NULL,
  decision    decision_site NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  cree_par    INTEGER REFERENCES utilisateur(id) ON DELETE SET NULL,
  UNIQUE (district, nom)
);
