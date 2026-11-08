import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { groupCycles, type Cycle } from '@/core/cycles';
import { dayAndTime, num, timeHM } from '@/core/format';
import type { Reading, WaterEvent } from '@/core/types';
import { Card, CardTitle } from '@/ui/Card';
import { Skeleton } from '@/ui/Skeleton';
import { daySegments, hourTicks, nearestIndex, SPAN_MS, splitSegments, visibleReadings, type Range } from './chartMath';

type Props = {
  title: string;
  range: Range;
  readings: Reading[];
  events: WaterEvent[];
  now: number;
  threshold: number;
  readEveryMin: number;
  loading?: boolean;
};

type Hover = { kind: 'reading'; i: number } | { kind: 'cycle'; i: number } | null;

const M = { l: 54, r: 8, t: 10, b: 30 };
const GRID = [0, 25, 50, 75, 100];
const MIN = 60_000;
const HEIGHT = 208;
const WEEKDAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/**
 * Evolución de la humedad: línea azul fina con un relleno suave, la línea de
 * alerta y, si el cursor pasa por encima, el valor exacto. Nunca une huecos
 * de lecturas ni dibuja nada que no haya medido el sensor.
 */
export function MoistureChart({ title, range, readings, events, now, threshold, readEveryMin, loading }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const gradId = useId();
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<Hover>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  const span = SPAN_MS[range];
  const from = now - span;
  const pw = width - M.l - M.r;
  const ph = HEIGHT - M.t - M.b;
  const x = (t: number) => M.l + ((t - from) / span) * pw;
  const y = (v: number) => M.t + (1 - v / 100) * ph;
  const base = y(0);

  const points = useMemo(() => visibleReadings(readings, now, range), [readings, now, range]);
  const segments = useMemo(() => splitSegments(points, readEveryMin * MIN * 2.5), [points, readEveryMin]);
  const cycles = useMemo<Cycle[]>(
    () =>
      groupCycles(
        events.filter((e) => e.t >= from - 3_600_000 && e.t <= now),
        readEveryMin,
      ).filter((c) => c.start >= from),
    [events, from, now, readEveryMin],
  );

  const linePath = segments
    .map((seg) => seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.moisture).toFixed(1)}`).join(''))
    .join('');
  const areaPath = segments
    .filter((seg) => seg.length > 1)
    .map((seg) => {
      const first = seg[0];
      const last = seg[seg.length - 1];
      const line = seg.map((p) => `L${x(p.t).toFixed(1)},${y(p.moisture).toFixed(1)}`).join('');
      return `M${x(first.t).toFixed(1)},${base}${line}L${x(last.t).toFixed(1)},${base}Z`;
    })
    .join('');

  const labels = useMemo(() => {
    if (range === '24h') {
      return hourTicks(now).map((t) => ({ key: t, x: x(t), text: timeHM(t) }));
    }
    // En pantallas angostas, los tramos de borde no dejan lugar para el rótulo: se omiten.
    return daySegments(now)
      .filter((s) => x(s.end) - x(s.start) >= 36)
      .map((s) => ({ key: s.start, x: x(s.mid), text: WEEKDAY[new Date(s.mid).getDay()] }));
    // x depende de width y now: se recalcula con ellos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, now, width]);

  const valueAt = (t: number): number => {
    const i = nearestIndex(points, t);
    return i < 0 ? threshold : points[i].moisture;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    if (px < M.l || px > width - M.r) {
      setHover(null);
      return;
    }
    let best = -1;
    let bestD = 12;
    cycles.forEach((c, i) => {
      const d = Math.hypot(x(c.start) - px, y(valueAt(c.start)) - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      setHover({ kind: 'cycle', i: best });
      return;
    }
    const i = nearestIndex(points, from + ((px - M.l) / pw) * span);
    setHover(i >= 0 ? { kind: 'reading', i } : null);
  };

  const onKey = (e: KeyboardEvent) => {
    if (points.length === 0) return;
    const cur = hover?.kind === 'reading' ? hover.i : points.length;
    const step = e.shiftKey ? 8 : 1;
    let next: number;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - step);
    else if (e.key === 'ArrowRight') next = Math.min(points.length - 1, cur + step);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = points.length - 1;
    else if (e.key === 'Escape') {
      setHover(null);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    setHover({ kind: 'reading', i: next });
  };

  if (loading) {
    return (
      <Card aria-busy="true" aria-label={title}>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-5 h-[13rem] w-full" />
      </Card>
    );
  }

  const active = hover?.kind === 'reading' ? points[hover.i] : undefined;
  const activeCycle = hover?.kind === 'cycle' ? cycles[hover.i] : undefined;
  const anchorT = active?.t ?? activeCycle?.start;
  const anchorX = anchorT === undefined ? 0 : x(anchorT);
  const flip = anchorX > width * 0.6;
  const last = points[points.length - 1];
  const empty = points.length < 2;

  const cycleText = (c: Cycle) =>
    `${c.source === 'auto' ? 'Riego automático' : 'Riego a mano'}: ${c.seconds} s${c.pulses > 1 ? ` en ${c.pulses} tandas` : ''}`;
  const announce = active
    ? `${num(active.moisture)} por ciento, ${dayAndTime(active.t, now)}`
    : activeCycle
      ? `${cycleText(activeCycle)}, ${dayAndTime(activeCycle.start, now)}`
      : '';

  return (
    <Card aria-labelledby={`${gradId}-t`}>
      <CardTitle id={`${gradId}-t`}>{title}</CardTitle>

      <div
        ref={wrapRef}
        className="relative mt-3 w-full min-w-0"
        tabIndex={empty ? -1 : 0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        role="group"
        aria-label={`${title}. Con las flechas del teclado recorrés las lecturas.`}
      >
        <svg
          width={width}
          height={HEIGHT}
          className="block max-w-full touch-pan-x touch-pan-y overflow-visible select-none"
          onPointerDown={empty ? undefined : onMove}
          onPointerMove={empty ? undefined : onMove}
          onPointerLeave={() => setHover(null)}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.24" />
              <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {GRID.map((g) => (
            <g key={g}>
              <line x1={M.l} x2={width - M.r} y1={y(g)} y2={y(g)} stroke="var(--color-grid)" strokeWidth="1" />
              <text
                x={M.l - 12}
                y={y(g)}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-3 text-[13px] tabular-nums"
              >
                {g} %
              </text>
            </g>
          ))}

          {labels.map((l) => (
            <text key={l.key} x={l.x} y={base + 22} textAnchor="middle" className="fill-ink-3 text-[13px] tabular-nums">
              {l.text}
            </text>
          ))}

          {!empty && (
            <>
              <path d={areaPath} fill={`url(#${gradId})`} />
              <path
                d={linePath}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="1.75"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          )}

          {/* línea de alerta */}
          <line x1={M.l} x2={width - M.r} y1={y(threshold)} y2={y(threshold)} stroke="#777" strokeWidth="1.25" />
          <text
            x={width - M.r}
            y={y(threshold) - 8}
            textAnchor="end"
            className="fill-ink-2 text-[13px] tabular-nums"
            stroke="var(--color-card)"
            strokeWidth="4"
            paintOrder="stroke"
          >
            alerta {threshold} %
          </text>

          {/* riegos: un punto por cada riego completo */}
          {!empty &&
            cycles.map((c, i) => {
              const on = hover?.kind === 'cycle' && hover.i === i;
              return (
                <g key={c.start}>
                  <circle cx={x(c.start)} cy={y(valueAt(c.start))} r="12" fill="transparent" />
                  <circle
                    cx={x(c.start)}
                    cy={y(valueAt(c.start))}
                    r={on ? 5.5 : 4}
                    fill="var(--color-ink)"
                    stroke="var(--color-card)"
                    strokeWidth="2"
                  />
                </g>
              );
            })}

          {last && !empty && <circle cx={x(last.t)} cy={y(last.moisture)} r="4.5" fill="var(--color-accent)" />}

          {active && (
            <g>
              <line x1={x(active.t)} x2={x(active.t)} y1={M.t} y2={base} stroke="#555" strokeWidth="1" />
              <circle
                cx={x(active.t)}
                cy={y(active.moisture)}
                r="4.5"
                fill="var(--color-accent)"
                stroke="var(--color-card)"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>

        {empty && (
          <div className="pointer-events-none absolute inset-x-2 top-[42%] flex -translate-y-1/2 justify-center pl-12">
            <p className="max-w-[17rem] rounded-control bg-card px-3 py-2 text-center text-sm text-ink-3">
              Todavía no hay lecturas suficientes para dibujar este tramo.
            </p>
          </div>
        )}

        {(active || activeCycle) && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-control border border-line bg-raised px-3 py-2 shadow-pop"
            style={flip ? { right: width - anchorX + 12 } : { left: anchorX + 12 }}
          >
            {active ? (
              <>
                <p className="text-lg leading-tight font-semibold tabular-nums">{num(active.moisture, 1)} %</p>
                <p className="text-xs text-ink-2">{dayAndTime(active.t, now)}</p>
              </>
            ) : (
              activeCycle && (
                <>
                  <p className="text-[15px] leading-tight font-semibold">{cycleText(activeCycle)}</p>
                  <p className="text-xs text-ink-2">{dayAndTime(activeCycle.start, now)}</p>
                </>
              )
            )}
          </div>
        )}

        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>
    </Card>
  );
}
