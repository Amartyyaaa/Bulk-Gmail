import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Email rendering is shared with the Edge Functions so previews match sends.
    alias: { '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
