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
        // storage.ts — первым: на Node 25+ подменяет собственный localStorage Node хранилищем jsdom.
        setupFiles: ['./src/test/storage.ts', './src/test/setup.ts'],
        // npm run test:coverage (в CI): покрытие считается по всему src/, а не только по файлам,
        // которые импортируют тесты, — иначе непокрытые компоненты не попали бы в отчёт вовсе.
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/__tests__/**', 'src/test/**', 'src/main.tsx', 'src/**/*.d.ts'],
            reporter: ['text-summary', 'text'],
            thresholds: {
                // Таск 17.6 (15.11.2026): покрытие 94/85/84/94 — пороги с запасом в 2–3 пункта, чтобы не сползало.
                statements: 92,
                branches: 82,
                functions: 80,
                lines: 92,
            },
        },
    },
})