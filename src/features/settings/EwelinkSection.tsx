import { useEffect, useRef, useState } from 'react';
import { ewelinkReturnText, ewelinkView, type EwelinkTone } from '@/core/ewelink';
import { useRiegoApi } from '@/data/hooks';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { Skeleton } from '@/ui/Skeleton';
import { useToast } from '@/ui/toastContext';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { startLinking, unlink } from './ewelinkActions';
import { setEwelinkReturn, useEwelinkReturn } from './ewelinkReturn';
import { SettingsSection } from './SettingRow';
import { takeAnchor } from './settingsRequest';
import { useEwelinkStatus } from './useEwelinkStatus';

const TONE: Record<EwelinkTone, { dot: string; text: string }> = {
  ok: { dot: 'bg-ok', text: 'text-ok' },
  warn: { dot: 'bg-[#d9a441]', text: 'text-ink' },
  bad: { dot: 'bg-alert', text: 'text-alert' },
  neutral: { dot: 'bg-ink-3', text: 'text-ink-2' },
};

const goTo = (url: string) => window.location.assign(url);

/**
 * El vínculo con eWeLink (el Sonoff): sin vincular, vinculada (con cuándo vence), vencida o con error, y si el equipo
 * está en línea. "Vincular" manda a eWeLink con la sesión del PIN; al volver se muestra qué pasó y se refresca el
 * estado. Sin la ruta en el servidor (backend viejo) la sección no se muestra.
 */
export function EwelinkSection() {
  const api = useRiegoApi();
  const toast = useToast();
  const { state, refresh } = useEwelinkStatus();
  const back = useEwelinkReturn();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'link' | 'unlink' | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  // Si se llegó desde el acceso directo (o volviendo de eWeLink), baja hasta acá.
  useEffect(() => {
    if (state.phase === 'unavailable' || state.phase === 'loading') return;
    if (takeAnchor() === 'ewelink') ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [state.phase]);

  if (state.phase === 'unavailable') return null;

  async function link() {
    if (busy) return;
    setBusy('link');
    setError(undefined);
    const res = await startLinking(api, goTo);
    if (!res.ok) {
      setError(res.error);
      setBusy(null);
    }
    // Si salió bien, el navegador ya se está yendo a eWeLink.
  }

  async function doUnlink() {
    if (busy) return;
    setBusy('unlink');
    setError(undefined);
    const res = await unlink(api);
    setBusy(null);
    setConfirmUnlink(false);
    if (res.ok) {
      toast.show('success', 'eWeLink desvinculada.');
      void refresh();
    } else {
      setError(res.error);
    }
  }

  const view = state.phase === 'ready' ? ewelinkView(state.status) : undefined;

  return (
    <div id="ewelink" ref={ref} className="scroll-mt-4">
      <SettingsSection title="eWeLink">
        {back && (
          <div
            role={back.kind === 'ok' ? 'status' : 'alert'}
            className={cn(
              'mb-4 flex items-start gap-2.5 rounded-control border px-4 py-3 text-[15px]',
              back.kind === 'ok' ? 'border-ok/40 bg-ok/10' : 'border-alert/40 bg-alert/10',
            )}
          >
            <HugeiconsIcon icon={back.kind === 'ok' ? CheckmarkCircle02Icon : Alert02Icon} size={18} aria-hidden className={cn('mt-0.5 shrink-0', back.kind === 'ok' ? 'text-ok' : 'text-alert')} />
            <p className="min-w-0 flex-1">{ewelinkReturnText(back)}</p>
            <button type="button" onClick={() => setEwelinkReturn(undefined)} className="shrink-0 text-sm text-ink-2 underline-offset-2 hover:text-ink hover:underline">
              Cerrar
            </button>
          </div>
        )}

        {state.phase === 'loading' && (
          <div aria-busy="true" aria-label="eWeLink">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-3 h-5 w-64 max-w-full" />
            <Skeleton className="mt-3 h-11 w-44" />
          </div>
        )}

        {state.phase === 'error' && (
          <div role="alert" className="flex flex-col gap-3">
            <p className="flex items-start gap-2 text-[15px] text-alert">
              <HugeiconsIcon icon={Alert02Icon} size={16} aria-hidden className="mt-0.5 shrink-0" />
              <span className="min-w-0">{state.error}</span>
            </p>
            <div>
              <Button onClick={() => void refresh()}>Reintentar</Button>
            </div>
          </div>
        )}

        {view && (
          <div className="flex flex-col gap-4">
            <dl className="flex flex-col gap-1">
              <div className="flex flex-wrap justify-between gap-x-6 border-b border-line py-2.5 first:pt-0">
                <dt className="text-[15px] text-ink-2">Estado</dt>
                <dd className={cn('inline-flex items-center gap-2 text-[15px] font-medium', TONE[view.tone].text)}>
                  <span aria-hidden className={cn('size-2 rounded-full', TONE[view.tone].dot)} />
                  {view.title}
                </dd>
              </div>
              {view.device && (
                <div className="flex flex-wrap justify-between gap-x-6 border-b border-line py-2.5">
                  <dt className="text-[15px] text-ink-2">Equipo</dt>
                  <dd className={cn('text-[15px] font-medium', TONE[view.device.tone].text)}>{view.device.label}</dd>
                </div>
              )}
            </dl>
            {view.detail && <p className="text-sm text-ink-2">{view.detail}</p>}

            {confirmUnlink ? (
              <div className="flex flex-col gap-3 rounded-control border border-line p-3">
                <p className="text-sm text-ink-2">¿Desvincular eWeLink? El regador deja de responder hasta que la vincules de nuevo.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" disabled={busy !== null} onClick={() => void doUnlink()}>
                    {busy === 'unlink' ? 'Desvinculando…' : 'Sí, desvincular'}
                  </Button>
                  <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmUnlink(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {view.canLink && (
                  <Button variant="primary" disabled={busy !== null} onClick={() => void link()}>
                    {busy === 'link' ? 'Abriendo eWeLink…' : 'Vincular eWeLink'}
                  </Button>
                )}
                {view.canUnlink && (
                  <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmUnlink(true)}>
                    Desvincular
                  </Button>
                )}
                <Button variant="ghost" disabled={busy !== null} onClick={() => void refresh()}>
                  Actualizar
                </Button>
              </div>
            )}
          </div>
        )}

        <p role="alert" className="mt-2 min-h-5 text-sm text-alert">
          {error}
        </p>
      </SettingsSection>
    </div>
  );
}
