import { useCallback, useEffect, useRef, useState } from 'react';
import { rssiQuality } from '@/core/format';
import type { RelayStatus } from '@/data/api';
import { AVISO } from '@/core/copy';
import { useDerived, useRiegoApi, useSnapshot } from '@/data/hooks';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Segmented } from '@/ui/Segmented';
import { needsLinking } from '@/core/ewelink';
import { requestSettings } from '@/features/settings/settingsRequest';
import { useEwelinkStatus } from '@/features/settings/useEwelinkStatus';
import { Skeleton } from '@/ui/Skeleton';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  DropletIcon,
  LoaderIcon,
  PauseIcon,
  PlayIcon,
} from '@hugeicons/core-free-icons';

const OPTIONS = [2, 5, 10];
/** Después de la cuenta regresiva, cuánto se espera a que el regador confirme que se apagó. */
const VERIFY_TRIES = 6;
const VERIFY_EVERY_MS = 1500;

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'running'; endsAt: number }
  | { kind: 'verifying' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

type StatusState = { kind: 'loading' } | { kind: 'ready'; status: RelayStatus };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Por qué el botón está deshabilitado, si lo está. */
function blockedReason(status: RelayStatus, apiDown: boolean): string | null {
  if (apiDown) return 'No hay conexión con el servidor.';
  if (!status.ok) return null; // se explica arriba, en el aviso de "desconectado"
  if (status.simulated) {
    return 'El servidor está en modo aviso: todavía no hay un regador conectado, así que no se puede probar. Se activa cuando se conecte.';
  }
  if (!status.online) return 'El regador no responde. Revisá que el Sonoff tenga wifi y corriente.';
  if (status.on) return 'El regador está prendido ahora. Esperá a que se apague para probarlo.';
  return null;
}

/** Datos del Sonoff que informa el servidor. Solo se muestra lo que llega: nada se inventa. */
function deviceRows(status: RelayStatus): { label: string; value: string }[] {
  if (!status.ok) return [];
  const rows: { label: string; value: string }[] = [];
  if (status.simulated) rows.push({ label: 'Modo', value: 'Aviso (sin regador conectado)' });
  rows.push({ label: 'Conexión', value: status.online ? 'En línea' : 'Sin conexión' });
  rows.push({ label: 'Estado', value: status.on ? 'Prendido' : 'Apagado' });
  const d = status.device;
  if (d?.name) rows.push({ label: 'Equipo', value: d.name });
  if (d?.model) rows.push({ label: 'Modelo', value: d.model });
  if (d?.rssi !== undefined) rows.push({ label: 'Señal wifi', value: `${d.rssi} dBm · ${rssiQuality(d.rssi)}` });
  if (d?.firmware) rows.push({ label: 'Firmware', value: d.firmware });
  if (status.maxSeconds !== undefined) rows.push({ label: 'Tope por orden', value: `${status.maxSeconds} s` });
  return rows;
}

export function RelayTest() {
  const api = useRiegoApi();
  const snapshot = useSnapshot();
  const aviso = useDerived().relayMode === 'aviso';
  const ewelink = useEwelinkStatus().state;
  const [state, setState] = useState<StatusState>({ kind: 'loading' });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [seconds, setSeconds] = useState(2);
  const [confirm, setConfirm] = useState(false);
  const [left, setLeft] = useState(0);
  const alive = useRef(true);

  const loadStatus = useCallback(async () => {
    const status = await api.relayStatus();
    if (alive.current) setState({ kind: 'ready', status });
    return status;
  }, [api]);

  useEffect(() => {
    alive.current = true;
    void loadStatus();
    return () => {
      alive.current = false;
    };
  }, [loadStatus]);

  /** Confirma con el regador que de verdad volvió a apagado; no se da por hecho. */
  const verify = useCallback(async () => {
    setPhase({ kind: 'verifying' });
    let last: RelayStatus | undefined;
    for (let i = 0; i < VERIFY_TRIES; i++) {
      last = await loadStatus();
      if (!alive.current) return;
      if (last.ok && !last.on) {
        setPhase({ kind: 'done' });
        return;
      }
      await sleep(VERIFY_EVERY_MS);
      if (!alive.current) return;
    }
    const why = last && !last.ok ? last.error : 'Sigue prendido.';
    setPhase({ kind: 'error', message: `No se pudo confirmar que el regador se apagó. ${why} Revisá la bomba.` });
  }, [loadStatus]);

  // Cuenta regresiva mientras el regador está prendido; al terminar, se verifica.
  useEffect(() => {
    if (phase.kind !== 'running') return;
    const { endsAt } = phase;
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    const end = setTimeout(() => void verify(), Math.max(0, endsAt - Date.now()));
    return () => {
      clearInterval(id);
      clearTimeout(end);
    };
  }, [phase, verify]);

  async function start(secs: number) {
    setConfirm(false);
    setPhase({ kind: 'sending' });
    const res = await api.testRelay(secs);
    if (!alive.current) return;
    if (!res.ok) {
      setPhase({ kind: 'error', message: res.error });
      void loadStatus();
      return;
    }
    setPhase({ kind: 'running', endsAt: Date.now() + secs * 1000 });
  }

  if (state.kind === 'loading') {
    return (
      <div aria-busy="true" aria-label="Regador" className="rounded-control border border-line p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-24 w-full" />
        <Skeleton className="mt-3 h-11 w-full max-w-sm" />
      </div>
    );
  }

  const { status } = state;
  const maxSeconds = status.ok ? status.maxSeconds : undefined;
  const options = OPTIONS.filter((s) => maxSeconds === undefined || s <= maxSeconds);
  const chosen = options.includes(seconds) ? seconds : (options[0] ?? seconds);

  const working = phase.kind === 'sending' || phase.kind === 'running' || phase.kind === 'verifying';
  // En modo aviso no se espera un regador: se explica, sin marcarlo como una falla.
  const blocked = aviso ? AVISO.testBlocked : blockedReason(status, !!snapshot.error);
  const disabled = working || blocked !== null || options.length === 0 || !status.ok || aviso;
  const view = statusView(phase, left);
  const rows = deviceRows(status);
  const linkNotice = !aviso && status.ok && !status.online && !status.simulated && ewelink.phase === 'ready' && needsLinking(ewelink.status);

  return (
    <div className="rounded-control border border-line px-4 py-4">
      {!status.ok && !aviso && (
        <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-control border border-alert/40 bg-alert/10 px-4 py-3">
          <HugeiconsIcon icon={Alert02Icon} size={18} aria-hidden className="mt-0.5 shrink-0 text-alert" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Regador desconectado</p>
            <p className="mt-0.5 text-sm text-ink-2">{status.error}</p>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <dl className="mb-4 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm min-[480px]:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line py-1.5">
              <dt className="shrink-0 text-ink-2">{r.label}</dt>
              <dd className="min-w-0 truncate text-right font-medium tabular-nums" title={r.value}>
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <p className="text-sm text-ink-2">
        Prende la bomba unos segundos para ver que el regador responde. No cuenta como un riego ni cambia el historial.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <Segmented
          label="Segundos de la prueba"
          value={String(chosen)}
          onChange={(v) => setSeconds(Number(v))}
          options={options.map((s) => ({ value: String(s), label: `${s} s` }))}
        />
        <Button onClick={() => setConfirm(true)} disabled={disabled} className="min-h-12">
          <HugeiconsIcon icon={PlayIcon} size={18} aria-hidden />
          Probar regador
        </Button>
      </div>

      {/* Sin vincular eWeLink, "el regador no responde" no es una falla del equipo: falta vincular. Acceso directo a la sección. */}
      {linkNotice ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-control border border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Vincular eWeLink</p>
            <p className="text-sm text-ink-2">Para que el regador responda, hace falta vincular tu cuenta de eWeLink.</p>
          </div>
          <Button variant="primary" onClick={() => requestSettings({ tab: 'device', anchor: 'ewelink' })}>
            Vincular eWeLink
          </Button>
        </div>
      ) : (
        blocked && <p className="mt-3 text-sm text-ink-2">{blocked}</p>
      )}

      <p
        role="status"
        aria-live="polite"
        className={cn('mt-4 flex min-h-6 items-center gap-2 text-[15px] font-medium', view.tone)}
      >
        <HugeiconsIcon
          icon={view.icon}
          size={18}
          aria-hidden
          className={cn('shrink-0', view.spin && 'motion-safe:animate-spin')}
        />
        <span className="min-w-0">{view.text}</span>
        {phase.kind === 'running' && (
          <span aria-hidden className="ml-1 text-ink tabular-nums">
            {left} s
          </span>
        )}
      </p>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Probar el regador"
        description={`Esto prende la bomba ${chosen} segundos.`}
        className="w-[min(28rem,calc(100%-1.5rem))]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void start(chosen)}>
              Prender {chosen} s
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-2">Asegurate de que la manguera apunte a la maceta o a un balde.</p>
      </Dialog>
    </div>
  );
}

function statusView(phase: Phase, left: number): { icon: IconSvgElement; text: string; tone: string; spin?: boolean } {
  switch (phase.kind) {
    case 'idle':
      return { icon: PauseIcon, text: 'Inactivo', tone: 'text-ink-2' };
    case 'sending':
      return { icon: LoaderIcon, text: 'Enviando la orden…', tone: 'text-ink', spin: true };
    case 'running':
      // El número que cambia cada segundo es solo visual; lo que anuncia el lector de pantalla no cambia.
      return { icon: DropletIcon, text: left > 0 ? 'Regando' : 'Terminando', tone: 'text-accent' };
    case 'verifying':
      return { icon: LoaderIcon, text: 'Confirmando que se apagó…', tone: 'text-ink', spin: true };
    case 'done':
      return { icon: CheckmarkCircle02Icon, text: 'Listo. El regador volvió a apagado.', tone: 'text-ok' };
    case 'error':
      return { icon: Alert02Icon, text: phase.message, tone: 'text-alert' };
  }
}
