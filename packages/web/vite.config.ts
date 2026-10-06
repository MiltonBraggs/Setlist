import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the UI runs on Vite (5173) and talks to the server on SETLIST_SERVER (default :3000).
const server = process.env.SETLIST_SERVER ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
      '/api': server,
      '/lyrics-images': server,
    },
  },
});
