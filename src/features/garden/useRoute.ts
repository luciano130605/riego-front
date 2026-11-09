import { useSyncExternalStore } from 'react';
import { parseRoute, type Route } from '@/core/route';

const subscribe = (l: () => void) => {
  window.addEventListener('hashchange', l);
  return () => window.removeEventListener('hashchange', l);
};

const getHash = () => window.location.hash;

/** La ruta de la pantalla (vista general o detalle de una planta), según el hash de la dirección. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  return parseRoute(hash);
}

export function goTo(href: string): void {
  window.location.hash = href;
}
