import { useState } from 'react';
import { AVISO } from '@/core/copy';
import { dayAndTime, formatSeconds } from '@/core/format';
import { WET_FROM } from '@/core/moisture';
import { useDerived, useNow, useRiegoApi, useSnapshot } from '@/data/hooks';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { Card, CardTitle } from '@/ui/Card';
import { Dialog } from '@/ui/Dialog';
import { Skeleton } from '@/ui/Skeleton';
import { useToast } from '@/ui/toastContext';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderIcon, PlayIcon, SoilMoistureFieldIcon } from '@hugeicons/core-free-icons';

/** Motivo para pedir confirmación antes de regar a mano, si lo hay. */
function confirmReason(
  moisture: number | undefined,
  status: string,
  stale: boolean,
): { title: string; body: string } | null {
  if (status === 'error') {
    return {
      title: 'El sensor no da un valor confiable',
      body: 'No se sabe cuánta humedad tiene la tierra. Regar a ciegas puede pasarse de agua.',
    };
  }
  if (stale) {
    return {
      title: 'No hay lecturas recientes',
      body: 'La última medición es vieja, así que no se sabe cuánta humedad tiene ahora.',
    };
  }
  if (moisture !== undefined && moisture >= WET_FROM) {
    return {
      title: `La tierra ya está en ${Math.round(moisture)} %`,
      body: 'Está muy húmeda. Regar de más puede ahogar las raíces.',
    };
  }
  return null;
}

export function IrrigationControl() {
  const snapshot = useSnapshot();
  const derived = useDerived();
  const api = useRiegoApi();
  const toast = useToast();
  const now = useNow(500);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string } | null>(null);

  if (snapshot.load === 'loading') {
    return (
      <Card aria-busy="true" aria-label="Riego" className="p-4 lg:p-5">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="mt-4 h-8 w-32" />
      </Card>
    );
  }

  const aviso = derived.relayMode === 'aviso';
  const last = derived.lastWater;
  // Sin regador conectado no hay bomba que esté prendida: solo se anotan riegos hechos a mano.
  const pumpOn = !aviso && !!last && now >= last.t && now < last.t + last.seconds * 1000;
  const apiDown = !!snapshot.error;
  const busy = pumpOn || sending;
  const { waterSeconds } = snapshot.settings;

  const water = async () => {
    setConfirm(null);
    setSending(true);
    const result = await api.waterNow();
    setSending(false);
    if (aviso) {
      if (result.ok) toast.show('success', AVISO.noted);
      else toast.show('error', `${AVISO.noteFailed} ${result.error}`);
      return;
    }
    if (result.ok) toast.show('success', `Riego iniciado: ${formatSeconds(waterSeconds)}.`);
    else toast.show('error', `No se pudo regar. ${result.error}`);
  };

  const onClick = () => {
    const reason = confirmReason(derived.reading?.moisture, derived.status, derived.stale);
    if (reason) setConfirm(reason);
    else void water();
  };

  return (
    <Card aria-labelledby="riego-titulo" className="p-4 lg:p-5">
      <div className="flex h-full flex-col justify-between gap-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <HugeiconsIcon icon={SoilMoistureFieldIcon} size={20} aria-hidden className="text-accent" />
            <CardTitle id="riego-titulo" className="text-base">
              Riego
            </CardTitle>
          </div>
          {aviso ? (
            <>
              <p className="mt-2 text-xs text-ink-3">{AVISO.lastNoted}</p>
              <p className="text-lg leading-tight font-semibold lg:text-[22px]" role="status">
                {last ? dayAndTime(last.t, snapshot.now) : <span className="text-ink-3">{AVISO.noneNoted}</span>}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xs text-ink-3">Estado actual</p>
              <p className="flex items-center gap-2.5 text-lg leading-tight font-semibold lg:text-[22px]" role="status">
                {pumpOn ? 'Encendido' : 'Apagado'}
                <span
                  aria-hidden
                  className={cn(
                    'size-3 rounded-full',
                    pumpOn ? 'bg-accent motion-safe:animate-pulse' : 'bg-[#5a5a5a]',
                  )}
                />
              </p>
            </>
          )}
          {busy && (
            <p className="mt-0.5 text-xs text-ink-2">
              {sending
                ? aviso
                  ? 'Anotando el riego…'
                  : 'Enviando la orden…'
                : `Operación en curso: ${last?.source === 'auto' ? 'riego automático' : 'riego a mano'}`}
            </p>
          )}
          {!busy && apiDown && <p className="mt-0.5 text-xs text-alert">Sin conexión con el servidor</p>}
        </div>

        <Button
          onClick={onClick}
          disabled={busy || apiDown}
          className="h-12 w-full shrink-0 rounded-[16px] px-3 text-[15px] lg:h-14 lg:w-auto lg:px-5 lg:text-base"
        >
          {busy ? (
            <HugeiconsIcon icon={LoaderIcon} size={18} aria-hidden className="motion-safe:animate-spin" />
          ) : (
            <HugeiconsIcon icon={PlayIcon} size={18} aria-hidden />
          )}
          {aviso ? (busy ? AVISO.noting : AVISO.noteButton) : busy ? 'Regando' : 'Regar ahora'}
        </Button>
      </div>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title ?? ''}
        description={confirm?.body}
        className="w-[min(28rem,calc(100%-1.5rem))]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void water()}>
              {aviso ? AVISO.noteConfirm : `Regar igual (${formatSeconds(waterSeconds)})`}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-2">
          {aviso ? AVISO.noteBody : `La bomba va a estar encendida ${formatSeconds(waterSeconds)}.`}
        </p>
      </Dialog>
    </Card>
  );
}
