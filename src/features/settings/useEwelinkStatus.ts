import { useCallback, useEffect, useRef, useState } from 'react';
import type { EwelinkStatus } from '@/core/types';
import { useRiegoApi } from '@/data/hooks';

export type EwelinkState =
  | { phase: 'loading' }
  | { phase: 'ready'; status: EwelinkStatus }
  | { phase: 'error'; error: string }
  /** El servidor no tiene la ruta (backend viejo): no hay nada que mostrar. */
  | { phase: 'unavailable' };

/** El estado del vínculo con eWeLink: se pide al abrir y se puede refrescar. */
export function useEwelinkStatus() {
  const api = useRiegoApi();
  const [state, setState] = useState<EwelinkState>({ phase: 'loading' });
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    setState((s) => (s.phase === 'ready' ? s : { phase: 'loading' }));
    let next: EwelinkState;
    try {
      const res = await api.ewelinkStatus();
      next = res.ok ? { phase: 'ready', status: res.status } : res.unavailable ? { phase: 'unavailable' } : { phase: 'error', error: res.error };
    } catch {
      next = { phase: 'error', error: 'No se pudo conectar con el servidor.' };
    }
    if (alive.current) setState(next);
  }, [api]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  return { state, refresh };
}
