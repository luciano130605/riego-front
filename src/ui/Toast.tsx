import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ToastContext, type ToastApi, type ToastKind } from './toastContext';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Cancel01Icon, CheckmarkCircle02Icon, InfoIcon } from '@hugeicons/core-free-icons';

type Item = { id: number; kind: ToastKind; message: string };

const ICONS = { success: CheckmarkCircle02Icon, error: Alert02Icon, info: InfoIcon } as const;
const TONE = { success: 'text-ok', error: 'text-alert', info: 'text-accent' } as const;
const DURATION = { success: 3500, info: 3500, error: 7000 } as const;

/** Avisos cortos abajo a la derecha: confirman lo que pasó o explican qué salió mal. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback<ToastApi['show']>(
    (kind, message) => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-2), { id, kind, message }]);
      setTimeout(() => dismiss(id), DURATION[kind]);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label="Avisos"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5"
      >
        {items.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-control border border-line bg-raised py-3 pr-2 pl-4 shadow-pop [animation:toast-in_200ms_ease-out] motion-reduce:animate-none"
            >
              <HugeiconsIcon icon={Icon} size={18} aria-hidden className={cn('mt-0.5 shrink-0', TONE[t.kind])} />
              <p className="min-w-0 flex-1 text-[15px] leading-snug">{t.message}</p>
              <button
                type="button"
                aria-label="Cerrar aviso"
                onClick={() => dismiss(t.id)}
                className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-card hover:text-ink"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
