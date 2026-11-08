import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Settings } from '@/core/types';
import { useRiegoApi } from '@/data/hooks';
import { useToast } from '@/ui/toastContext';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// Cuántos guardados hay en camino en toda la app: el encabezado y Configuración comparten el interruptor.
let pending = 0;
const listeners = new Set<() => void>();
const track = (delta: number) => {
  pending += delta;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** true mientras cualquier cambio de ajustes espera la confirmación de la API. */
export function useSettingsSaving(): boolean {
  return useSyncExternalStore(subscribe, () => pending > 0);
}

/**
 * Guarda ajustes por la API y cuenta qué pasó de verdad: si falla, se avisa
 * con el motivo en vez de mostrar el cambio como hecho.
 */
export function useSaveSettings() {
  const api = useRiegoApi();
  const toast = useToast();
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const save = useCallback(
    async (patch: Partial<Settings>, okMessage?: string): Promise<boolean> => {
      clearTimeout(timer.current);
      setState('saving');
      track(1);
      let result: Awaited<ReturnType<typeof api.updateSettings>>;
      try {
        result = await api.updateSettings(patch);
      } finally {
        track(-1);
      }
      if (result.ok) {
        setState('saved');
        if (okMessage) toast.show('success', okMessage);
        timer.current = setTimeout(() => setState('idle'), 2500);
      } else {
        setState('error');
        toast.show('error', `No se guardó el cambio. ${result.error}`);
      }
      return result.ok;
    },
    [api, toast],
  );

  return { save, state };
}
