import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built site works from any path (GitHub Pages, Vercel, a local file server)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { rollupOptions: { input: ['index.html', 'admin.html', 'wallet.html', 'settings.html'] }, target: 'es2020', chunkSizeWarningLimit: 1200 },
})
