import { WIFI } from '@/core/copy';
import { needsWifiGuide, type WifiState } from '@/core/wifi';
import { useDerived } from '@/data/hooks';
import { cn } from '@/lib/cn';
import { HugeiconsIcon } from '@hugeicons/react';
import { WifiOff01Icon } from '@hugeicons/core-free-icons';

/** Los pasos para cargarle un wifi nuevo a la placa. */
export function WifiSteps({ className }: { className?: string }) {
  return (
    <ol className={cn('space-y-2', className)}>
      {WIFI.steps.map((text, i) => (
        <li key={text} className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-line text-xs font-semibold text-ink-2"
          >
            {i + 1}
          </span>
          <span className="min-w-0 text-[15px]">
            <span className="sr-only">Paso {i + 1}: </span>
            {text}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Título, explicación y pasos según el estado. Es el contenido del cartel y de la sección Wi-Fi. */
export function WifiGuide({ state }: { state: Extract<WifiState, 'offline' | 'reset'> }) {
  const reset = state === 'reset';
  return (
    <div>
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <HugeiconsIcon icon={WifiOff01Icon} size={18} aria-hidden className="shrink-0 text-alert" />
        {reset ? WIFI.resetTitle : WIFI.offlineTitle}
      </p>
      <p className="mt-1 mb-3 text-sm text-ink-2">{reset ? WIFI.resetLead : WIFI.offlineLead}</p>
      <WifiSteps />
    </div>
  );
}

/**
 * Cartel del tablero: la placa está sin conexión o olvidó su red, y cómo cargarle un wifi nuevo. Se va solo
 * cuando la placa vuelve a reportar. No se muestra mientras carga ni si no hay conexión con el servidor (ahí no
 * se sabe qué le pasa a la placa).
 */
export function WifiBanner() {
  const { wifi } = useDerived();
  if (!needsWifiGuide(wifi)) return null;
  return (
    <div role="status" className="rounded-control border border-alert/35 bg-alert/10 px-4 py-3">
      <WifiGuide state={wifi as 'offline' | 'reset'} />
    </div>
  );
}
