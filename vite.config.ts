import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    // Current bundle: 354 kB main, well under 500 kB warning threshold.
    // No manual chunk splits yet — Vite's default heuristic is fine for
    // a single-page app of this size; revisit if we add a heavy vendor
    // lib (e.g. charting_library).
    chunkSizeWarningLimit: 500,
  },
});
