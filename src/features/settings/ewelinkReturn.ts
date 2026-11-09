import { useSyncExternalStore } from 'react';
import type { EwelinkReturn } from '@/core/ewelink';

/** Lo que dijo eWeLink al volver (confirmación o error), hasta que se cierra el aviso. */
let current: EwelinkReturn | undefined;
const listeners = new Set<() => void>();

export function setEwelinkReturn(r: EwelinkReturn | undefined): void {
  current = r;
  listeners.forEach((l) => l());
}

export const getEwelinkReturn = (): EwelinkReturn | undefined => current;

export function useEwelinkReturn(): EwelinkReturn | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    getEwelinkReturn,
    () => undefined,
  );
}
