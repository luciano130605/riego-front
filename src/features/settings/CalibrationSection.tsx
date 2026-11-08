import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CHART_POINTS, lastSamples, MIN_SPAN, previewPercent, STABLE_RANGE } from '@/core/calibration';
import { CAL, SENSOR_STATE } from '@/core/copy';
import { num } from '@/core/format';
import { sensorViewOf, type SensorView } from '@/core/deviceView';
import type { Settings } from '@/core/types';
import { useDerived, useRiegoApi, useSnapshot } from '@/data/hooks';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { Stepper } from '@/ui/Stepper';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  LoaderIcon,
  WifiOff01Icon,
} from '@hugeicons/core-free-icons';
import { CalibrationFlow, type FlowState } from './calibrationFlow';
import { SettingRow, SettingsSection } from './SettingRow';

type Props = { save: (patch: Partial<Settings>, okMessage?: string) => Promise<boolean> };

const NO_SUBSCRIBE = () => () => {};
const NO_STATE = () => null;

/** El estado del controlador, o null mientras no se empezó ninguna calibración. */
function useFlowState(flow: CalibrationFlow | null): FlowState | null {
  return useSyncExternalStore(flow ? flow.subscribe : NO_SUBSCRIBE, flow ? flow.getState : NO_STATE, NO_STATE);
}

const clock = (ms: number): string => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Calibración del sensor, en Configuración → Dispositivo. Empieza y termina con un botón (con el estado a la vista),
 * muestra el valor crudo en vivo, guía dos pasos (seco al aire, mojado en agua) y, antes de guardar, el resultado con
 * una vista previa y avisos si el rango es muy chico o los valores están invertidos. Al salir de la pantalla corta
 * la calibración.
 */
export function CalibrationSection({ save }: Props) {
  const api = useRiegoApi();
  const snapshot = useSnapshot();
  const { reporting } = useDerived();
  const { device, settings: s } = snapshot;
  const [flow, setFlow] = useState<CalibrationFlow | null>(null);
  const st = useFlowState(flow);

  // Al desmontar (cerrar Configuración o cambiar de pestaña) la calibración se corta.
  useEffect(() => () => flow?.dispose(), [flow]);

  const start = () => {
    const f = new CalibrationFlow(api);
    setFlow(f);
    f.start();
  };

  const running = st?.phase === 'running';
  const starting = st?.phase === 'starting' || st?.phase === 'idle';
  const ended = st?.phase === 'ended';
  const failed = st?.phase === 'error';

  const blocked = snapshot.error ? CAL.blockedServer : !reporting && !running ? CAL.blockedBoard : undefined;

  const status: { icon: IconSvgElement; tone: string; text: string } = running
    ? { icon: LoaderIcon, tone: 'text-accent', text: CAL.running(clock(st.remainingMs)) }
    : starting && st
      ? { icon: LoaderIcon, tone: 'text-ink-2', text: CAL.starting }
      : failed
        ? { icon: Alert02Icon, tone: 'text-alert', text: CAL.startFailed(st.problem ?? '') }
        : ended
          ? {
              icon: CheckmarkCircle02Icon,
              tone: st.end === 'saved' ? 'text-ok' : 'text-ink-2',
              text: st.end === 'saved' ? CAL.endedSaved : st.end === 'timeout' ? CAL.endedTimeout : CAL.endedFinished,
            }
          : { icon: Clock01Icon, tone: 'text-ink-2', text: CAL.idle };

  // El estado del sensor lo dice el servidor; acá no se mira el valor crudo para decidirlo.
  const sensor = sensorViewOf(device);
  const sensorFault = sensor.kind === 'fault' || sensor.kind === 'saturated';

  return (
    <SettingsSection title={CAL.section}>
      <p className="pb-4 text-sm text-ink-2">{CAL.intro}</p>

      <SettingRow
        label={CAL.label}
        hint={
          <>
            <span role="status" aria-live="polite" className={cn('flex items-start gap-2 font-medium', status.tone)}>
              <HugeiconsIcon
                icon={status.icon}
                size={16}
                aria-hidden
                className={cn('mt-0.5 shrink-0', (running || starting) && 'motion-safe:animate-spin')}
              />
              <span className="min-w-0">{status.text}</span>
            </span>
            {blocked && !running && <span className="mt-1.5 block">{blocked}</span>}
            {!running && !blocked && sensorFault && <span className="mt-1.5 block text-alert">{CAL.faultBefore}</span>}
          </>
        }
      >
        {running ? (
          <Button variant="ghost" onClick={() => void flow?.finish()}>
            {CAL.finish}
          </Button>
        ) : (
          <Button variant="primary" disabled={!!blocked || starting} onClick={start}>
            {ended || failed ? CAL.again : CAL.start}
          </Button>
        )}
      </SettingRow>

      {running && <Running st={st} flow={flow!} onSave={(patch) => save(patch, CAL.saved)} sensor={sensor} />}

      <h4 className="mt-5 mb-1 text-sm font-semibold text-ink-2">{CAL.storedValues}</h4>
      <SettingRow label={CAL.storedDry} hint={CAL.storedDryHint}>
        <Stepper
          label="valor crudo en seco"
          display={`${s.rawDry}`}
          value={s.rawDry}
          min={s.rawWet + MIN_SPAN}
          max={4000}
          step={50}
          onChange={(rawDry) => void save({ rawDry })}
        />
      </SettingRow>
      <SettingRow label={CAL.storedWet} hint={CAL.storedWetHint}>
        <Stepper
          label="valor crudo en mojado"
          display={`${s.rawWet}`}
          value={s.rawWet}
          min={500}
          max={s.rawDry - MIN_SPAN}
          step={50}
          onChange={(rawWet) => void save({ rawWet })}
        />
      </SettingRow>
    </SettingsSection>
  );
}

