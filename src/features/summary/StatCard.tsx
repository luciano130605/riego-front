import type { ReactNode } from 'react';
import { Card } from '@/ui/Card';
import { Skeleton } from '@/ui/Skeleton';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';

type Props = {
  icon: IconSvgElement;
  iconClass?: string;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  loading?: boolean;
};

/** Tarjeta chica de resumen: ícono y rótulo, un valor grande y una línea de detalle. */
export function StatCard({ icon: Icon, iconClass = 'text-ink-2', label, value, detail, loading }: Props) {
  if (loading) {
    return (
      <Card aria-busy="true" aria-label={label} className="flex flex-col gap-2 p-4 md:flex-row md:gap-4 md:p-5">
        <Skeleton className="size-6" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-44 max-w-full" />
        </div>
      </Card>
    );
  }
  return (
    <Card aria-label={label} className="flex flex-col gap-2 p-4 md:flex-row md:gap-4 md:p-5">
      <HugeiconsIcon icon={Icon} size={24} strokeWidth={1.6} aria-hidden className={`mt-0.5 shrink-0 ${iconClass}`} />
      <div className="min-w-0">
        <h2 className="text-[15px] font-medium text-ink">{label}</h2>
        <p className="mt-1 text-2xl leading-tight font-semibold tracking-tight tabular-nums md:text-[28px]">{value}</p>
        <p className="mt-1 text-sm text-ink-2">{detail}</p>
      </div>
    </Card>
  );
}
