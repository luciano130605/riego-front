import { useMemo, useState } from 'react';
import { CYCLE_END_LABEL } from '@/core/copy';
import { dayAndTime, num } from '@/core/format';
import { cycleStats, type CycleEnd, type CycleStat, type StatsInput } from '@/core/stats';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  HandIcon,
  InformationCircleIcon,
  LoaderIcon,
  WaterEnergyIcon,
} from '@hugeicons/core-free-icons';
import { EmptyNote, plural } from './Section';

const PAGE = 20;

const END_VIEW: Record<CycleEnd, { icon: IconSvgElement; tone: string }> = {
  target: { icon: CheckmarkCircle02Icon, tone: 'text-ok' },
  limit: { icon: Alert02Icon, tone: 'text-alert' },
  'auto-off': { icon: InformationCircleIcon, tone: 'text-ink-2' },
  'in-progress': { icon: LoaderIcon, tone: 'text-accent' },
  unconfirmed: { icon: Clock01Icon, tone: 'text-ink-3' },
  manual: { icon: HandIcon, tone: 'text-ink-2' },
};

const pct = (n: number | null) => (n === null ? 'Sin dato' : `${num(n)} %`);

export function CyclesList({ input }: { input: StatsInput }) {
  const [shown, setShown] = useState(PAGE);
  const cycles = useMemo(() => cycleStats(input).reverse(), [input]);

  if (cycles.length === 0) {
    return (
      <EmptyNote>
        Todavía no hubo riegos. Van a aparecer acá cuando el automático riegue o cuando regues a mano con “Regar
        ahora”.
      </EmptyNote>
    );
  }

  const visible = cycles.slice(0, shown);
  return (
    <div>
      <ul className="flex flex-col gap-2 sm:gap-0 sm:divide-y sm:divide-line sm:rounded-control sm:border sm:border-line">
        {visible.map((c) => (
          <Row key={c.start} c={c} now={input.now} />
        ))}
      </ul>
      {cycles.length > shown && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
            Ver más ({cycles.length - shown} más)
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ c, now }: { c: CycleStat; now: number }) {
  const origin = c.source === 'auto' ? 'Automático' : 'Manual';
  const end = END_VIEW[c.end];
  return (
    <li
      className={cn(
        'grid min-w-0 gap-x-4 gap-y-1 text-[15px] max-sm:rounded-control max-sm:border max-sm:border-line max-sm:p-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center sm:px-4 sm:py-3',
      )}
    >
      <div className="min-w-0">
        <time className="font-medium tabular-nums" dateTime={new Date(c.start).toISOString()}>
          {dayAndTime(c.start, now)}
        </time>
        <p className="flex items-center gap-1.5 text-sm text-ink-2">
          <HugeiconsIcon icon={c.source === 'auto' ? WaterEnergyIcon : HandIcon} size={14} aria-hidden className="shrink-0" />
          {origin}
        </p>
      </div>
      <p className="min-w-0 tabular-nums">
        {num(c.seconds)} s
        <span className="text-ink-2"> · {plural(c.pulses, 'tanda', 'tandas')}</span>
      </p>
      <p className="min-w-0 tabular-nums">
        <span className="sr-only">Humedad de antes y de después: </span>
        {pct(c.before)} <span aria-hidden>→</span>
        <span className="sr-only"> a </span> {pct(c.after)}
      </p>
      <p className={cn('flex min-w-0 items-start gap-1.5 text-sm font-medium', end.tone)}>
        <HugeiconsIcon
          icon={end.icon}
          size={16}
          aria-hidden
          className={cn('mt-0.5 shrink-0', c.end === 'in-progress' && 'motion-safe:animate-spin')}
        />
        <span className="min-w-0">{CYCLE_END_LABEL[c.end]}</span>
      </p>
    </li>
  );
}
