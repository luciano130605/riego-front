import { useState } from 'react';
import { AVISO, needsWaterText } from '@/core/copy';
import { useDerived, useRiegoApi, useSnapshot } from '@/data/hooks';
import { Button } from '@/ui/Button';
import { useToast } from '@/ui/toastContext';
import { HugeiconsIcon } from '@hugeicons/react';
import { DropletIcon, LoaderIcon } from '@hugeicons/core-free-icons';

/**
 * Alerta abierta en modo aviso: la planta necesita agua. Se cierra cuando se anota un riego
 * (o cuando la humedad vuelve a subir). Con regador real no se muestra.
 */
export function NeedsWaterBanner() {
  const snapshot = useSnapshot();
  const { needsWater, reading } = useDerived();
  const api = useRiegoApi();
  const toast = useToast();
  const [sending, setSending] = useState(false);

  if (!needsWater || !reading) return null;

  const note = async () => {
    setSending(true);
    const result = await api.waterNow();
    setSending(false);
    if (result.ok) toast.show('success', AVISO.noted);
    else toast.show('error', `${AVISO.noteFailed} ${result.error}`);
  };

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-control border border-alert/35 bg-alert/10 px-4 py-3"
    >
      <HugeiconsIcon icon={DropletIcon} size={20} aria-hidden className="shrink-0 text-alert" />
      <p className="min-w-0 flex-1 basis-56 text-[15px] font-medium">
        {needsWaterText(reading.moisture, snapshot.settings.targetPct)}
      </p>
      <Button onClick={() => void note()} disabled={sending || !!snapshot.error} className="shrink-0">
        {sending && <HugeiconsIcon icon={LoaderIcon} size={16} aria-hidden className="motion-safe:animate-spin" />}
        {sending ? AVISO.noting : AVISO.noteButton}
      </Button>
    </div>
  );
}
