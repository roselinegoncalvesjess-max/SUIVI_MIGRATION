import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, Vite renvoie /api et /socket.io vers le serveur Node.js (port 4000).
const API = process.env.API_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { graphiques: ['recharts'] } } } },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
});
