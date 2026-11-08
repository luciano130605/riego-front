import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Pie fijo con las acciones. */
  footer?: ReactNode;
  className?: string;
};

/**
 * Diálogo modal sobre <dialog>: el navegador se ocupa del foco, de Escape y de
 * dejar el resto de la página inerte. Solo se agrega el cierre al tocar afuera.
 */
export function Dialog({ open, onClose, title, description, children, footer, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // El evento `close` de un diálogo anidado (por ejemplo una confirmación dentro de Configuración)
      // sube por el árbol de React: solo cuenta el que viene de este mismo diálogo.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        'dialog m-auto w-[min(44rem,calc(100%-1.5rem))] max-w-none overflow-hidden rounded-card border border-line bg-card p-0 text-ink shadow-pop',
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[min(46rem,calc(100dvh-1.5rem))] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-0.5 text-sm text-ink-2">
                  {description}
                </p>
              )}
            </div>
            <IconButton label="Cerrar" onClick={onClose} className="size-11 border-transparent bg-transparent">
              <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
            </IconButton>
          </header>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer && <footer className="border-t border-line px-5 py-3 sm:px-6">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
