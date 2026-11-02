import http from 'node:http';
import { Server } from 'socket.io';
import { creerApp } from './app.js';
import { verifier } from './middleware/auth.js';
import { migrer } from './scripts/migrate.js';

const port = Number(process.env.PORT || 4000);

await migrer();

let io;
const app = creerApp({ notifier: (evenement, donnees) => io?.emit(evenement, donnees) });
const serveur = http.createServer(app);

// Temps réel : seuls les utilisateurs connectés reçoivent les notifications.
io = new Server(serveur, { path: '/socket.io' });
io.use((socket, next) => {
  try {
    socket.data.utilisateur = verifier(socket.handshake.auth?.jeton);
    next();
  } catch {
    next(new Error('non autorisé'));
  }
});

serveur.listen(port, () => console.log(`API du suivi de migration sur http://localhost:${port}`));
