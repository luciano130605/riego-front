import { useSyncExternalStore } from 'react';

/** Qué sector está elegido en los chips ('all' = todos). Se recuerda en este navegador y lo comparten la vista general y el swipe. */

const KEY = 'riego-aut:sector';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readChip(store: Store | null = defaultStore()): string {
  try {
    return store?.getItem(KEY) || 'all';
  } catch {
    return 'all';
  }
}

export function writeChip(id: string, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(KEY, id);
  } catch {
    // Sin almacenamiento: se recuerda mientras dure la pestaña.
  }
}

/** El chip elegido, si todavía existe ese sector; si no (se borró), 'all'. */
export function resolveChip(chip: string, sectorIds: readonly string[]): string {
  return chip === 'all' || sectorIds.includes(chip) ? chip : 'all';
}

let current = readChip();
const listeners = new Set<() => void>();

export function setChip(id: string): void {
  if (id === current) return;
  current = id;
  writeChip(id);
  listeners.forEach((l) => l());
}

export function useChip(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => current,
    () => 'all',
  );
}
