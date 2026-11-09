import { useMemo, useRef, useState } from 'react';
import { BELL } from '@/core/copy';
import { formatAgo } from '@/core/format';
import type { Snapshot } from '@/core/types';
import type { Derived } from '@/data/derive';
import { useDismiss } from '@/lib/useDismiss';
import { IconButton } from '@/ui/Button';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert02Icon,
  AlertDiamondIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Notification01Icon,
  Wifi01Icon,
} from '@hugeicons/core-free-icons';
import { needsWifiGuide } from '@/core/wifi';
import { buildBell } from './bell';
import { addDismissed, readDismissed } from './dismissed';

type Props = { snapshot: Snapshot; derived: Derived };

/** El botón chico que descarta un aviso en este navegador. */
function DismissButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="-mt-0.5 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-card hover:text-ink"
    >
      <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden />
    </button>
  );
}

/**
 * Campana con los avisos de los últimos dos días: humedad bajo el umbral, sensor caído y recuperaciones. Arriba de
 * todo, si hay, el resumen de la noche. Cada aviso se puede descartar (queda recordado en este navegador). El punto
 * rojo indica un problema que sigue vigente, no algo "sin leer": no depende de lo descartado.
 */
export function NotificationsButton({ snapshot, derived }: Props) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const { summary, entries } = useMemo(() => buildBell(snapshot, dismissedSet), [snapshot, dismissedSet]);
  const dismiss = (key: string) => setDismissed((cur) => addDismissed(key, cur));

  const problem =
    !!snapshot.error || derived.stale || derived.status === 'dry' || derived.status === 'error' || needsWifiGuide(derived.wifi);

  return (
    // En pantallas chicas el panel se ancla al encabezado (ocupa su ancho); desde lg, a la campana.
    <div ref={ref} className="lg:relative">
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
          className="absolute inset-x-0 top-14 z-30 rounded-card border border-line bg-raised p-2 shadow-pop [animation:pop-in_150ms_ease-out] motion-reduce:animate-none sm:inset-x-auto sm:right-0 sm:w-[22rem] lg:top-14"
        >
          {summary && (
            <section aria-label={BELL.nightSummary} className="mb-1 rounded-control border border-line bg-card px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{BELL.nightSummary}</h2>
                  <p className="text-xs text-ink-3">{formatAgo(snapshot.now - summary.t)}</p>
                </div>
                <DismissButton label={BELL.dismissSummary} onClick={() => dismiss(summary.key)} />
              </div>
              <ul className="mt-1.5 space-y-1">
                {summary.lines.map((line) => (
                  <li key={line} className="text-sm leading-snug text-ink-2">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <h2 className="px-3 pt-2 pb-1 text-sm font-semibold">Avisos de los últimos dos días</h2>
          {entries.length === 0 ? (
            <p className="px-3 pt-1 pb-3 text-sm text-ink-2">No hubo avisos. La humedad se mantuvo en rango.</p>
          ) : (
            <ul className="thin-scroll max-h-80 overflow-y-auto">
              {entries.map((e) => {
                const bad = e.kind === 'dry' || e.kind === 'fault';
                const Icon = e.kind === 'wifi' ? Wifi01Icon : e.kind === 'dry' ? Alert02Icon : bad ? AlertDiamondIcon : CheckmarkCircle02Icon;
                return (
                  <li key={e.key} className="flex gap-3 rounded-control px-3 py-2.5">
                    <HugeiconsIcon icon={Icon} size={16} aria-hidden className={bad ? 'mt-0.5 shrink-0 text-alert' : 'mt-0.5 shrink-0 text-ok'} />
                    <div className="min-w-0 flex-1">
                      {e.where && <p className="text-xs font-medium text-ink-2">{e.where}</p>}
                      <p className="text-sm leading-snug">{e.text}</p>
                      <p className="text-xs text-ink-3">
                        {formatAgo(snapshot.now - e.t)}
                        {e.silenced && <span title="Salió en horario de No molestar: no llegó como notificación."> · {BELL.silenced}</span>}
                      </p>
                    </div>
                    <DismissButton label={BELL.dismiss} onClick={() => dismiss(e.key)} />
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
