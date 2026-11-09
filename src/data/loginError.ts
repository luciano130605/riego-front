/** Mensajes de la pantalla de entrada. Salen de la respuesta del servidor; no se da por hecho nada. */

export const LOGIN_WRONG = 'PIN incorrecto.';
export const LOGIN_NETWORK = 'No se pudo conectar con el servidor.';

/** Retry-After en segundos (o fecha HTTP) → minutos enteros, mínimo 1. Sin dato válido: 1 minuto. */
export function retryMinutes(retryAfter: string | null | undefined, nowMs = Date.now()): number {
  if (!retryAfter) return 1;
  const secs = /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : (Date.parse(retryAfter) - nowMs) / 1000;
  return Number.isFinite(secs) && secs > 0 ? Math.max(1, Math.ceil(secs / 60)) : 1;
}

/** Texto del error de entrada según el estado HTTP. */
export function loginErrorText(status: number, retryAfter: string | null | undefined, serverMessage?: string): string {
  if (status === 401) return LOGIN_WRONG;
  if (status === 429) {
    const n = retryMinutes(retryAfter);
    return `Demasiados intentos, probá en ${n} ${n === 1 ? 'minuto' : 'minutos'}.`;
  }
  return serverMessage ?? `El servidor respondió ${status}.`;
}
