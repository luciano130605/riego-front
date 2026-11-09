import { useId, useRef, type KeyboardEvent } from 'react';
import { API_URL } from '@/data/env';
import { useAutomation, useLab, useSnapshot } from '@/data/hooks';
import { usePlantScope } from '@/data/plantScope';
import { cn } from '@/lib/cn';
import { Dialog } from '@/ui/Dialog';
import { AutomationTab } from './AutomationTab';
import { DeviceTab } from './DeviceTab';
import { NotificationsTab } from './NotificationsTab';
import { SimulationTab } from './SimulationTab';
import { WateringDataTab } from './WateringDataTab';
import { useSaveSettings, useSettingsSaving, type SaveState } from './useSaveSettings';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CheckmarkCircle02Icon, LoaderIcon } from '@hugeicons/core-free-icons';

export type TabId = 'automation' | 'watering-data' | 'notifications' | 'device' | 'simulation';

type Props = {
  open: boolean;
  tab: TabId;
  onTab: (tab: TabId) => void;
  onClose: () => void;
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'automation', label: 'Automatización' },
  { id: 'watering-data', label: 'Datos de riego' },
  { id: 'notifications', label: 'Notificaciones' },
  { id: 'device', label: 'Dispositivo' },
  { id: 'simulation', label: 'Simulación' },
];

function SaveStatus({ state }: { state: SaveState }) {
  return (
    <p className="flex min-h-6 items-center gap-2 text-sm text-ink-3" role="status" aria-live="polite">
      {state === 'saving' && (
        <>
          <HugeiconsIcon icon={LoaderIcon} size={15} aria-hidden className="motion-safe:animate-spin" /> Guardando…
        </>
      )}
      {state === 'saved' && (
        <>
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={15} aria-hidden className="text-ok" /> Guardado
        </>
      )}
      {state === 'error' && (
        <>
          <HugeiconsIcon icon={Alert02Icon} size={15} aria-hidden className="text-alert" /> No se pudo guardar
        </>
      )}
      {state === 'idle' && 'Los cambios se guardan solos.'}
    </p>
  );
}

/** Configuración en un diálogo: automatización, datos de riego, estado del equipo y (con datos de prueba) simulación. */
export function SettingsDialog({ open, tab, onTab, onClose }: Props) {
  const lab = useLab();
  const auto = useAutomation();
  const snapshot = useSnapshot();
  const scope = usePlantScope();
  const { save, state } = useSaveSettings();
  const saving = useSettingsSaving();
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  // La simulación solo existe con datos del simulador y sin backend configurado (VITE_API_URL).
  // Datos de riego es del automático: apagado, la pestaña no existe. Con varias plantas es de UNA planta: sin ninguna a
  // la vista tampoco. Si estabas ahí, vuelve a Automatización.
  const tabs = TABS.filter(
    (t) => (t.id !== 'simulation' || (lab && !API_URL)) && (t.id !== 'watering-data' || (auto.show.wateringData && (snapshot.plants === undefined || !!scope))),
  );
  const current = tabs.some((t) => t.id === tab) ? tab : 'automation';

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === current);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    onTab(tabs[next].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Configuración"
      footer={<SaveStatus state={state} />}
      className="h-[min(46rem,calc(100dvh-1.5rem))]"
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label="Secciones de la configuración"
        onKeyDown={onKey}
        // Solo se desliza de costado: el borde inferior de cada pestaña (-mb-px) sobresale 1 px y sin esto aparecía scroll vertical.
        className="thin-scroll -mx-1 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-line px-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={current === t.id}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={current === t.id ? 0 : -1}
            onClick={() => onTab(t.id)}
            className={cn(
              '-mb-px min-h-11 shrink-0 border-b-2 px-3.5 text-[15px] font-medium transition-colors duration-150',
              current === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${baseId}-panel-${current}`} aria-labelledby={`${baseId}-tab-${current}`}>
        {current === 'automation' && <AutomationTab save={save} saving={saving} />}
        {current === 'notifications' && <NotificationsTab />}
        {current === 'device' && <DeviceTab save={save} />}
        {current === 'watering-data' && <WateringDataTab />}
        {current === 'simulation' && lab && <SimulationTab lab={lab} />}
      </div>
    </Dialog>
  );
}
