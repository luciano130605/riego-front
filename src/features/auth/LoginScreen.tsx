import { useId, useState, type FormEvent } from 'react';
import type { AuthApi } from '@/data/api';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';

/** El backend pide al menos 4 caracteres; el PIN de la casa es de hasta 6 dígitos. */
const PIN_MIN = 4;
const PIN_MAX = 6;

/**
 * Pantalla de entrada: se ve antes que el tablero cuando hay backend. El error sale de lo que respondió el servidor
 * (PIN incorrecto, demasiados intentos o sin conexión) y no se da por hecho nada hasta que llega el token.
 */
export function LoginScreen({ auth }: { auth: AuthApi }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const inputId = useId();
  const errorId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || pin.length < PIN_MIN) return;
    setBusy(true);
    setError(undefined);
    const ok = await auth.submitPin(pin);
    if (!ok) {
      setError(auth.getAuthState().error);
      setBusy(false);
    }
    // Si entró, el tablero reemplaza esta pantalla.
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">Entrar a tu casa</h1>
        <p className="mt-1.5 text-sm text-ink-2">Ingresá el PIN para ver y controlar el riego.</p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-2" noValidate>
          <label htmlFor={inputId} className="text-sm text-ink-2">
            PIN
          </label>
          <input
            id={inputId}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={PIN_MAX}
            autoFocus
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX));
              if (error) setError(undefined);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="min-h-12 w-full rounded-control border border-line bg-raised px-3 text-center text-xl tracking-[0.5em] text-ink tabular-nums focus-visible:border-accent"
          />
          <p id={errorId} role="alert" className="min-h-5 text-sm text-alert">
            {error}
          </p>
          <Button variant="primary" type="submit" disabled={busy || pin.length < PIN_MIN} className="mt-1 w-full">
            {busy ? 'Verificando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
