import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': process.env['VITE_API_PROXY_TARGET'] ?? 'http://127.0.0.1:8000',
    },
    // Polling avoids inotify EMFILE failures on machines with many watchers.
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test/setup.ts',
    pool: 'threads',
  },
})
