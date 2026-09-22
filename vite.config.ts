/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mineruProxyPlugin } from './vite/mineru-proxy'

export default defineConfig({
  plugins: [react(), mineruProxyPlugin()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'vite/**/*.test.ts'],
    globals: true,
    environment: 'jsdom',
  },
})
