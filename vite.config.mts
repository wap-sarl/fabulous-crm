import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@crm': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 4202,
    host: '0.0.0.0',
    allowedHosts: ['localhost', '.local', 'crm.local'],
  },
  preview: {
    port: 4202,
    host: '0.0.0.0',
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    reportCompressedSize: true,
  },
});
