import { lastReadingText } from '@/core/plants';
import { plantHref } from '@/core/route';
import type { PlantView } from '@/core/types';
import { cn } from '@/lib/cn';
import { StatusBadge } from './StatusBadge';

/**
 * La tarjeta de una planta: nombre, humedad, estado y hace cuánto fue la última lectura. Sin sensor no muestra humedad
 * ni umbral: solo dice "Sin sensor". Tocarla abre su detalle.
 */
export function PlantCard({ plant, now }: { plant: PlantView; now: number }) {
  const noSensor = plant.status === 'no-sensor';
  const last = lastReadingText(plant, now);
  return (
    <a
      href={plantHref(plant.id)}
      className="block min-w-0 rounded-card border border-line bg-card p-4 shadow-card transition-colors duration-150 hover:border-[#3a3a3a] focus-visible:border-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-[17px] leading-tight font-semibold">{plant.name}</h3>
        <StatusBadge status={plant.status} />
      </div>
      {noSensor ? (
        <p className="mt-4 text-[22px] leading-none font-semibold text-ink-2">Sin sensor</p>
      ) : (
        <p className={cn('mt-3 text-4xl leading-none font-semibold tabular-nums', plant.moisture === null && 'text-ink-3')}>
          {plant.moisture === null ? '—' : Math.round(plant.moisture)}
          <span className="ml-1 text-lg font-medium text-ink-2">%</span>
        </p>
      )}
      {last && <p className="mt-2 text-sm text-ink-3">{last}</p>}
    </a>
  );
}
