import { PLANT_STATUS } from '@/core/copy';
import type { PlantStatus } from '@/core/types';
import { cn } from '@/lib/cn';

const TONE: Record<PlantStatus, { dot: string; text: string }> = {
  ok: { dot: 'bg-ok', text: 'text-ok' },
  'needs-water': { dot: 'bg-alert', text: 'text-alert' },
  'no-data': { dot: 'bg-ink-3', text: 'text-ink-2' },
  'no-sensor': { dot: 'bg-ink-3', text: 'text-ink-2' },
};

/** El estado de una planta: la palabra siempre va con el punto, para que no dependa del color. */
export function StatusBadge({ status, className }: { status: PlantStatus; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-sm font-medium', TONE[status].text, className)}>
      <span aria-hidden className={cn('size-2 rounded-full', TONE[status].dot)} />
      {PLANT_STATUS[status]}
    </span>
  );
}
