import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTIF } from '@/core/copy';
import { type ActionResult, type PushKind, type PushPrefs, type PushTestResult } from '@/data/api';
import { useRiegoApi } from '@/data/hooks';
import { pushSupport, urlBase64ToUint8Array, type PushSupport } from '@/lib/push';

type Permission = NotificationPermission | 'unsupported';

export type PushState = {
  support: PushSupport;
  permission: Permission;
  subscribed: boolean;
  endpoint: string | undefined;
  prefs: PushPrefs | undefined;
  /** Hay una operación en curso (activar, desactivar o reconciliar con el servidor). */
  loading: boolean;
};

const readPermission = (): Permission => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Suscripción de ESTE dispositivo a las notificaciones push: permiso del navegador, suscripción en el
 * navegador y registro en el servidor (que es quien manda los avisos).
 */
export function usePushSubscription() {
  const api = useRiegoApi();
  const support = pushSupport();
  const [state, setState] = useState<PushState>({
    support,
    permission: readPermission(),
    subscribed: false,
    endpoint: undefined,
    prefs: undefined,
    loading: support === 'ok',
  });
  const endpointRef = useRef<string | undefined>(undefined);

  const patch = useCallback((p: Partial<PushState>) => setState((s) => ({ ...s, ...p })), []);

  // Al abrir: si el navegador ya tiene una suscripción, se la vuelve a registrar para traer las preferencias.
  useEffect(() => {
    if (support !== 'ok') return;
    let stopped = false;
    void (async () => {
      try {
        const sub = await currentSubscription();
        if (stopped) return;
        if (!sub) {
          patch({ loading: false, permission: readPermission() });
          return;
        }
        endpointRef.current = sub.endpoint;
        const res = await api.pushSubscribe(sub.toJSON(), navigator.userAgent);
        if (stopped) return;
        patch({
          loading: false,
          permission: readPermission(),
          subscribed: true,
          endpoint: sub.endpoint,
          prefs: res.ok ? res.prefs : undefined,
        });
      } catch {
        if (!stopped) patch({ loading: false });
      }
    })();
    return () => {
      stopped = true;
    };
  }, [api, support, patch]);

  const enable = useCallback(async (): Promise<ActionResult> => {
    if (support !== 'ok') return { ok: false, error: NOTIF.unsupported };
    patch({ loading: true });
    try {
      // El permiso se pide primero: tiene que ser justo después del clic del usuario.
      const permission = await Notification.requestPermission();
      patch({ permission });
      if (permission !== 'granted') {
        patch({ loading: false });
        return { ok: false, error: permission === 'denied' ? NOTIF.blocked : NOTIF.denied };
      }
      const key = await api.pushPublicKey();
      if (!key.ok) {
        patch({ loading: false });
        return key;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key.publicKey),
        }));
      const res = await api.pushSubscribe(sub.toJSON(), navigator.userAgent);
      if (!res.ok) {
        // Que no quede suscripto el navegador si el servidor no lo registró.
        await sub.unsubscribe().catch(() => false);
        patch({ loading: false });
        return res;
      }
      endpointRef.current = sub.endpoint;
      patch({ loading: false, subscribed: true, endpoint: sub.endpoint, prefs: res.prefs });
      return { ok: true };
    } catch (err) {
      patch({ loading: false });
      return { ok: false, error: err instanceof Error && err.message ? err.message : NOTIF.unsupported };
    }
  }, [api, support, patch]);

  const disable = useCallback(async (): Promise<ActionResult> => {
    patch({ loading: true });
    try {
      const sub = await currentSubscription();
      const endpoint = sub?.endpoint ?? endpointRef.current;
      if (endpoint) {
        const res = await api.pushUnsubscribe(endpoint);
        if (!res.ok) {
          patch({ loading: false });
          return res;
        }
      }
      await sub?.unsubscribe().catch(() => false);
      endpointRef.current = undefined;
      patch({ loading: false, subscribed: false, endpoint: undefined, prefs: undefined });
      return { ok: true };
    } catch {
      patch({ loading: false });
      return { ok: false, error: NOTIF.unsupported };
    }
  }, [api, patch]);

  /** Cambia un tipo de aviso. Se ve al instante y, si el servidor no lo acepta, vuelve atrás. */
  const setPref = useCallback(
    async (kind: PushKind, on: boolean): Promise<ActionResult> => {
      const endpoint = endpointRef.current;
      if (!endpoint) return { ok: false, error: NOTIF.off };
      setState((s) => (s.prefs ? { ...s, prefs: { ...s.prefs, [kind]: on } } : s));
      const res = await api.pushPreferences(endpoint, { [kind]: on });
      setState((s) => ({ ...s, prefs: res.ok ? res.prefs : s.prefs ? { ...s.prefs, [kind]: !on } : s.prefs }));
      return res.ok ? { ok: true } : res;
    },
    [api],
  );

  const test = useCallback(
    async (kind?: PushKind): Promise<PushTestResult> => {
      const endpoint = endpointRef.current;
      if (!endpoint) return { ok: false, error: NOTIF.off };
      return kind ? api.pushTest(endpoint, kind) : api.pushTest(endpoint);
    },
    [api],
  );

  return { ...state, enable, disable, setPref, test };
}
