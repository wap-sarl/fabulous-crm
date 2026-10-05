import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const MAX_CHUNK_KB = 500;

/** The build fails when a file outgrows the limit: a heavy library pulled into the first load, or a page that no longer loads on demand, is seen in CI. */
const chunkLimit: Plugin = {
  name: 'crm:chunk-limit',
  apply: 'build',
  generateBundle(_options, bundle) {
    const over = Object.values(bundle)
      .filter((file) => file.type === 'chunk' && file.code.length > MAX_CHUNK_KB * 1000)
      .map(
        (file) =>
          `${file.fileName} (${Math.round((file as { code: string }).code.length / 1000)} kB)`,
      );
    if (over.length > 0) this.error(`Over ${MAX_CHUNK_KB} kB: ${over.join(', ')}`);
  },
};

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
  plugins: [react(), tailwindcss(), chunkLimit],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    rolldownOptions: {
      treeshake: {
        // The source acts only when called, so importing one name from an index file does not bring the rest; the three exceptions register themselves when imported.
        moduleSideEffects: [
          { test: /\.css$/, sideEffects: true },
          { test: /\/src\/(main\.tsx|lib\/countryInputs\/)/, sideEffects: true },
          { test: /\/(src|convex)\//, sideEffects: false },
        ],
      },
    },
  },
});
