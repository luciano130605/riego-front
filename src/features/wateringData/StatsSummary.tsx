import type { ReactNode } from 'react';
import { formatDuration, num } from '@/core/format';
import type { Stats } from '@/core/stats';
import { SwipePager } from '@/ui/SwipePager';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { plural } from './Section';

type TileProps = {
  label: string;
  /** null = no hay datos suficientes: se muestra "Sin dato" y el motivo en `detail`. */
  value: ReactNode | null;
  detail: ReactNode;
  alert?: boolean;
};

/** Tarjeta chica: rótulo, valor grande y una línea de aclaración. */
function Tile({ label, value, detail, alert }: TileProps) {
  return (
    <dl className="m-0 min-w-0 rounded-control border border-line px-3 py-3 md:px-4">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="mt-1 min-w-0">
        <p className="flex flex-wrap items-center gap-x-1.5 text-2xl leading-tight font-semibold tracking-tight tabular-nums">
          {alert && <HugeiconsIcon icon={Alert02Icon} size={18} aria-hidden className="shrink-0 text-alert" />}
          {value === null ? <span className="text-lg font-medium text-ink-3">Sin dato</span> : value}
        </p>
        <p className="mt-0.5 text-xs text-ink-3">{detail}</p>
      </dd>
    </dl>
  );
}

const unit = (n: string, u: string) => (
  <>
    {n} <span className="text-sm font-medium text-ink-2 md:text-base">{u}</span>
  </>
);

type Props = { stats: Stats; thresholdPct: number };

/** Cuántas tarjetas entran en una página de mobile (2 × 2). */
const PER_PAGE = 4;
const PAGE_LABELS = ['Riegos y humedad', 'Subida, intervalo y secado', 'Seguridad'];

/**
 * Resumen del período. En mobile son páginas de 2 × 2 que se deslizan de costado (con puntitos); desde md es
 * una grilla de tres columnas con todas las tarjetas a la vista.
 */
export function StatsSummary({ stats: s, thresholdPct }: Props) {
  const noRiegos = s.count === 0;

  const tiles: ReactNode[] = [
    <Tile
      key="count"
      label="Riegos"
      value={num(s.count)}
      detail={
        noRiegos
          ? 'Ninguno en este período'
          : `${plural(s.auto, 'automático', 'automáticos')} · ${plural(s.manual, 'manual', 'manuales')}`
      }
    />,
    <Tile
      key="pump"
      label="Bomba prendida"
      value={unit(num(s.pumpSeconds), 's')}
      detail={s.avgPumpSeconds === null ? 'Sin riegos para promediar' : `Promedio ${num(s.avgPumpSeconds, 1)} s por riego`}
    />,
    <Tile
      key="pulses"
      label="Tandas por riego"
      value={s.avgPulses === null ? null : num(s.avgPulses, 1)}
      detail={s.avgPulses === null ? 'Hacen falta riegos' : 'Promedio'}
    />,
    <Tile
      key="moisture"
      label="Humedad"
      value={s.moisture === null ? null : unit(num(s.moisture.avg, 1), '%')}
      detail={
        s.moisture === null ? 'Sin lecturas válidas' : `Mín. ${num(s.moisture.min, 1)} % · máx. ${num(s.moisture.max, 1)} %`
      }
    />,
    <Tile
      key="rise"
      label="Subida por riego"
      value={s.avgRise === null ? null : unit(`${s.avgRise >= 0 ? '+' : '−'}${num(Math.abs(s.avgRise), 1)}`, 'puntos')}
      detail={riseDetail(s)}
    />,
    <Tile
      key="interval"
      label="Entre riegos"
      value={s.avgIntervalHours === null ? null : formatDuration(s.avgIntervalHours)}
      detail={s.avgIntervalHours === null ? 'Hacen falta 2 riegos' : 'Promedio entre un inicio y el siguiente'}
    />,
    <Tile
      key="dry"
      label="Ritmo de secado"
      value={s.dryPerDay === null ? null : unit(num(s.dryPerDay, 1), 'puntos/día')}
      detail={s.dryPerDay === null ? 'Faltan lecturas desde el último riego' : 'Desde el último riego'}
    />,
    <Tile
      key="range"
      label="Tiempo en rango"
      value={s.inRangePct === null ? null : unit(num(s.inRangePct), '%')}
      detail={s.inRangePct === null ? 'Sin lecturas válidas' : `Con la humedad sobre ${thresholdPct} %`}
    />,
    <Tile
      key="limit"
      label="Cortados por el tope"
      value={num(s.limitCuts)}
      alert={s.limitCuts > 0}
      detail={
        s.limitCuts > 0
          ? 'No llegó al objetivo: conviene revisar la bomba y el sensor'
          : noRiegos
            ? 'Sin riegos en este período'
            : 'Ningún riego se cortó'
      }
    />,
  ];

  const pages: ReactNode[] = [];
  for (let i = 0; i < tiles.length; i += PER_PAGE) {
    // `md:contents`: desde md la página "desaparece" y las tarjetas quedan como hijas directas de la grilla.
    pages.push(
      <div className="grid grid-cols-2 gap-3 md:contents [&>*:only-child]:col-span-2 md:[&>*:only-child]:col-span-1">
        {tiles.slice(i, i + PER_PAGE)}
      </div>,
    );
  }

  return (
    <SwipePager
      pages={pages}
      labels={PAGE_LABELS}
      ariaLabel="Resumen del período. Deslizá para ver más."
      className="md:grid md:grid-cols-3 md:gap-3 md:overflow-visible"
      pageClassName="basis-[92%] md:contents"
    />
  );
}

function riseDetail(s: Stats): string {
  if (s.avgRise !== null) {
    const base = `Promedio de ${plural(s.riseSamples, 'riego', 'riegos')}`;
    return s.inProgress > 0 ? `${base} · ${s.inProgress} en curso` : base;
  }
  if (s.inProgress > 0) return 'El riego en curso todavía no se puede medir';
  if (s.count === 0) return 'Sin riegos en este período';
  return 'Faltan lecturas de antes o de después';
}
