import { useState } from 'react';
import { formatAgo } from '@/core/format';
import { useAutomation, useDerived, useSnapshot } from '@/data/hooks';
import { ChartCarousel } from '@/features/chart/ChartCarousel';
import { MoistureChart } from '@/features/chart/MoistureChart';
import { AutomationStatus } from '@/features/irrigation/AutomationStatus';
import { IrrigationControl } from '@/features/irrigation/IrrigationControl';
import { WifiBanner } from '@/features/device/WifiGuide';
import { NeedsWaterBanner } from '@/features/irrigation/NeedsWaterBanner';
import { MoistureCard } from '@/features/moisture/MoistureCard';
import { SettingsDialog, type TabId } from '@/features/settings/SettingsDialog';
import { LastWatering, OperationMode, WeeklyWatering } from '@/features/summary/SummaryCards';
import { Header } from './Header';
import { HugeiconsIcon } from '@hugeicons/react';
import { AlertDiamondIcon } from '@hugeicons/core-free-icons';

export function Dashboard() {
  const snapshot = useSnapshot();
  const { reading } = useDerived();
  const auto = useAutomation();
  // Mientras llegan los datos se usa el estado de carga de la tarjeta; ya con datos, solo con el automático prendido.
  const showRiego = auto.loading || auto.show.waterNow;
  const [settings, setSettings] = useState<{ open: boolean; tab: TabId }>({ open: false, tab: 'automation' });
  const openSettings = (tab: TabId = 'automation') => setSettings({ open: true, tab });

  const chart = {
    readings: snapshot.readings,
    events: snapshot.events,
    now: snapshot.now,
    threshold: snapshot.settings.thresholdPct,
    readEveryMin: snapshot.device.readEveryMin,
    loading: snapshot.load === 'loading',
  };

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 py-6 sm:px-8 sm:py-9">
      <Header onOpenSettings={openSettings} />

      {snapshot.error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-control border border-alert/35 bg-alert/10 px-4 py-3 text-[15px]"
        >
          <HugeiconsIcon icon={AlertDiamondIcon} size={18} aria-hidden className="mt-0.5 shrink-0 text-alert" />
          <p>
            <span className="font-medium">{snapshot.error}</span>{' '}
            <span className="text-ink-2">
              Estás viendo los últimos datos conocidos
              {reading ? ` (${formatAgo(snapshot.now - reading.t)})` : ''} y no se puede regar ni cambiar ajustes hasta
              que vuelva la conexión.
            </span>
          </p>
        </div>
      )}

      <WifiBanner />

      <NeedsWaterBanner />

      <main className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Sin tarjeta de riego (manual), la humedad ocupa todo el ancho: no queda ningún hueco. */}
        <MoistureCard className={showRiego ? undefined : 'lg:col-span-2'} />
        {showRiego && (
          <div className="grid min-w-0 grid-cols-2 gap-3 lg:flex lg:flex-col lg:gap-5 [&>*:only-child]:col-span-2 lg:[&>*:only-child]:flex-1">
            <IrrigationControl />
            {auto.show.nextWatering && <AutomationStatus onOpenSettings={openSettings} className="flex-1" />}
          </div>
        )}

        <ChartCarousel labels={['Últimas 24 horas', 'Últimos 7 días']}>
          <MoistureChart title="Últimas 24 horas" range="24h" {...chart} />
          <MoistureChart title="Últimos 7 días" range="7d" {...chart} />
        </ChartCarousel>
      </main>

      <section
        aria-label="Resumen"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1"
      >
        <WeeklyWatering />
        <LastWatering />
        <OperationMode />
      </section>

      <SettingsDialog
        open={settings.open}
        tab={settings.tab}
        onTab={(tab) => setSettings({ open: true, tab })}
        onClose={() => setSettings((s) => ({ ...s, open: false }))}
      />
    </div>
  );
}
