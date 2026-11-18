-- Deux nouvelles catégories de site : INHP (Institut national d'hygiène publique et ses antennes) et CMS (centres médico-sociaux).
ALTER TYPE categorie_site ADD VALUE IF NOT EXISTS 'CMS';
ALTER TYPE categorie_site ADD VALUE IF NOT EXISTS 'INHP';
