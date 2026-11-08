import type { ReactNode } from 'react';
import { AVISO, automationState, modeDescription } from '@/core/copy';
import { dayLabel, num, timeHM } from '@/core/format';
import { useDerived, useSnapshot } from '@/data/hooks';
import { cn } from '@/lib/cn';
import { StatCard } from './StatCard';
import { ArrowDown02Icon, ArrowUp02Icon, Clock02Icon, Notification01Icon, SoilMoistureFieldIcon, WaterEnergyIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

/** "Riegos (7 días)": cuántos riegos hubo y cómo se compara con la semana anterior, si hay datos. */
export function WeeklyWatering() {
  const snapshot = useSnapshot();
  const { weekly } = useDerived();
  const { count, previous } = weekly;

  let detail: ReactNode;
  if (previous === null) {
    detail = 'Todavía no hay datos de la semana anterior';
  } else if (previous === 0) {
    detail = count === 0 ? 'Sin riegos en las dos semanas' : 'La semana anterior no hubo riegos';
  } else {
    const pct = Math.round(((count - previous) / previous) * 100);
    if (pct === 0) {
      detail = 'Igual que la semana anterior';
    } else {
      const Arrow = pct < 0 ? ArrowDown02Icon : ArrowUp02Icon;
      detail = (
        <>
          <HugeiconsIcon icon={Arrow} size={14} aria-hidden className="mr-1 inline align-[-2px]" />
          <span className="font-medium text-ink">{`${pct < 0 ? '−' : '+'}${num(Math.abs(pct))} %`}</span> vs. semana
          anterior
        </>
      );
    }
  }

  return (
    <StatCard
      loading={snapshot.load === 'loading'}
      icon={SoilMoistureFieldIcon}
      iconClass="text-accent"
      label="Riegos (7 días)"
      value={count}
      detail={detail}
    />
  );
}

/** "Último riego": cuándo fue, cuánto duró y si fue automático o a mano. */
export function LastWatering() {
  const snapshot = useSnapshot();
  const { lastCycle } = useDerived();

  if (!lastCycle) {
    return (
      <StatCard
        loading={snapshot.load === 'loading'}
        icon={Clock02Icon}
        label="Último riego"
        value={<span className="text-ink-3">Sin riegos</span>}
        detail="Todavía no se registró ninguno"
      />
    );
  }

  const stages = lastCycle.pulses > 1 ? ` en ${lastCycle.pulses} tandas` : '';
  const origin = lastCycle.source === 'auto' ? 'automático' : 'a mano';
  return (
    <StatCard
      loading={snapshot.load === 'loading'}
      icon={Clock02Icon}
      label="Último riego"
      value={`${dayLabel(lastCycle.start, snapshot.now)}, ${timeHM(lastCycle.start)}`}
      detail={`Duración: ${lastCycle.seconds} s${stages} · ${origin}`}
    />
  );
}

/** "Modo": si riega solo o a mano, cómo lo hace y en qué está ahora. */
export function OperationMode() {
  const snapshot = useSnapshot();
  const { decision } = useDerived();
  const { auto } = snapshot.settings;
  const state = automationState(decision, auto);
  const { relayMode } = useDerived();

  if (relayMode === 'aviso') {
    // Sin regador conectado: no hay nada que "riegue solo", solo avisos.
    return (
      <StatCard
        loading={snapshot.load === 'loading'}
        icon={Notification01Icon}
        iconClass={auto ? 'text-ok' : 'text-ink-3'}
        label="Modo"
        value={auto ? AVISO.modeTitle : AVISO.modeOff}
        detail={
          <>
            {auto ? `Avisa cuando baje de ${snapshot.settings.thresholdPct} %. El riego es manual.` : 'El riego es manual.'}
            <span className="mt-1 flex items-center gap-1.5 text-ink-3">
              <span aria-hidden className={cn('size-1.5 rounded-full', auto ? 'bg-ok' : 'bg-[#5a5a5a]')} />
              {auto ? 'Atento a la humedad' : 'Avisos apagados'}
            </span>
          </>
        }
      />
    );
  }

  return (
    <StatCard
      loading={snapshot.load === 'loading'}
      icon={WaterEnergyIcon}
      iconClass={auto ? 'text-ok' : 'text-ink-3'}
      label="Modo"
      value={auto ? 'Automático' : 'Manual'}
      detail={
        <>
          {modeDescription(snapshot.settings)}
          <span className="mt-1 flex items-center gap-1.5 text-ink-3">
            <span
              aria-hidden
              className={cn('size-1.5 rounded-full', state.active ? 'bg-accent' : 'bg-[#5a5a5a]')}
            />
            {state.label}
          </span>
        </>
      }
    />
  );
}
