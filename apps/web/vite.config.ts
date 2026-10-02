import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
    // Mentions de licence de toutes les bibliothèques embarquées (MIT, Apache-2.0…), publiées avec le site.
    license: { fileName: 'licences-tierces.txt' },
  },
})
