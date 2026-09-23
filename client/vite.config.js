/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Vite validates the Host header against this list (DNS-rebinding protection); `true` disabled
    // it entirely. pill.1044nma.com is the Cloudflare Tunnel / NPM hostname this dev stack is
    // currently proxied through for testing — add any other host you proxy this dev server through.
    allowedHosts: ['localhost', '127.0.0.1', 'pill.1044nma.com'],
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api': {
        // Override to run the dev server on the host against another backend (e.g. the test stack).
        target: process.env.API_TARGET || 'http://backend:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
