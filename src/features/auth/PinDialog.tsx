import { useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import { isAuthApi, type AuthApi } from '@/data/api';
import { useRiegoApi } from '@/data/hooks';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

/**
 * Pide el PIN cuando hace falta confirmarlo (activar las notificaciones). Usa `auth` si se le pasa (el backend, aunque
 * la pantalla muestre datos de prueba); si no, la API activa. Sin ninguna de las dos no dibuja nada.
 */
export function PinDialog({ auth }: { auth?: AuthApi }) {
  const api = useRiegoApi();
  const active = auth ?? (isAuthApi(api) ? api : undefined);
  return active ? <PinForm auth={active} /> : null;
}

function PinForm({ auth }: { auth: AuthApi }) {
  const state = useSyncExternalStore(auth.subscribeAuth, auth.getAuthState, auth.getAuthState);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const inputId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !pin) return;
    setBusy(true);
    const ok = await auth.submitPin(pin);
    setBusy(false);
    if (ok) setPin('');
  }

  return (
    <Dialog
      open={state.pinRequested}
      onClose={() => {
        setPin('');
        auth.cancelPin();
      }}
      title="Ingresá el PIN"
      description="Hace falta para activar las notificaciones en este dispositivo."
      className="w-[min(26rem,calc(100%-1.5rem))]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => auth.cancelPin()}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy || !pin}>
            {busy ? 'Verificando…' : 'Entrar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm text-ink-2">
          PIN
        </label>
        <input
          id={inputId}
          type="password"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="min-h-11 w-full rounded-control border border-line bg-raised px-3 text-[15px] text-ink"
        />
        {state.error && (
          <p role="alert" className="text-sm text-alert">
            {state.error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
