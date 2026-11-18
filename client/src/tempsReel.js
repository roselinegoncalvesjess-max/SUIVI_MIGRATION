import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { jeton } from './api.js';

/**
 * Connexion temps réel (Socket.IO). Appelle `surEvenement(nom)` à chaque import
 * ou changement de l'équipe, et indique si la connexion est active.
 */
export function useTempsReel(surEvenement) {
  const [connecte, setConnecte] = useState(false);
  const rappel = useRef(surEvenement);
  rappel.current = surEvenement;

  useEffect(() => {
    const socket = io({ path: '/socket.io', auth: { jeton: jeton.lire() } });
    socket.on('connect', () => setConnecte(true));
    socket.on('disconnect', () => setConnecte(false));
    socket.on('connect_error', () => setConnecte(false));
    socket.on('import', () => rappel.current?.('import'));
    socket.on('equipe', () => rappel.current?.('equipe'));
    socket.on('referentiel', () => rappel.current?.('referentiel'));
    socket.on('nouveaux', () => rappel.current?.('nouveaux'));
    socket.on('corrections', () => rappel.current?.('corrections'));
    return () => socket.disconnect();
  }, []);
  return connecte;
}
