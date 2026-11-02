import jwt from 'jsonwebtoken';

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET doit être défini en production.');
  return s || 'dev-uniquement-a-changer';
};
const NIVEAUX = { lecteur: 1, contributeur: 2, admin: 3 };

export const signer = (u) => jwt.sign({ id: u.id, nom: u.nom || u.identifiant, role: u.role }, SECRET(), { expiresIn: '12h' });
export const verifier = (jeton) => jwt.verify(jeton, SECRET());

/** Exige un utilisateur connecté (jeton « Authorization: Bearer … »). */
export function connecte(req, res, next) {
  const h = req.headers.authorization || '';
  const jeton = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!jeton) return res.status(401).json({ erreur: 'Connexion requise.' });
  try {
    req.utilisateur = verifier(jeton);
    next();
  } catch {
    res.status(401).json({ erreur: 'Session expirée : reconnectez-vous.' });
  }
}

/** Exige au moins le rôle indiqué (lecteur < contributeur < admin). */
export const role = (minimum) => (req, res, next) =>
  (NIVEAUX[req.utilisateur?.role] || 0) >= NIVEAUX[minimum]
    ? next()
    : res.status(403).json({ erreur: 'Vous n\'avez pas les droits pour cette action.' });
