import { offlineSince, SENSOR, SENSOR_STATE, STATUS_TEXT, type StatusKey } from '@/core/copy';
import { formatAgo, longDateTime } from '@/core/format';
import { useAutomation, useDerived, useDeviceView, useSnapshot } from '@/data/hooks';
import { cn } from '@/lib/cn';
import { Card, CardTitle } from '@/ui/Card';
import { Skeleton } from '@/ui/Skeleton';
import { Alert02Icon, AlertDiamondFreeIcons, CheckmarkCircle02Icon, Clock01Icon, DropletIcon, Plant02Icon, WifiOff01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';

const STATUS_VIEW: Record<StatusKey, { icon: IconSvgElement; tone: string }> = {
  dry: { icon: Alert02Icon, tone: 'text-alert' },
  ok: { icon: CheckmarkCircle02Icon, tone: 'text-ok' },
  wet: { icon: DropletIcon, tone: 'text-accent' },
  error: { icon: AlertDiamondFreeIcons, tone: 'text-alert' },
};

/**
 * Humedad del suelo. Muestra lo que informa el backend: la conexión (`device.online`), el estado del sensor
 * (`device.sensor`) y la última lectura, con el valor crudo y la hora de la MISMA lectura que usa el panel de la placa.
 * No decide nada mirando el valor crudo.
 */
export function MoistureCard({ className }: { className?: string }) {
  const snapshot = useSnapshot();
  const { status } = useDerived();
  const auto = useAutomation();
  const { online, offlineForMs, lastReading: reading, sensor, now } = useDeviceView();

  if (snapshot.load === 'loading') {
    return (
      <Card aria-busy="true" aria-label="Humedad del suelo" className="min-h-[15.5rem]">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-6 h-20 w-44" />
        <Skeleton className="mt-5 h-5 w-36" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      </Card>
    );
  }

  const apiDown = !!snapshot.error;
  // Sin conexión (según el servidor): no hay cómo saber cómo está el sensor, así que no se muestra su estado.
  const offline = !online && !apiDown;
  const saturated = !offline && sensor.kind === 'saturated';
  const fault = !offline && sensor.kind === 'fault';

  const showValue = !!reading && status !== 'error';
  const { icon: StatusIcon, tone } = STATUS_VIEW[status];

  // La línea de estado, en orden de importancia.
  const line = offline
    ? { icon: WifiOff01Icon, tone: 'text-alert', text: offlineForMs !== null ? offlineSince(offlineForMs) : 'Sin conexión' }
    : saturated
      ? { icon: STATUS_VIEW.error.icon, tone: 'text-alert', text: SENSOR_STATE.saturated }
      : fault
        ? {
          icon: STATUS_VIEW.error.icon,
          tone: 'text-alert',
          text: sensor.reason ? `${SENSOR_STATE.fault}: ${SENSOR_STATE.reason[sensor.reason].toLowerCase()}` : SENSOR_STATE.fault,
        }
        : !reading
          ? { icon: WifiOff01Icon, tone: 'text-alert', text: SENSOR.empty }
          : { icon: StatusIcon, tone, text: STATUS_TEXT[status] };

  // Lo que va en el lugar de la humedad cuando no hay un valor que mostrar.
  // (la explicación va en la línea de estado, una sola vez)
  const placeholder = 'Sin dato';

  const threshold = snapshot.settings.thresholdPct;
  const pct = reading ? Math.min(100, Math.max(0, Math.round(reading.moisture))) : 0;

  return (
    <Card aria-labelledby="humedad-titulo" className={cn('flex min-h-[15.5rem] flex-col', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle id="humedad-titulo">Humedad del suelo</CardTitle>

          <p className={cn('mt-5 flex items-baseline gap-1 leading-none tabular-nums', offline && showValue && 'opacity-70')}>
            {showValue ? (
              <>
                <span className="text-[76px] font-semibold tracking-tight sm:text-[88px]">{Math.round(reading.moisture)}</span>
                <span className="text-4xl font-medium text-ink-2">%</span>
                {offline && (
                  <span className="ml-2 inline-flex items-center gap-1 self-center rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink-2">
                    <HugeiconsIcon icon={Clock01Icon} size={12} aria-hidden />
                    {SENSOR.lastData}
                  </span>
                )}
              </>
            ) : (
              <span className="text-3xl leading-tight font-semibold text-ink-3">{placeholder}</span>
            )}
          </p>
        </div>

        <div
          aria-hidden
          className="grid size-20 shrink-0 place-items-center rounded-[20px] border border-line bg-raised text-ink-2 sm:size-28"
        >
          <HugeiconsIcon icon={Plant02Icon} strokeWidth={1.4} className="size-10 sm:size-14" />
        </div>
      </div>

      {showValue && (
        <div className={cn('mt-5', offline && 'opacity-60')}>
          <div
            role="progressbar"
            aria-label="Humedad del suelo"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`${pct} %, umbral de riego ${threshold} %`}
            className="relative h-3 w-full overflow-hidden rounded-full bg-raised ring-1 ring-line"
          >
            <div className={'h-full rounded-full bg-accent transition-[width] duration-700 ease-out'} style={{ width: `${pct}%` }} />
            <div aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${threshold}%` }} />
          </div>
          <div className="relative mt-1 h-4 text-xs text-ink-3 tabular-nums">
            <span className="absolute left-0">0 %</span>
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${Math.min(Math.max(threshold, 12), 88)}%` }}>
              {auto.thresholdLabel(threshold)}
            </span>
            <span className="absolute right-0">100 %</span>
          </div>
        </div>
      )}

      <div className="mt-auto pt-4">
        <p role="status" className="flex flex-wrap items-center gap-2 text-[17px] font-semibold">
          <HugeiconsIcon icon={line.icon} size={18} aria-hidden className={cn('shrink-0', line.tone)} />
          <span className="min-w-0">{line.text}</span>
          {apiDown && !!reading && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink-2">
              <HugeiconsIcon icon={Clock01Icon} size={12} aria-hidden />
              Posiblemente desactualizado
            </span>
          )}
        </p>

        {/* En lugar del estado del sensor, cuando la placa está desconectada. */}
        {offline && <p className="mt-1 text-[15px] text-ink-2">{SENSOR_STATE.noData}</p>}

        {reading && (
          <p className="mt-1.5 text-[15px] text-ink-2">
            Última lectura: <span className="font-semibold text-ink">{longDateTime(reading.t)}</span>{' '}
            <span className="whitespace-nowrap">({formatAgo(now - reading.t)})</span>
          </p>
        )}
        <span className="font-semibold text-ink mt-1.5 text-[15px] text-ink-2">Actualiza en ~ 1.45min</span>

        {/* El valor crudo sale de la misma lectura. Con una falla (ruido o lectura muy baja) no es un dato de la tierra. */}
        {reading && <p className="mt-0.5 text-sm text-ink-3 tabular-nums">Valor crudo {fault ? 'Sin dato' : reading.raw}</p>}
      </div>
    </Card>
  );
}