function Running({
  st,
  flow,
  onSave,
  sensor,
}: {
  st: FlowState;
  flow: CalibrationFlow;
  onSave: (patch: { rawDry: number; rawWet: number }) => Promise<boolean>;
  sensor: SensorView;
}) {
  const { stable, have, need, range } = st.stability;
  const faulty = sensor.kind === 'fault' || sensor.kind === 'saturated';
  // Sin lecturas de la placa o con el sensor fallando no se puede fijar nada: el valor no sirve.
  const canCapture = stable && !faulty && !st.waiting;

  const stab: { icon: IconSvgElement; tone: string; text: string; spin?: boolean } = stable
    ? { icon: CheckmarkCircle02Icon, tone: 'text-ok', text: CAL.stable }
    : have < need
      ? { icon: Clock01Icon, tone: 'text-ink-2', text: CAL.gathering(have, need) }
      : { icon: LoaderIcon, tone: 'text-ink-2', text: CAL.moving(range ?? 0), spin: true };

  return (
    <div className="mt-3 border-t border-line pt-4">
      {st.waiting && (
        <Notice icon={WifiOff01Icon} tone="alert" className="mb-3">
          {CAL.waiting}
        </Notice>
      )}
      {faulty && (
        <Notice icon={Alert02Icon} tone="alert" className="mb-3">
          {sensor.kind === 'saturated' ? (
            SENSOR_STATE.saturated
          ) : (
            <>
              <span className="font-medium">{SENSOR_STATE.fault}</span>
              {sensor.kind === 'fault' && sensor.reason ? `: ${SENSOR_STATE.reason[sensor.reason].toLowerCase()}` : ''}.
            </>
          )}{' '}
          {CAL.faultNow}
        </Notice>
      )}

      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-ink-3">{CAL.live}</p>
          <p className="text-5xl leading-none font-semibold tracking-tight tabular-nums">
            {st.lastRaw === null ? <span className="text-3xl font-medium text-ink-3">Sin dato</span> : st.lastRaw}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Sparkline values={st.recent} />
          <p className="mt-1 text-xs text-ink-3">{CAL.chart}</p>
        </div>
      </div>
      <p role="status" aria-live="polite" className={cn('mt-3 flex items-center gap-2 text-[15px] font-medium', stab.tone)}>
        <HugeiconsIcon icon={stab.icon} size={18} aria-hidden className={cn('shrink-0', stab.spin && 'motion-safe:animate-spin')} />
        {stab.text}
      </p>
      <p className="mt-1 text-xs text-ink-3">{CAL.stableDef(need, STABLE_RANGE)}</p>

      <ol className="mt-5 space-y-4">
        <Step n={1} current={st.step === 'air'} done={st.rawDry !== null} title={CAL.step1} result={st.rawDry !== null ? CAL.capturedDry(st.rawDry) : undefined}>
          <Button onClick={() => flow.useAsDry()} disabled={!canCapture}>
            {CAL.fixDry}
          </Button>
        </Step>
        <Step n={2} current={st.step === 'water'} done={st.rawWet !== null} title={CAL.step2} result={st.rawWet !== null ? CAL.capturedWet(st.rawWet) : undefined}>
          <Button onClick={() => flow.useAsWet()} disabled={!canCapture}>
            {CAL.fixWet}
          </Button>
        </Step>
      </ol>

      {st.problem && st.step !== 'review' && (
        <Notice icon={Alert02Icon} tone="alert" className="mt-4">
          {st.problem}
        </Notice>
      )}

      {st.step === 'review' && st.rawDry !== null && st.rawWet !== null && (
        <Result st={st} flow={flow} onSave={onSave} faulty={faulty} />
      )}
    </div>
  );
}

