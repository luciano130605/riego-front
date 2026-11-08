/** Utilidades de las notificaciones push del navegador (Web Push + VAPID). */

/** Convierte la clave pública VAPID (base64url) en los bytes que pide `pushManager.subscribe`. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Por qué este dispositivo puede (o no) recibir notificaciones. */
export type PushSupport = 'ok' | 'insecure' | 'ios-install' | 'unsupported';

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS moderno se presenta como Mac, pero tiene pantalla táctil.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isInstalledApp(): boolean {
  return (
    (navigator as NavigatorWithStandalone).standalone === true ||
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  // Los service workers y push solo existen en https (o localhost).
  if (!window.isSecureContext) return 'insecure';
  if (isIos() && !isInstalledApp()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return 'ok';
}

/** Registra `/sw.js` al cargar la pantalla. Si no se puede (http, navegador viejo) no hace nada ni rompe. */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Sin service worker no hay notificaciones, pero la pantalla sigue andando.
  });
}
