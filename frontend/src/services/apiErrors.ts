// --- FILE: frontend/src/services/apiErrors.ts ---

/**
 * Текст ошибки из ответа API. detail бывает строкой (HTTPException) или списком ошибок
 * валидации Pydantic — его без разбора React показал бы как «[object Object]».
 */
export function formatErrorDetail(detail: unknown, fallback: string): string {
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
        const messages = detail
            .map((item) => (item && typeof item === 'object' ? String((item as {msg?: unknown}).msg ?? '') : ''))
            .map((msg) => msg.replace(/^Value error, /, ''))
            .filter(Boolean);
        if (messages.length) return messages.join('; ');
    }
    return fallback;
}

export async function readErrorDetail(res: Response, fallback: string): Promise<string> {
    try {
        const data = await res.json();
        return formatErrorDetail(data?.detail, fallback);
    } catch {
        return fallback;
    }
}
