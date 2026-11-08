import { offlineSince } from '@/core/copy';
import { formatAgo, formatSeconds, num, rssiQuality } from '@/core/format';
import { useDeviceView, useSnapshot } from '@/data/hooks';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/ui/Skeleton';

/** Estado del equipo: si hay conexión, la señal wifi o por qué no se sabe nada. */
export function ConnectionChip({ className }: { className?: string }) {
  const snapshot = useSnapshot();
  const { online, offlineForMs, lastReading: reading, now } = useDeviceView();

  if (snapshot.load === 'loading') return <Skeleton className={cn('h-12 w-full rounded-full lg:w-52', className)} />;

  const { device, error } = snapshot;
  const apiDown = !!error;
  // En línea = lo que dice el servidor (`device.online`). La pantalla no calcula cuánto silencio alcanza para darla por caída.
  const connected = online && !apiDown;

  let title = 'Sistema en línea';
  let detail = device.rssi !== undefined ? `ESP32 · Wifi ${num(device.rssi)} dBm`.replace('-', '−') : 'ESP32';
  if (apiDown) {
    title = 'Sin conexión con el servidor';
    detail = reading ? `Últimos datos ${formatAgo(now - reading.t)}` : 'Sin datos';
  } else if (!online) {
    title = 'Placa sin conexión';
    detail = offlineForMs !== null ? offlineSince(offlineForMs) : 'Sin lecturas';
  }

  // El límite lo informa el servidor (`offlineAfterSec`); si no lo informa, no se inventa.
  const limitText = device.offlineAfterSec !== undefined ? ` Si no reporta en ${formatSeconds(device.offlineAfterSec)}, se marca desconectada.` : '';
  const quality = device.rssi !== undefined ? ` Señal ${rssiQuality(device.rssi)}.` : '';

  return (
    <div
      className={cn('flex h-12 min-w-0 items-center gap-2.5 rounded-full border border-line bg-card px-3 lg:gap-3 lg:px-4', className)}
      title={connected ? `Conectado.${quality}${limitText}` : title}
    >
      <span
        aria-hidden
        className={cn('size-2.5 shrink-0 rounded-full', connected ? 'bg-ok' : 'bg-alert')}
      />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-ink-3 tabular-nums">{detail}</p>
      </div>
    </div>
  );
}
