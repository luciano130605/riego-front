import { useMemo, useRef, useState } from 'react';
import { formatAgo } from '@/core/format';
import type { Snapshot } from '@/core/types';
import type { Derived } from '@/data/derive';
import { buildLog, type LogKind } from '@/features/log/buildLog';
import { useDismiss } from '@/lib/useDismiss';
import { IconButton } from '@/ui/Button';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, AlertDiamondIcon, CheckmarkCircle02Icon, Notification01Icon, Wifi01Icon } from '@hugeicons/core-free-icons';
import { needsWifiGuide } from '@/core/wifi';

const ALERT_KINDS: LogKind[] = ['dry', 'recovered', 'fault', 'back', 'wifi'];
const WINDOW_MS = 48 * 3_600_000;

type Props = { snapshot: Snapshot; derived: Derived };

/**
 * Campana con los avisos de los últimos dos días: humedad bajo el umbral,
 * sensor caído y recuperaciones. El punto rojo indica un problema que sigue vigente,
 * no algo "sin leer": todavía no hay dónde guardar qué se vio.
 */
export function NotificationsButton({ snapshot, derived }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const entries = useMemo(
    () =>
      buildLog(snapshot, 200)
        .filter((e) => ALERT_KINDS.includes(e.kind) && snapshot.now - e.t <= WINDOW_MS)
        .slice(0, 8),
    [snapshot],
  );

  const problem =
    !!snapshot.error || derived.stale || derived.status === 'dry' || derived.status === 'error' || needsWifiGuide(derived.wifi);

  return (
    <div ref={ref} className="relative">
      <IconButton
        label={problem ? 'Avisos: hay algo que revisar' : 'Avisos'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <HugeiconsIcon icon={Notification01Icon} size={20} aria-hidden />
        {problem && (
          <span aria-hidden className="absolute top-3 right-3.5 size-2 rounded-full bg-alert ring-2 ring-card" />
        )}
      </IconButton>

      {open && (
        <div
          role="region"
          aria-label="Avisos recientes"
          className="absolute top-14 right-0 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-line bg-raised p-2 shadow-pop [animation:pop-in_150ms_ease-out] motion-reduce:animate-none"
        >
          <h2 className="px-3 pt-2 pb-1 text-sm font-semibold">Avisos de los últimos dos días</h2>
          {entries.length === 0 ? (
            <p className="px-3 pt-1 pb-3 text-sm text-ink-2">No hubo avisos. La humedad se mantuvo en rango.</p>
          ) : (
            <ul className="thin-scroll max-h-80 overflow-y-auto">
              {entries.map((e) => {
                const bad = e.kind === 'dry' || e.kind === 'fault';
                const Icon = e.kind === 'wifi' ? Wifi01Icon : e.kind === 'dry' ? Alert02Icon : bad ? AlertDiamondIcon : CheckmarkCircle02Icon;
                return (
                  <li key={`${e.kind}-${e.t}`} className="flex gap-3 rounded-control px-3 py-2.5">
                    <HugeiconsIcon icon={Icon} size={16} aria-hidden className={bad ? 'mt-0.5 shrink-0 text-alert' : 'mt-0.5 shrink-0 text-ok'} />
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">{e.text}</p>
                      <p className="text-xs text-ink-3">{formatAgo(snapshot.now - e.t)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
