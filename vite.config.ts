import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const configuredApiPort = Number(process.env.VEGES_API_PORT ?? 8787)
const apiPort = Number.isSafeInteger(configuredApiPort) && configuredApiPort > 0 && configuredApiPort <= 65_535
  ? configuredApiPort
  : 8787

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['.sealosgzg.site', '.igt.run'],
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
