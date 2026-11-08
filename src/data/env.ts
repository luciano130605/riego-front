/**
 * URL(s) del backend de `VITE_API_URL` (lista separada por coma). Sin ella la pantalla usa el simulador.
 * Vive acá para que App y Configuración lean lo mismo.
 */
export const API_URL: string | undefined = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || undefined;

/**
 * `VITE_SHOW_TEST=true` muestra el botón temporal "Probar dispositivo". Para sacarlo alcanza con quitar la variable
 * (o ponerla en otro valor): no hay que tocar código.
 */
export const SHOW_TEST: boolean = (import.meta.env.VITE_SHOW_TEST as string | undefined)?.trim() === 'true';
