import type { ReactNode } from 'react';
import { COMMS, offlineSince, SENSOR_STATE, WIFI } from '@/core/copy';
import { formatAgo, formatDuration, formatSeconds, longDateTime, num, rssiQuality } from '@/core/format';
import type { Settings } from '@/core/types';
import { useDeviceView, useDerived, useSnapshot } from '@/data/hooks';
import { cn } from '@/lib/cn';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Wifi02Icon,
  WifiConnected01Icon,
  WifiNoSignalIcon,
  WifiOff01Icon,
} from '@hugeicons/core-free-icons';
import { needsWifiGuide } from '@/core/wifi';
import { WifiGuide } from '@/features/device/WifiGuide';
import { Skeleton } from '@/ui/Skeleton';
import { CalibrationSection } from './CalibrationSection';
import { deviceProblems } from './deviceProblems';
import { SettingsSection } from './SettingRow';

type Props = { save: (patch: Partial<Settings>, okMessage?: string) => Promise<boolean> };

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-0.5 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <dt className="text-[15px] text-ink-2">{label}</dt>
      <dd className="text-[15px] font-medium tabular-nums">{children}</dd>
    </div>
  );
}

export function DeviceTab({ save }: Props) {
  const snapshot = useSnapshot();
  const { online, offlineForMs, lastReading, sensor, now } = useDeviceView();
  const { device } = snapshot;
  const list = deviceProblems(snapshot, now);
  // Con el servidor sin respuesta los datos son los últimos conocidos: no se afirma que la placa esté en línea.
  const connected = online && !snapshot.error;
  // Tiempo encendida: lo que informó la placa al último reporte más lo que pasó desde entonces, si sigue en línea.
  const uptime =
    device.uptimeSec === undefined
      ? undefined
      : connected && device.lastSeen > 0
        ? device.uptimeSec + Math.max(0, now - device.lastSeen) / 1000
        : device.uptimeSec;
  // Valor crudo y hora salen juntos de la MISMA lectura que usa la tarjeta de humedad. Con una falla del sensor
  // (ruido o lectura muy baja) el valor no es un dato de la tierra, así que no se muestra.
  const raw = sensor.kind === 'fault' ? undefined : lastReading;

  return (
    <div>
      <SettingsSection title="Placa ESP32">
        <dl>
          <Item label="Conexión">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className={cn('size-2 rounded-full', connected ? 'bg-ok' : 'bg-alert')} />
              {connected ? 'En línea' : offlineForMs !== null ? offlineSince(offlineForMs) : 'Sin conexión'}
            </span>
          </Item>
          <Item label="Última lectura">
            {lastReading ? `${longDateTime(lastReading.t)} (${formatAgo(now - lastReading.t)})` : 'Sin lecturas'}
          </Item>
          {device.firstSeen !== undefined && <Item label="Registrada desde">{longDateTime(device.firstSeen)}</Item>}
          <Item label="Frecuencia de lectura">{`Cada ${device.readEveryMin} min`}</Item>
          {device.offlineAfterSec !== undefined && (
            <Item label="Se marca desconectada si no reporta en">{formatSeconds(device.offlineAfterSec)}</Item>
          )}
          <Item label="Sensor de humedad">
            {!online ? (
              <span className="text-ink-2">{SENSOR_STATE.noData}</span>
            ) : sensor.kind === 'unknown' ? (
              SENSOR_STATE.unknown
            ) : sensor.kind === 'ok' ? (
              <span className="inline-flex items-center gap-2 text-ok">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden className="shrink-0" />
                {SENSOR_STATE.ok}
              </span>
            ) : sensor.kind === 'saturated' ? (
              <span role="status" className="block max-w-full text-right">
                <span className="inline-flex items-start gap-2 text-left text-alert">
                  <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden className="mt-0.5 shrink-0" />
                  {SENSOR_STATE.saturated}
                </span>
              </span>
            ) : (
              <span role="status" className="block max-w-full text-right">
                <span className="inline-flex items-center gap-2 text-alert">
                  <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden className="shrink-0" />
                  {SENSOR_STATE.fault}
                </span>
                {sensor.reason && (
                  <span className="mt-0.5 block text-sm font-normal text-ink-2">
                    {SENSOR_STATE.reasonLabel}: {SENSOR_STATE.reason[sensor.reason]}
                  </span>
                )}
              </span>
            )}
          </Item>
          <Item label="Valor crudo del sensor">
            {raw === undefined ? (
              'Sin dato'
            ) : (
              <>
                {raw.raw}
                <span className="font-normal text-ink-2"> · {formatAgo(now - raw.t)}</span>
              </>
            )}
          </Item>
          <Item label="Versión del firmware">{device.fw ?? 'La placa no lo informa'}</Item>
          <Item label="Encendida">
            {uptime === undefined
              ? 'La placa no lo informa'
              : connected
                ? formatDuration(uptime / 3600)
                : `${formatDuration(uptime / 3600)} al último reporte`}
          </Item>
          <Item label="Errores de comunicación">
            {list.length === 0 ? (
              COMMS.none
            ) : (
              <span className="block text-right text-alert">
                {list.map((p) => (
                  <span key={p} className="block">
                    {p}
                  </span>
                ))}
              </span>
            )}
          </Item>
        </dl>
      </SettingsSection>

      <WifiSection />

      <CalibrationSection save={save} />
    </div>
  );
}

