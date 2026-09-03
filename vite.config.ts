/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mineruProxyPlugin } from './vite/mineru-proxy'
import { arkAgentPlanProxyPlugin } from './vite/ark-agent-plan-proxy'

export default defineConfig({
  plugins: [react(), mineruProxyPlugin(), arkAgentPlanProxyPlugin()],
  test: {
    globals: true,
    environment: 'jsdom',
  },
})
