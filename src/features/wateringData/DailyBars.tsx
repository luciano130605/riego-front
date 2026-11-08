import { useMemo, useState, type KeyboardEvent } from 'react';
import { dayLabel, num } from '@/core/format';
import { barDays, dailyPump, type Period, type StatsInput } from '@/core/stats';
import { cn } from '@/lib/cn';
import { plural } from './Section';

/** Texto de un día, para el detalle visible, el lector de pantalla y la tabla accesible. */
function describe(b: { dayStart: number; seconds: number | null; cycles: number }, now: number): string {
  const day = dayLabel(b.dayStart, now);
  if (b.seconds === null) return `${day}: Sin dato`;
  if (b.seconds === 0) return `${day}: sin riegos`;
  return `${day}: ${num(b.seconds)} s de bomba, ${plural(b.cycles, 'riego', 'riegos')}`;
}

/**
 * Segundos de bomba por día. Las barras son solo dibujo: se recorren con las flechas (un solo
 * tope de tabulación) y el detalle del día elegido aparece debajo y se anuncia; además hay una
 * tabla oculta con todos los valores para lectores de pantalla.
 */
export function DailyBars({ input, period }: { input: StatsInput; period: Period }) {
  const days = barDays(period);
  const bars = useMemo(() => dailyPump(input, days), [input, days]);
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(0, ...bars.map((b) => b.seconds ?? 0));
  const known = bars.filter((b) => b.seconds !== null).length;
  const current = active !== null ? Math.min(active, bars.length - 1) : null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = current ?? bars.length;
    let next: number;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') next = Math.min(bars.length - 1, current === null ? bars.length - 1 : cur + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = bars.length - 1;
    else if (e.key === 'Escape') {
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setActive(next);
  };

  if (known === 0) {
    return <p className="rounded-control border border-line px-4 py-6 text-center text-sm text-ink-2">Sin dato: todavía no hay lecturas ni riegos en estos días.</p>;
  }

  return (
    <div className="min-w-0">
      <div
        tabIndex={0}
        role="group"
        aria-label={`Segundos de bomba por día, últimos ${days} días. Usá las flechas para ver cada día.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="rounded-control border border-line px-3 pt-3 pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="flex items-baseline justify-between text-xs text-ink-3 tabular-nums">
          <span>{max > 0 ? `Máx. ${num(max)} s` : 'Sin riegos'}</span>
          <span>0 s</span>
        </div>
        <div aria-hidden className="mt-1 flex h-28 items-end gap-px sm:gap-0.5">
          {bars.map((b, i) => (
            <div
              key={b.dayStart}
              onPointerEnter={() => setActive(i)}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              {b.seconds === null ? (
                <div className="h-px w-full border-t border-dashed border-line" />
              ) : (
                <div
                  className={cn(
                    'w-full rounded-t-[3px] transition-colors',
                    b.seconds === 0 ? 'h-px bg-line' : 'bg-accent',
                    current === i && b.seconds > 0 && 'bg-ink',
                  )}
                  style={b.seconds > 0 ? { height: `${Math.max(4, (b.seconds / max) * 100)}%` } : undefined}
                />
              )}
            </div>
          ))}
        </div>
        <div aria-hidden className="mt-1.5 flex justify-between text-xs text-ink-3">
          <span>{dayLabel(bars[0].dayStart, input.now)}</span>
          <span>hoy</span>
        </div>
      </div>

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-2 tabular-nums">
        {current !== null ? describe(bars[current], input.now) : 'Pasá el mouse o usá las flechas para ver el detalle de cada día.'}
      </p>

      <table className="sr-only">
        <caption>Segundos de bomba y riegos por día</caption>
        <thead>
          <tr>
            <th scope="col">Día</th>
            <th scope="col">Segundos de bomba</th>
            <th scope="col">Riegos</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.dayStart}>
              <th scope="row">{dayLabel(b.dayStart, input.now)}</th>
              <td>{b.seconds === null ? 'Sin dato' : b.seconds}</td>
              <td>{b.seconds === null ? 'Sin dato' : b.cycles}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
