import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { connecte, signer } from '../middleware/auth.js';

const r = Router();

r.post('/connexion', (req, res, next) => connexion(req, res).catch(next));

async function connexion(req, res) {
  const { identifiant, motDePasse } = req.body || {};
  if (!identifiant || !motDePasse) return res.status(400).json({ erreur: 'Identifiant et mot de passe requis.' });
  const { rows: [u] } = await query('SELECT * FROM utilisateur WHERE identifiant = $1 AND actif', [identifiant]);
  if (!u || !(await bcrypt.compare(motDePasse, u.mot_de_passe))) {
    return res.status(401).json({ erreur: 'Identifiant ou mot de passe incorrect.' });
  }
  res.json({ jeton: signer(u), utilisateur: { id: u.id, nom: u.nom || u.identifiant, role: u.role } });
}

r.get('/moi', connecte, (req, res) => res.json({ utilisateur: req.utilisateur }));

export default r;
