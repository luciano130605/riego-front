import { useState } from 'react';
import { NOTIF, PUSH_KIND_COPY } from '@/core/copy';
import { PUSH_KINDS, type PushKind } from '@/data/api';
import { Button } from '@/ui/Button';
import { Switch } from '@/ui/Switch';
import { useToast } from '@/ui/toastContext';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CheckmarkCircle02Icon, Notification01Icon } from '@hugeicons/core-free-icons';
import { QuietHoursSection } from './QuietHoursSection';
import { SettingRow, SettingsSection } from './SettingRow';
import { testAllKinds } from './pushTestAll';
import { usePushSubscription } from './usePushSubscription';

/**
 * Notificaciones push de este dispositivo: las manda el servidor (Web Push), así que llegan aunque la pantalla esté
 * cerrada. Acá se activan en este dispositivo y se elige qué avisos recibir.
 */
export function NotificationsTab() {
  const toast = useToast();
  const push = usePushSubscription();
  // Qué prueba se está mandando ahora ('all' = todas), para no pisar una con otra.
  const [testing, setTesting] = useState<PushKind | 'all' | 'generic' | null>(null);
  const [progress, setProgress] = useState('');

  const blocked = push.support === 'ok' && push.permission === 'denied';
  const supportMessage =
    push.support === 'insecure' ? NOTIF.insecure : push.support === 'ios-install' ? NOTIF.ios : push.support === 'unsupported' ? NOTIF.unsupported : undefined;

  const status = supportMessage
    ? { icon: Alert02Icon, tone: 'text-alert', text: supportMessage }
    : blocked
      ? { icon: Alert02Icon, tone: 'text-alert', text: NOTIF.blocked }
      : push.subscribed
        ? { icon: CheckmarkCircle02Icon, tone: 'text-ok', text: NOTIF.on }
        : { icon: Notification01Icon, tone: 'text-ink-2', text: NOTIF.off };

  const enable = async () => {
    const res = await push.enable();
    toast.show(res.ok ? 'success' : 'error', res.ok ? NOTIF.activated : res.error);
  };

  const disable = async () => {
    const res = await push.disable();
    toast.show(res.ok ? 'info' : 'error', res.ok ? NOTIF.deactivated : res.error);
  };

  const failure = (res: { error: string; status?: number }) => (res.status === 410 ? NOTIF.testExpired : res.error);

  const test = async () => {
    setTesting('generic');
    const res = await push.test();
    setTesting(null);
    if (res.ok) toast.show('success', NOTIF.testSent);
    else toast.show('error', failure(res));
  };

  // La prueba de UN tipo de aviso: llega igual que el aviso real (con "Prueba:" adelante).
  const testKind = async (kind: PushKind) => {
    setTesting(kind);
    const res = await push.test(kind);
    setTesting(null);
    if (res.ok) toast.show('success', NOTIF.testKindSent(PUSH_KIND_COPY[kind].label));
    else toast.show('error', failure(res));
  };

  // Una prueba de cada tipo, una tras otra: así se ven todas las notificaciones que pueden llegar.
  const testAll = async () => {
    setTesting('all');
    const result = await testAllKinds((kind) => push.test(kind), {
      onProgress: (n, total) => setProgress(NOTIF.testAllRunning(n, total)),
    });
    setProgress('');
    setTesting(null);
    if (!result.failed) toast.show('success', NOTIF.testAllDone(result.sent.length));
    else {
      const { kind, result: res } = result.failed;
      toast.show('error', NOTIF.testAllStopped(result.sent.length, PUSH_KINDS.length, PUSH_KIND_COPY[kind].label, failure(res)));
    }
  };

  const busy = push.loading || testing !== null;

  return (
    <div>
      <SettingsSection title="Notificaciones en este dispositivo">
        <SettingRow
          label="Activar notificaciones en este dispositivo"
          hint={
            <>
              <span role="status" aria-live="polite" className={`flex items-start gap-2 font-medium ${status.tone}`}>
                <HugeiconsIcon icon={status.icon} size={16} aria-hidden className="mt-0.5 shrink-0" />
                <span className="min-w-0">{status.text}</span>
              </span>
            </>
          }
        >
          {/* Si no se puede, no se muestra un botón que falle: el motivo ya está arriba. */}
          {push.support === 'ok' &&
            (push.subscribed ? (
              <Button variant="ghost" disabled={push.loading} onClick={() => void disable()}>
                Desactivar
              </Button>
            ) : (
              <Button variant="primary" disabled={push.loading || blocked} onClick={() => void enable()}>
                {push.loading ? 'Activando…' : 'Activar'}
              </Button>
            ))}
        </SettingRow>
        {push.subscribed && (
          <SettingRow label="Probar" hint="Manda una notificación de prueba a este dispositivo.">
            <Button variant="ghost" disabled={busy} onClick={() => void test()}>
              Probar
            </Button>
          </SettingRow>
        )}
        {push.subscribed && (
          <SettingRow
            label="Probar todos los avisos"
            hint={
              <>
                Manda una prueba de cada uno de los {PUSH_KINDS.length} avisos, una tras otra, para ver cómo llega cada
                uno. Dicen “Prueba:” al principio.
                <span role="status" aria-live="polite" className="mt-1 block font-medium text-ink">
                  {progress}
                </span>
              </>
            }
          >
            <Button variant="primary" disabled={busy} onClick={() => void testAll()}>
              {testing === 'all' ? 'Probando…' : 'Probar todos'}
            </Button>
          </SettingRow>
        )}
      </SettingsSection>

      <QuietHoursSection />

      <SettingsSection title="Qué querés que te llegue">
        {PUSH_KINDS.map((kind) => (
          <SettingRow key={kind} label={PUSH_KIND_COPY[kind].label} hint={PUSH_KIND_COPY[kind].hint}>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                className="min-h-9 px-3 text-sm"
                disabled={!push.subscribed || busy}
                aria-label={`Probar el aviso “${PUSH_KIND_COPY[kind].label}”`}
                onClick={() => void testKind(kind)}
              >
                {testing === kind ? 'Mandando…' : 'Probar'}
              </Button>
              <Switch
                checked={push.prefs?.[kind] ?? false}
                label={PUSH_KIND_COPY[kind].label}
                disabled={!push.subscribed || !push.prefs}
                onChange={(on) =>
                  void push.setPref(kind, on).then((res) => {
                    if (!res.ok) toast.show('error', res.error);
                  })
                }
              />
            </div>
          </SettingRow>
        ))}
      </SettingsSection>
    </div>
  );
}