function Result({
  st,
  flow,
  onSave,
  faulty,
}: {
  st: FlowState;
  flow: CalibrationFlow;
  onSave: (patch: { rawDry: number; rawWet: number }) => Promise<boolean>;
  faulty: boolean;
}) {
  const { rawDry, rawWet, lastRaw, check } = st;
  if (rawDry === null || rawWet === null) return null;
  const valid = check?.ok === true;
  const pct = valid && lastRaw !== null && !faulty ? `${num(previewPercent(lastRaw, rawDry, rawWet), 1)} %` : 'Sin dato';
  return (
    <section aria-label={CAL.result} className="mt-5 border-t border-line pt-4">
      <h4 className="text-sm font-semibold text-ink-2">{CAL.result}</h4>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <Fact label={CAL.dry} value={String(rawDry)} />
        <Fact label={CAL.wet} value={String(rawWet)} />
        <Fact label={CAL.span} value={String(rawDry - rawWet)} hint={CAL.minSpan(MIN_SPAN)} bad={!valid} />
      </dl>
      {check && !check.ok ? (
        <Notice icon={Alert02Icon} tone="alert" className="mt-4">
          {check.error}
        </Notice>
      ) : null}
      <p className="mt-4 text-[15px]">{CAL.preview(lastRaw, pct)}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => flow.restart()} disabled={st.saving}>
          {CAL.repeat}
        </Button>
        <Button variant="primary" onClick={() => void flow.save(onSave)} disabled={st.saving || !valid}>
          {st.saving && <HugeiconsIcon icon={LoaderIcon} size={16} aria-hidden className="motion-safe:animate-spin" />}
          {st.saving ? CAL.saving : CAL.save}
        </Button>
      </div>
    </section>
  );
}

function Fact({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={cn('text-xl font-semibold tabular-nums', bad && 'text-alert')}>{value}</dd>
      {hint && <dd className="text-xs text-ink-3">{hint}</dd>}
    </div>
  );
}

function Step({
  n,
  current,
  done,
  title,
  result,
  children,
}: {
  n: number;
  current: boolean;
  done: boolean;
  title: string;
  result?: string;
  children: ReactNode;
}) {
  return (
    <li className={cn('flex gap-3', !current && !done && 'opacity-60')}>
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
          done ? 'border-ok text-ok' : current ? 'border-accent text-accent' : 'border-line text-ink-3',
        )}
      >
        {done ? <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} aria-hidden /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">{title}</p>
        {result && <p className="mt-0.5 text-sm text-ink-2 tabular-nums">{result}</p>}
        {current && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

function Notice({
  icon,
  tone,
  className,
  children,
}: {
  icon: IconSvgElement;
  tone: 'alert' | 'muted';
  className?: string;
  children: ReactNode;
}) {
  return (
    <p role={tone === 'alert' ? 'alert' : 'status'} className={cn('flex items-start gap-2 text-sm', className)}>
      <HugeiconsIcon icon={icon} size={16} aria-hidden className={cn('mt-0.5 shrink-0', tone === 'alert' ? 'text-alert' : 'text-ink-2')} />
      <span className="min-w-0 text-ink">{children}</span>
    </p>
  );
}

/** Mini gráfico de las últimas lecturas (2 minutos). Es solo un dibujo: el número y el estado están en texto. */
function Sparkline({ values }: { values: number[] }) {
  const pts = lastSamples(values, CHART_POINTS);
  if (pts.length < 2) return <div aria-hidden className="h-14 w-28 rounded-md border border-dashed border-line sm:w-44" />;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = Math.max(hi - lo, 40); // un valor casi quieto se ve como una línea casi plana, no como ruido
  const mid = (hi + lo) / 2;
  const W = 176;
  const H = 56;
  const d = pts
    .map((v, i) => `${i ? 'L' : 'M'}${(((i + CHART_POINTS - pts.length) / (CHART_POINTS - 1)) * W).toFixed(1)},${(H / 2 - ((v - mid) / span) * (H - 8)).toFixed(1)}`)
    .join('');
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} className="h-14 w-28 overflow-visible sm:w-44">
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
