import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development, API calls go to the back end on port 3000, so the back end needs no changes.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.js'] },
});
