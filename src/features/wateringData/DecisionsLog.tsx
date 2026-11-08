import { useId, useMemo, useState } from 'react';
import { reasonLabel } from '@/core/copy';
import { dayDiff, dayLabel, num, timeHM } from '@/core/format';
import { decisionRuns, type DecisionRun } from '@/core/stats';
import type { Reading } from '@/core/types';
import { cn } from '@/lib/cn';
import { Switch } from '@/ui/Switch';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Alert02Icon, DropletIcon, InformationCircleIcon } from '@hugeicons/core-free-icons';
import { EmptyNote, plural } from './Section';

function view(run: DecisionRun): { icon: IconSvgElement; tone: string; kind: string } {
  if (run.water) return { icon: DropletIcon, tone: 'text-accent', kind: 'Regó' };
  if (run.problem) return { icon: Alert02Icon, tone: 'text-alert', kind: 'Problema' };
  return { icon: InformationCircleIcon, tone: 'text-ink-3', kind: 'No regó' };
}

/** "14:00–17:30", o con el día si el tramo no es de hoy o cruza la medianoche. */
function range(run: DecisionRun, now: number): string {
  const sameDay = dayDiff(run.from, run.to) === 0;
  const start = dayDiff(run.from, now) === 0 ? timeHM(run.from) : `${dayLabel(run.from, now)} ${timeHM(run.from)}`;
  if (run.count === 1) return start;
  const end = sameDay ? timeHM(run.to) : `${dayLabel(run.to, now)} ${timeHM(run.to)}`;
  return `${start}–${end}`;
}

function humidity(run: DecisionRun): string | null {
  const { moistureFrom: a, moistureTo: b } = run;
  if (a === null && b === null) return null;
  if (a === null || b === null || Math.round(a) === Math.round(b)) return `${num((a ?? b) as number)} %`;
  return `${num(a)} → ${num(b)} %`;
}

export function DecisionsLog({ readings, now }: { readings: Reading[]; now: number }) {
  const [onlyRelevant, setOnlyRelevant] = useState(false);
  const switchId = useId();
  const runs = useMemo(() => decisionRuns(readings, now, { onlyRelevant }), [readings, now, onlyRelevant]);
  const hasAny = useMemo(() => readings.some((r) => r.decision && r.t >= now - 48 * 3_600_000), [readings, now]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <label htmlFor={switchId} className="min-w-0 text-sm text-ink-2">
          Solo cuando regó o hubo un problema
        </label>
        <Switch id={switchId} checked={onlyRelevant} onChange={setOnlyRelevant} label="Solo cuando regó o hubo un problema" />
      </div>

      {!hasAny ? (
        <EmptyNote>Todavía no hay decisiones registradas. Se guardan con cada lectura nueva.</EmptyNote>
      ) : runs.length === 0 ? (
        <EmptyNote>En las últimas 48 h no regó ni hubo problemas.</EmptyNote>
      ) : (
        <ul className="thin-scroll max-h-[22rem] divide-y divide-line overflow-y-auto rounded-control border border-line">
          {runs.map((run) => {
            const v = view(run);
            const h = humidity(run);
            return (
              <li key={`${run.from}-${run.reason}`} className="flex min-w-0 items-start gap-3 px-4 py-3">
                <HugeiconsIcon icon={v.icon} size={16} aria-hidden className={cn('mt-1 shrink-0', v.tone)} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px]">
                    <span className="sr-only">{v.kind}: </span>
                    <span className="font-medium">{reasonLabel(run.reason)}</span>
                  </p>
                  <p className="text-sm text-ink-2 tabular-nums">
                    {range(run, now)}
                    <span className="text-ink-3"> · {plural(run.count, 'lectura', 'lecturas')}</span>
                    {h && <span className="text-ink-3"> · {h}</span>}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
