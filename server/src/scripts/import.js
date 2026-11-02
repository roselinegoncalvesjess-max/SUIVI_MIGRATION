// Import en ligne de commande (utilisable dans une tâche planifiée) :
//   node src/scripts/import.js chemin/vers/extrait.xlsx
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';
import { ErreurImport, importerExtrait } from '../services/importer.js';
import { migrer } from './migrate.js';

const fichier = process.argv[2];
if (!fichier) {
  console.error('Usage : npm run import -- chemin/vers/extrait.xlsx');
  process.exit(1);
}
try {
  await migrer({ silencieux: true });
  const { import: imp, avertissements } = await importerExtrait(await readFile(fichier), path.basename(fichier));
  const taux = imp.nb_sites ? Math.round((1000 * imp.nb_termines) / imp.nb_sites) / 10 : 0;
  console.log(`Import n°${imp.id} : ${imp.nb_sites} sites — ${imp.nb_termines} migrés (${taux} %), ${imp.nb_en_cours} en cours, ${imp.nb_non_demarres} non démarrés.`);
  avertissements.forEach((a) => console.log(`  ! ${a}`));
} catch (e) {
  console.error(e instanceof ErreurImport ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
