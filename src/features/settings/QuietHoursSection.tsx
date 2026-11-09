import { useId, useState } from 'react';
import { QUIET } from '@/core/copy';
import { quietHoursOf, quietHoursToSave, validateQuietHours } from '@/core/quietHours';
import { useSnapshot } from '@/data/hooks';
import { Skeleton } from '@/ui/Skeleton';
import { Switch } from '@/ui/Switch';
import { SettingRow, SettingsSection } from './SettingRow';
import { useSaveSettings, useSettingsSaving } from './useSaveSettings';

const TIME_INPUT =
  'min-h-11 w-full rounded-control border border-line bg-raised px-3 text-[15px] text-ink tabular-nums [color-scheme:dark] focus-visible:border-accent disabled:text-ink-3';

/**
 * "No molestar": en esa ventana no se mandan notificaciones al celular y a la mañana llega un resumen. Cada cambio se
 * guarda por la API y no se da por hecho hasta que responde; si falla se muestra el error y vuelve a lo que dice el
 * servidor. "Desde" y "hasta" no pueden ser la misma hora: eso ni se manda.
 */
export function QuietHoursSection() {
  const { settings, load } = useSnapshot();
  const { save } = useSaveSettings();
  const saving = useSettingsSaving();
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  const server = quietHoursOf(settings);
  // Lo que se está escribiendo; null = lo que dice el servidor.
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | undefined>();
  const from = draft?.from ?? server.from;
  const to = draft?.to ?? server.to;

  if (load !== 'ready') {
    return (
      <SettingsSection title={QUIET.section}>
        <div aria-busy="true" aria-label={QUIET.section}>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-3 h-11 w-full" />
        </div>
      </SettingsSection>
    );
  }

  async function changeTimes(next: { from: string; to: string }) {
    setDraft(next);
    const check = validateQuietHours(next);
    if (!check.ok) {
      setError(check.error); // no se manda nada: queda el valor del servidor
      return;
    }
    setError(undefined);
    await save({ quietHours: quietHoursToSave(settings, next) }, QUIET.saved);
    // Con éxito o con error, vuelve a mostrar lo que dice el servidor (si falló, el aviso ya salió).
    setDraft(null);
  }

  return (
    <SettingsSection title={QUIET.section}>
      <SettingRow label={QUIET.label} hint={server.enabled ? QUIET.hintOn(server.from, server.to) : QUIET.hintOff(server.from, server.to)}>
        <Switch
          checked={server.enabled}
          disabled={saving}
          label={QUIET.label}
          onChange={(enabled) =>
            void save({ quietHours: quietHoursToSave(settings, { enabled }) }, enabled ? QUIET.on : QUIET.off)
          }
        />
      </SettingRow>
      <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fromId} className="text-sm text-ink-2">
            {QUIET.from}
          </label>
          <input
            id={fromId}
            type="time"
            step={60}
            value={from}
            disabled={saving}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => e.target.value && void changeTimes({ from: e.target.value, to })}
            className={TIME_INPUT}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={toId} className="text-sm text-ink-2">
            {QUIET.to}
          </label>
          <input
            id={toId}
            type="time"
            step={60}
            value={to}
            disabled={saving}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => e.target.value && void changeTimes({ from, to: e.target.value })}
            className={TIME_INPUT}
          />
        </div>
      </div>
      <p id={errorId} role="alert" className="mt-2 min-h-5 text-sm text-alert">
        {error}
      </p>
    </SettingsSection>
  );
}
