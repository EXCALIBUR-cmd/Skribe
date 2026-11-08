import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveEndpoints } from './src/config/endpoints.js'

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
    resolveEndpoints({ apiUrl: env.VITE_API_URL, socketUrl: env.VITE_SOCKET_URL, production: true })
  }
  return {
    plugins: [
      react(),
      tailwindcss()
    ],
  }
})
