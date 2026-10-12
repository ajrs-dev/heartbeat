import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs on :3001; the proxy keeps the browser same-origin so the
    // session cookie and the EventSource connection work exactly as they do in production.
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
