import { useMemo, useState } from 'react';
import { computeStats, type Period, type StatsInput } from '@/core/stats';
import { useDerived, useSnapshot } from '@/data/hooks';
import { CyclesList } from '@/features/wateringData/CyclesList';
import { DailyBars } from '@/features/wateringData/DailyBars';
import { DecisionsLog } from '@/features/wateringData/DecisionsLog';
import { Readings24h } from '@/features/wateringData/Readings24h';
import { RelayTest } from '@/features/wateringData/RelayTest';
import { PeriodSelect, Section } from '@/features/wateringData/Section';
import { StatsSummary } from '@/features/wateringData/StatsSummary';
import { Skeleton } from '@/ui/Skeleton';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Clock01Icon } from '@hugeicons/core-free-icons';

/**
 * "Datos de riego": probar el regador, resumen del período, lista de riegos, decisiones del
 * automático y riegos por día. Absorbe lo que mostraba la pestaña Historial (la tabla de
 * lecturas de 24 h); la actividad y los riegos ahora salen de la lista de riegos y de las decisiones.
 */
export function WateringDataTab() {
  const snapshot = useSnapshot();
  const { stale } = useDerived();
  const [period, setPeriod] = useState<Period>('7d');

  const input = useMemo<StatsInput>(
    () => ({
      readings: snapshot.readings,
      events: snapshot.events,
      settings: snapshot.settings,
      readEveryMin: snapshot.device.readEveryMin,
      now: snapshot.now,
    }),
    [snapshot.readings, snapshot.events, snapshot.settings, snapshot.device.readEveryMin, snapshot.now],
  );
  const stats = useMemo(() => computeStats(input, period), [input, period]);

  if (snapshot.load === 'loading') return <TabSkeleton />;

  return (
    <div>
      {(snapshot.error || stale) && (
        <p
          role="status"
          className="mb-6 flex items-start gap-2 rounded-control border border-line px-4 py-3 text-sm text-ink-2"
        >
          <HugeiconsIcon
            icon={snapshot.error ? Alert02Icon : Clock01Icon}
            size={16}
            aria-hidden
            className={snapshot.error ? 'mt-0.5 shrink-0 text-alert' : 'mt-0.5 shrink-0'}
          />
          {snapshot.error
            ? 'No se pudo hablar con el servidor. Se muestran los últimos datos conocidos y pueden estar desactualizados.'
            : 'La última lectura es vieja, así que los datos pueden estar desactualizados.'}
        </p>
      )}

      <Section title="Probar el regador">
        <RelayTest />
      </Section>

      <Section title="Resumen" aside={<PeriodSelect value={period} onChange={setPeriod} />}>
        <StatsSummary stats={stats} thresholdPct={snapshot.settings.thresholdPct} />
      </Section>

      <Section title="Riegos">
        <CyclesList input={input} />
      </Section>

      <Section title="Decisiones recientes (48 h)">
        <DecisionsLog readings={snapshot.readings} now={snapshot.now} />
      </Section>

      <Section title="Riegos por día" aside={<PeriodSelect value={period} onChange={setPeriod} />}>
        <DailyBars input={input} period={period} />
      </Section>

      <Section title="Lecturas de 24 h">
        <Readings24h readings={snapshot.readings} now={snapshot.now} />
      </Section>

      <p className="mt-6 text-xs text-ink-3">
        Solo figura lo que se midió o se hizo de verdad. Si faltan lecturas, no se completan.
        {snapshot.isDemo ? ' Los datos de esta pantalla son de prueba.' : ''}
      </p>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div aria-busy="true" aria-label="Datos de riego">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-3 h-28 w-full" />
      <Skeleton className="mt-9 h-5 w-24" />
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </div>
  );
}
