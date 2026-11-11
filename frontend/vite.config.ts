// --- FILE: frontend/vite.config.ts ---

/// <reference types="vitest/config" />

import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        host: '127.0.0.1',
        port: 3000,
        strictPort: true,
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
    },
})