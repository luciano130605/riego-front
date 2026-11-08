import { AVISO, nextAlertCopy, nextWateringCopy } from '@/core/copy';
import { formatDuration } from '@/core/format';
import { useDerived, useSnapshot } from '@/data/hooks';
import { cn } from '@/lib/cn';
import type { TabId } from '@/features/settings/SettingsDialog';
import { Skeleton } from '@/ui/Skeleton';
import { HugeiconsIcon } from '@hugeicons/react';
import { CalendarClockIcon, ChevronRightIcon } from '@hugeicons/core-free-icons';

type Props = { onOpenSettings: (tab?: TabId) => void; className?: string };

export function AutomationStatus({ onOpenSettings, className }: Props) {
  const snapshot = useSnapshot();
  const derived = useDerived();

  const base = cn(
    'group flex w-full flex-col items-start gap-2 rounded-card border border-line bg-card p-4 text-left shadow-card lg:flex-row lg:items-center lg:gap-4 lg:p-5 transition-colors duration-150 hover:border-[#3a3a3a] hover:bg-raised',
    className,
  );

  if (snapshot.load === 'loading') {
    return (
      <div aria-busy="true" className={base}>
        <Skeleton className="size-6" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-60 max-w-full" />
        </div>
      </div>
    );
  }

  const aviso = derived.relayMode === 'aviso';
  const copy = aviso
    ? nextAlertCopy({
        decision: derived.decision,
        forecast: derived.forecast,
        settings: snapshot.settings,
        now: snapshot.now,
      })
    : nextWateringCopy({
        decision: derived.decision,
        forecast: derived.forecast,
        openCycle: derived.openCycle,
        settings: snapshot.settings,
        now: snapshot.now,
      });
  const untilNext = derived.nextReadingAt - snapshot.now;
  const waiting =
    snapshot.settings.auto && !snapshot.error && derived.reporting
      ? untilNext > 0
        ? `Próxima lectura en ${formatDuration(untilNext / 3_600_000)}.`
        : 'Esperando la próxima lectura.'
      : undefined;

  return (
    <button type="button" onClick={() => onOpenSettings('automation')} className={base}>
      <HugeiconsIcon icon={CalendarClockIcon} size={24} aria-hidden strokeWidth={1.6} className="shrink-0 text-ink-2" />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{aviso ? AVISO.cardTitle : 'Próximo riego (automático)'}</span>
        <span className="mt-1 block text-[15px] text-ink">{copy.headline}</span>
        <span className="mt-0.5 block text-sm text-ink-2">
          {copy.detail}
          {waiting && <span className="text-ink-3"> {waiting}</span>}
        </span>
      </span>
      <HugeiconsIcon
      icon={ChevronRightIcon}
        size={20}
        aria-hidden
        className="hidden shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink lg:block"
      />
      <span className="sr-only">{aviso ? 'Abrir la configuración de los avisos' : 'Abrir la configuración de la automatización'}</span>
    </button>
  );
}
