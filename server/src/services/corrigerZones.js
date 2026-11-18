/**
 * Ramène les régions et districts de la BASE à la géographie officielle (officiel.js) : un district est dans la
 * région que fixe son NOM (YOPOUGON-EST est dans ABIDJAN 1, même si un ancien extrait l'avait mis ailleurs).
 *  - un district rangé dans une mauvaise région est déplacé dans la bonne ;
 *  - s'il existe déjà dans la bonne région, les deux lignes sont fusionnées (sites, missions et affectations suivent) ;
 *  - une région à graphie différente (« ME ») est renommée (« LA ME ») ; une région sans district est supprimée.
 * À appeler dans une transaction (`c` = client pg).
 */
import { districtOfficiel, regionOfficielle } from './officiel.js';

export async function corrigerZones(c) {
  const bilan = { deplaces: 0, fusionnes: 0, regionsSupprimees: 0 };
  const { rows: districts } = await c.query('SELECT d.id, d.nom, r.nom AS region FROM district d JOIN region r ON r.id = d.region_id ORDER BY d.id');
  for (const d of districts) {
    const off = districtOfficiel(d.nom);
    if (!off || (off.district === d.nom && off.region === d.region)) continue;

    // Région officielle : celle qui existe, sinon une région à graphie différente (renommée), sinon une nouvelle
    let { rows: [reg] } = await c.query('SELECT id FROM region WHERE nom = $1', [off.region]);
    if (!reg) {
      const { rows: toutes } = await c.query('SELECT id, nom FROM region');
      const variante = toutes.find((x) => regionOfficielle(x.nom) === off.region);
      if (variante) {
        await c.query('UPDATE region SET nom = $2 WHERE id = $1', [variante.id, off.region]);
        reg = { id: variante.id };
      } else {
        ({ rows: [reg] } = await c.query('INSERT INTO region (nom) VALUES ($1) RETURNING id', [off.region]));
      }
    }

    const { rows: [cible] } = await c.query('SELECT id FROM district WHERE nom = $1 AND region_id = $2', [off.district, reg.id]);
    if (!cible || cible.id === d.id) {
      await c.query('UPDATE district SET nom = $2, region_id = $3 WHERE id = $1', [d.id, off.district, reg.id]);
      bilan.deplaces++;
    } else {
      await c.query('UPDATE site SET district_id = $2 WHERE district_id = $1', [d.id, cible.id]);
      await c.query('UPDATE mission SET district_id = $2 WHERE district_id = $1', [d.id, cible.id]);
      await c.query(
        `UPDATE affectation_district a SET district_id = $2 WHERE a.district_id = $1
           AND NOT EXISTS (SELECT 1 FROM affectation_district b WHERE b.membre_id = a.membre_id AND b.district_id = $2)`, [d.id, cible.id]);
      await c.query('DELETE FROM district WHERE id = $1', [d.id]); // supprime aussi les affectations restantes (doublons)
      bilan.fusionnes++;
    }
  }
  const { rowCount } = await c.query('DELETE FROM region r WHERE NOT EXISTS (SELECT 1 FROM district d WHERE d.region_id = r.id)');
  bilan.regionsSupprimees = rowCount;
  return bilan;
}