/** Qué ícono lleva la señal según su calidad (o sin wifi si la placa no está conectada). */
function signalIcon(connected: boolean, rssi: number | undefined) {
  if (!connected || rssi === undefined) return WifiOff01Icon;
  const q = rssiQuality(rssi);
  return q === 'excelente' || q === 'buena' ? WifiConnected01Icon : q === 'regular' ? Wifi02Icon : WifiNoSignalIcon;
}

/**
 * Wi-Fi de la placa: red, señal y último cambio. Si está sin conexión o olvidó su red, trae los pasos para cargar
 * un wifi nuevo. Mientras carga muestra marcadores; sin conexión con el servidor avisa que son los últimos datos.
 */
function WifiSection() {
  const snapshot = useSnapshot();
  const { wifi } = useDerived();
  const { device, now } = snapshot;

  if (snapshot.load === 'loading') {
    return (
      <SettingsSection title={WIFI.section}>
        <div aria-busy="true" aria-label="Wi-Fi">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-3 h-5 w-56 max-w-full" />
          <Skeleton className="mt-3 h-5 w-48" />
        </div>
      </SettingsSection>
    );
  }

  const reset = wifi === 'reset';
  const connected = wifi === 'connected' || wifi === 'unknown';
  const Icon = signalIcon(connected && !reset, device.rssi);

  return (
    <SettingsSection title={WIFI.section}>
      {snapshot.error && (
        <p role="status" className="mb-3 flex items-start gap-2 text-sm text-ink-2">
          <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden className="mt-0.5 shrink-0 text-alert" />
          {WIFI.serverDown}
        </p>
      )}
      <dl>
        <Item label={WIFI.network}>{reset ? WIFI.noNetwork : (device.ssid ?? WIFI.unknown)}</Item>
        <Item label={WIFI.signal}>
          <span className="inline-flex items-center gap-2">
            <HugeiconsIcon icon={Icon} size={16} aria-hidden className="shrink-0" />
            {device.rssi !== undefined && !reset
              ? `${num(device.rssi).replace('-', '−')} dBm · ${rssiQuality(device.rssi)}`
              : WIFI.noSignal}
          </span>
        </Item>
        <Item label={WIFI.lastChange}>
          {device.lastWifiChange !== undefined
            ? `${longDateTime(device.lastWifiChange)} (${formatAgo(now - device.lastWifiChange)})`
            : WIFI.noChange}
        </Item>
      </dl>
      {needsWifiGuide(wifi) && (
        <div className="mt-4 border-t border-line pt-4">
          <WifiGuide state={wifi as 'offline' | 'reset'} />
        </div>
      )}
    </SettingsSection>
  );
}

