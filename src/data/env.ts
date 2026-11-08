/**
 * URL(s) del backend de `VITE_API_URL` (lista separada por coma). Sin ella la pantalla usa el simulador.
 * Vive acá para que App y Configuración lean lo mismo.
 */
export const API_URL: string | undefined = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || undefined;
