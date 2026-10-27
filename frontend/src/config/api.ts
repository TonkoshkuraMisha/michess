// --- FILE: frontend/src/config/api.ts ---

export const API_BASE_URL: string =
    import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export const WS_BASE_URL: string =
    import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8000';