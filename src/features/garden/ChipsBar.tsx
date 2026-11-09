import type { SectorChip } from '@/core/plants';
import { cn } from '@/lib/cn';

type Props = { chips: SectorChip[]; selected: string; onSelect: (id: string) => void };

/** Chips para cambiar de sector: "Todos" y uno por sector, con cuántas plantas hay y cuántas necesitan agua. */
export function ChipsBar({ chips, selected, onSelect }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Sectores"
      className="thin-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      {chips.map((c) => {
        const on = c.id === selected;
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(c.id)}
            className={cn(
              'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] font-medium transition-colors duration-150',
              on ? 'border-accent bg-accent/10 text-ink' : 'border-line text-ink-2 hover:border-[#3a3a3a] hover:text-ink',
            )}
          >
            {c.label}
            <span className="text-sm font-normal text-ink-3 tabular-nums">{c.count}</span>
            {c.needWater > 0 && (
              <span
                className="rounded-full bg-alert/15 px-1.5 text-xs font-semibold text-alert tabular-nums"
                title={`${c.needWater} ${c.needWater === 1 ? 'necesita' : 'necesitan'} agua`}
              >
                {c.needWater}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
