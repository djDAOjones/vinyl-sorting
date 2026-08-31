import { defineConfig } from 'vite';

/**
 * The Worker serves /api; Vite serves the shell. In development the
 * proxy points at `wrangler dev` so the two behave as they will in
 * production, where Pages and the Worker share an origin.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Three screens: capture at /, the review queue at /review.html and
    // the collection at /browse.html. Cloudflare Pages drops the .html,
    // so those are /review and /browse in production.
    rollupOptions: {
      input: { capture: 'index.html', review: 'review.html', browse: 'browse.html' },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
});
