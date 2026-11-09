import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  /** Cada página es una diapositiva en mobile. */
  pages: ReactNode[];
  /** Nombre de cada página, para los puntitos y los lectores de pantalla. */
  labels: string[];
  /** Descripción del conjunto, para los lectores de pantalla. */
  ariaLabel: string;
  /** Clases del contenedor que se desliza. Ahí va también cómo se ve desde `md` (por ejemplo una grilla). */
  className?: string;
  /** Clases de cada página (ancho en mobile y cómo se acomoda desde `md`, por ejemplo `md:contents`). */
  pageClassName?: string;
};

/**
 * Páginas que se deslizan con el dedo, una a la vez, con puntitos que indican en cuál se está.
 * Los puntitos solo existen en mobile (`md:hidden`); desde `md` el contenedor se comporta como lo defina `className`.
 */
export function SwipePager({ pages, labels, ariaLabel, className, pageClassName }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = pages.length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const step = el.scrollWidth / count;
      setIndex(Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / step))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [count]);

  const go = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: (el.scrollWidth / count) * i, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div className="min-w-0" data-no-swipe>
      <div
        ref={ref}
        role="group"
        aria-roledescription="carrusel"
        aria-label={ariaLabel}
        className={cn('thin-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto', className)}
      >
        {pages.map((page, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="diapositiva"
            aria-label={`${i + 1} de ${count}: ${labels[i] ?? ''}`}
            className={cn('min-w-0 shrink-0 snap-center', pageClassName)}
          >
            {page}
          </div>
        ))}
      </div>
      {count > 1 && (
        <div className="mt-3 flex justify-center gap-2 md:hidden" role="tablist" aria-label="Elegir página">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={index === i}
              aria-label={labels[i] ?? `Página ${i + 1}`}
              onClick={() => go(i)}
              className="grid size-6 place-items-center"
            >
              <span
                className={cn('block h-2 rounded-full transition-all duration-200', index === i ? 'w-5 bg-accent' : 'w-2 bg-line')}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
