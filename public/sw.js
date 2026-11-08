// Service worker de riego-aut: recibe las notificaciones push del servidor y, al tocarlas,
// trae la pantalla al frente. No guarda nada en caché.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** Solo se aceptan direcciones del mismo origen que la app; cualquier otra cosa vuelve a la raíz. */
function sameOriginUrl(url) {
  try {
    const u = new URL(url || '/', self.location.origin);
    return u.origin === self.location.origin ? u.href : new URL('/', self.location.origin).href;
  } catch {
    return new URL('/', self.location.origin).href;
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Cuerpo vacío o que no es JSON: se muestra un aviso genérico.
  }
  if (typeof data !== 'object' || data === null) data = {};
  const title = typeof data.title === 'string' && data.title ? data.title : 'riego-aut';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    // Mismo tag = el aviso nuevo reemplaza al anterior en vez de apilarse.
    tag: typeof data.tag === 'string' && data.tag ? data.tag : undefined,
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: sameOriginUrl(data.url) },
  };
  // renotify exige un tag: sin él showNotification falla.
  if (!options.tag) options.renotify = false;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        try {
          await w.focus();
          if (w.url !== url && 'navigate' in w) await w.navigate(url);
        } catch {
          // Si no se pudo navegar, al menos queda enfocada.
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
