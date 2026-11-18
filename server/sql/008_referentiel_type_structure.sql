-- Type de structure du dépôt (ESPC, DS, HG, INHP, CAT, FSU, CHR…), colonne « Type de structure » de la liste
-- des dépôts exportée du tableau de bord mSupply. Pour information.
ALTER TABLE referentiel_depot ADD COLUMN type_structure TEXT NOT NULL DEFAULT '';
