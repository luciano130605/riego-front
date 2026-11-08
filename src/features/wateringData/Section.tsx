import type { ReactNode } from 'react';
import { PERIOD_LABEL } from '@/core/copy';
import { PERIODS, type Period } from '@/core/stats';
import { Segmented } from '@/ui/Segmented';

/** Bloque de la pestaña: título arriba (y, si hace falta, un control a la derecha) y el contenido. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-sm font-semibold text-ink-2">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Selector de período compartido por el resumen y el gráfico de riegos por día. */
export function PeriodSelect({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <Segmented
      label="Período"
      value={value}
      onChange={onChange}
      options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
    />
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-control border border-line px-4 py-6 text-center text-sm text-ink-2">{children}</p>;
}

export const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
