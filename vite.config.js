import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3849,
    host: true,
    allowedHosts: ["quiz.liforra.de"],
    // Groq calls go through server/index.js (the API key lives there, never in the client).
    // If this ever moves to a static `vite build` + separate static host, this proxy needs
    // to become a reverse-proxy rule at the hosting layer instead.
    proxy: {
      '/api': 'http://localhost:8787',
    },
    // The Prüfungen/ symlink points outside the project root to a large
    // reference archive — not app source, and it crashes chokidar's watcher
    // (ELOOP) if left in scope.
    watch: {
      ignored: ['**/Prüfungen/**'],
    },
  }
})
