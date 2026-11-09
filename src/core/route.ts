/**
 * Rutas de la pantalla. Van en el hash (`#/planta/<id>`), así cada planta tiene su dirección, anda el botón "atrás" y no
 * hace falta que el servidor sepa nada de ellas.
 */
export type Route = { name: 'home' } | { name: 'plant'; id: string };

export const HOME_HREF = '#/';

export function plantHref(id: string): string {
  return `#/planta/${encodeURIComponent(id)}`;
}

export function parseRoute(hash: string): Route {
  const m = /^#\/planta\/([^/?#]+)\/?$/.exec(hash);
  if (!m) return { name: 'home' };
  try {
    return { name: 'plant', id: decodeURIComponent(m[1]) };
  } catch {
    return { name: 'home' }; // un id mal escrito en la dirección
  }
}
