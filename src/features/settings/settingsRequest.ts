import { useEffect } from 'react';
import type { TabId } from './SettingsDialog';

/**
 * Un pedido para abrir Configuración en una pestaña (y, si hace falta, en una sección). Queda guardado hasta que lo toma
 * la pantalla que tiene el diálogo, así no se pierde si todavía estaba cargando.
 */
export type SettingsRequest = { tab: TabId; anchor?: string };

let pending: SettingsRequest | undefined;
let anchor: string | undefined;
const listeners = new Set<() => void>();

export function requestSettings(r: SettingsRequest): void {
  pending = r;
  anchor = r.anchor;
  listeners.forEach((l) => l());
}

/** Para tests: toma el pedido pendiente (y lo borra). */
export function takePending(): SettingsRequest | undefined {
  const r = pending;
  pending = undefined;
  return r;
}

/** La sección a la que hay que bajar. La toma quien la dibuja, una sola vez. */
export function takeAnchor(): string | undefined {
  const a = anchor;
  anchor = undefined;
  return a;
}

/** Quien tiene el diálogo de Configuración escucha los pedidos: `open` abre la pestaña pedida. */
export function useSettingsRequest(open: (tab: TabId) => void): void {
  useEffect(() => {
    const run = () => {
      const r = takePending();
      if (r) open(r.tab);
    };
    run();
    listeners.add(run);
    return () => void listeners.delete(run);
  }, [open]);
}
