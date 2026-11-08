import { AVISO } from '@/core/copy';
import { API_URL } from '@/data/env';
import { useAutomation, useDerived, useSnapshot } from '@/data/hooks';
import { NotificationsButton } from '@/features/notifications/NotificationsButton';
import { useSaveSettings, useSettingsSaving } from '@/features/settings/useSaveSettings';
import type { TabId } from '@/features/settings/SettingsDialog';
import { cn } from '@/lib/cn';
import { IconButton } from '@/ui/Button';
import { Skeleton } from '@/ui/Skeleton';
import { Switch } from '@/ui/Switch';
import { ConnectionChip } from './ConnectionChip';
import { HugeiconsIcon } from '@hugeicons/react';
import { CustomizeIcon, EcoLab01Icon, Notification01Icon, WaterEnergyIcon } from '@hugeicons/core-free-icons';

type Props = { onOpenSettings: (tab?: TabId) => void };

export function Header({ onOpenSettings }: Props) {
  const snapshot = useSnapshot();
  const derived = useDerived();
  const { save } = useSaveSettings();
  const saving = useSettingsSaving();
  const automation = useAutomation();
  const loading = snapshot.load === 'loading';
  const { auto } = snapshot.settings;
  const aviso = derived.relayMode === 'aviso';

  return (
    // Mobile: título y los dos botones arriba, el subtítulo abajo y, en una sola fila, el estado y el interruptor.
    // Desde lg: todo en una línea, como siempre.
    <header className="grid grid-cols-[minmax(0,1fr)_automationauto] items-start gap-x-2 gap-y-3 lg:flex lg:flex-wrap lg:items-center lg:gap-x-3 lg:gap-y-4">
      <div className="contents lg:mr-auto lg:block lg:min-w-0 lg:pr-3">
        <div className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-3xl">Mi planta</h1>
          {snapshot.isDemo &&
            (API_URL ? (
              // Con backend configurado no hay controles de simulación: es solo una etiqueta.
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2"
                title="Los datos son de ejemplo."
              >
                <HugeiconsIcon icon={EcoLab01Icon} size={13} aria-hidden />
                Datos de prueba
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenSettings('simulation')}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors duration-150 hover:border-[#3a3a3a] hover:text-ink"
                title="Los datos son simulados. Tocá para ver los controles de prueba."
              >
                <HugeiconsIcon icon={EcoLab01Icon} size={13} aria-hidden />
                Datos de prueba
              </button>
            ))}
          {aviso && !loading && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2"
              title={AVISO.chipTitle}
            >
              <HugeiconsIcon icon={Notification01Icon} size={13} aria-hidden />
              {AVISO.chip}
            </span>
          )}
        </div>
        <p className="col-span-3 row-start-2 text-[15px] text-ink-2 lg:mt-0.5">
          {aviso ? AVISO.line : automation.subtitle}
        </p>
      </div>

      <div className="col-span-3 row-start-3 grid grid-cols-2 gap-2 lg:contents">
        <ConnectionChip className="lg:order-1" />

        <div className="flex h-12 min-w-0 items-center justify-between gap-1 rounded-full border border-line bg-card pr-1 pl-3 lg:order-2 lg:justify-start lg:pl-4">
          <HugeiconsIcon
            icon={aviso ? Notification01Icon : WaterEnergyIcon}
            size={18}
            aria-hidden
            className={cn('hidden shrink-0 lg:block', auto ? 'text-accent' : 'text-ink-3')}
          />
          <span className="min-w-0 truncate text-[15px] font-medium lg:mr-1 lg:ml-2">
            {aviso ? AVISO.switchLabel : 'Automático'}
          </span>
          {loading ? (
            <Skeleton className="mr-2 h-7 w-12 rounded-full" />
          ) : (
            <Switch
              checked={auto}
              // El cambio no se da por hecho hasta que la API confirma: mientras tanto el interruptor queda quieto.
              disabled={saving}
              label={aviso ? AVISO.switchAria : 'Riego automático'}
              onChange={(next) =>
                void save(
                  { auto: next },
                  aviso
                    ? next
                      ? AVISO.on
                      : AVISO.off
                    : next
                      ? 'Riego automático activado.'
                      : 'Riego automático apagado.',
                )
              }
            />
          )}
        </div>

      </div>

      <div className="col-start-2 row-start-1 lg:order-3">
        <NotificationsButton snapshot={snapshot} derived={derived} />
      </div>
      <IconButton label="Configuración" onClick={() => onOpenSettings()} className="col-start-3 row-start-1 lg:order-4">
        <HugeiconsIcon icon={CustomizeIcon} size={20} aria-hidden />
      </IconButton>
    </header>
  );
}
