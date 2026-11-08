import { useMemo } from 'react';
import { dayAndTime, num } from '@/core/format';
import { isSaneRaw } from '@/core/moisture';
import type { Reading } from '@/core/types';
import { EmptyNote } from './Section';

/** Lecturas de las últimas 24 h con su valor crudo (venía de la pestaña Historial). */
export function Readings24h({ readings, now }: { readings: Reading[]; now: number }) {
  const rows = useMemo(
    () => readings.filter((r) => r.t >= now - 24 * 3_600_000 && r.t <= now).sort((a, b) => b.t - a.t),
    [readings, now],
  );

  if (rows.length === 0) return <EmptyNote>No hay lecturas en las últimas 24 horas.</EmptyNote>;

  return (
    <div className="thin-scroll max-h-[22rem] overflow-auto rounded-control border border-line">
      <table className="w-full border-collapse text-sm tabular-nums">
        <caption className="sr-only">Lecturas de humedad de las últimas 24 horas</caption>
        <thead className="sticky top-0 bg-raised text-left text-ink-2">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Momento
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Humedad
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              Valor crudo
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.t}>
              <th scope="row" className="px-4 py-2 text-left font-normal text-ink-2">
                {dayAndTime(r.t, now)}
              </th>
              <td className="px-4 py-2 text-right">
                {isSaneRaw(r.raw) ? `${num(r.moisture, 1)} %` : <span className="text-ink-3">Sin dato</span>}
              </td>
              <td className="px-4 py-2 text-right text-ink-2">{r.raw}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
