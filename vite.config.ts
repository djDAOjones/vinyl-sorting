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
    // Five screens. The hub is at / and CAPTURE MOVED to /capture.html
    // (APP-HOME-HUB) — the manifest's start_url moved with it, so a
    // phone with the app installed still opens the camera rather than a
    // menu. Cloudflare drops the .html in production; Vite's dev server
    // does not, so links are written the long way.
    rollupOptions: {
      input: {
        home: 'index.html',
        capture: 'capture.html',
        review: 'review.html',
        browse: 'browse.html',
        settings: 'settings.html',
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
});
