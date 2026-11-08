import { useContext, useEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import { deviceView, type DeviceView } from '@/core/deviceView';
import type { Snapshot } from '@/core/types';
import type { LabApi, RiegoApi } from './api';
import { RiegoContext } from './context';
import { derive, type Derived } from './derive';

function useRiegoContext() {
  const ctx = useContext(RiegoContext);
  if (!ctx) throw new Error('Falta <RiegoProvider> arriba en el árbol.');
  return ctx;
}

export function useRiegoApi(): RiegoApi {
  return useRiegoContext().api;
}

/** Controles del simulador. Es undefined cuando los datos son reales. */
export function useLab(): LabApi | undefined {
  return useRiegoContext().lab;
}

export function useSnapshot(): Snapshot {
  const api = useRiegoApi();
  return useSyncExternalStore(api.subscribe, api.getSnapshot, api.getSnapshot);
}

/** 'aviso' si el servidor todavía no tiene regador conectado (solo avisa); 'real' si riega. */
export function useRelayMode(): 'aviso' | 'real' {
  return useSnapshot().device.relay === 'aviso' ? 'aviso' : 'real';
}

export function useDerived(): Derived {
  const snapshot = useSnapshot();
  return useMemo(() => derive(snapshot), [snapshot]);
}

/**
 * Hora actual del sistema, refrescada cada `intervalMs`. Para cuentas regresivas
 * y animaciones; lo que depende de las lecturas sale de useSnapshot.
 */
export function useNow(intervalMs = 1000): number {
  const api = useRiegoApi();
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return api.now();
}

/** Cada cuánto se refrescan los "hace X min" de la placa, sin volver a pedir datos al servidor. */
export const AGO_REFRESH_MS = 30_000;

/**
 * Lo que muestran el panel de la placa, la tarjeta de humedad y el chip: el estado tal cual lo informa el backend más la
 * hora actual, que se actualiza sola cada 30 s para que los "hace X min" no queden congelados entre un pedido y otro.
 */
export function useDeviceView(): DeviceView & { now: number } {
  const snapshot = useSnapshot();
  const now = useNow(AGO_REFRESH_MS);
  return useMemo(() => ({ ...deviceView(snapshot, now), now }), [snapshot, now]);
}

