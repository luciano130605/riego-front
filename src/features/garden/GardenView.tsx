import { useState } from 'react';
import { groupBySector, sectorChips } from '@/core/plants';
import type { Sector } from '@/core/types';
import { useNow, useSnapshot } from '@/data/hooks';
import { Header } from '@/features/dashboard/Header';
import { SettingsDialog, type TabId } from '@/features/settings/SettingsDialog';
import { useSettingsRequest } from '@/features/settings/settingsRequest';
import { Button } from '@/ui/Button';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, AlertDiamondIcon } from '@hugeicons/core-free-icons';
import { ChipsBar } from './ChipsBar';
import { resolveChip, setChip, useChip } from './chipStore';
import { GardenSkeleton } from './GardenSkeleton';
import { PlantDialog } from './PlantDialog';
import { SectorDialog } from './SectorDialog';
import { SectorSection } from './SectorSection';

type Dialog = { kind: 'sector'; sector?: Sector } | { kind: 'plant'; defaultSectorId?: string } | null;

/**
 * La vista general: chips para cambiar de sector y, por cada sector, su resumen, su umbral y objetivo y las tarjetas de
 * sus plantas. Tocar una planta abre su detalle.
 */
export function GardenView() {
  const snapshot = useSnapshot();
  const now = useNow(30_000);
  const chip = useChip();
  const [settings, setSettings] = useState<{ open: boolean; tab: TabId }>({ open: false, tab: 'automation' });
  const [dialog, setDialog] = useState<Dialog>(null);
  useSettingsRequest((tab) => setSettings({ open: true, tab }));

  if (snapshot.load === 'loading' && !snapshot.plants) return <GardenSkeleton />;

  const groups = groupBySector(snapshot.sectors ?? [], snapshot.plants ?? []);
  const selected = resolveChip(chip, groups.map((g) => g.sector.id));
  const visible = groups.filter((g) => selected === 'all' || g.sector.id === selected);

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 py-6 sm:px-8 sm:py-9">
      <Header onOpenSettings={(tab = 'automation') => setSettings({ open: true, tab })} title="Mi jardín" />

      {snapshot.error && (
        <div role="alert" className="flex items-start gap-3 rounded-control border border-alert/35 bg-alert/10 px-4 py-3 text-[15px]">
          <HugeiconsIcon icon={AlertDiamondIcon} size={18} aria-hidden className="mt-0.5 shrink-0 text-alert" />
          <p>
            <span className="font-medium">{snapshot.error}</span>{' '}
            <span className="text-ink-2">Estás viendo los últimos datos conocidos y no se puede regar ni cambiar nada hasta que vuelva la conexión.</span>
          </p>
        </div>
      )}

      <ChipsBar chips={sectorChips(groups)} selected={selected} onSelect={setChip} />

      <div className="flex flex-col gap-8">
        {visible.map((g) => (
          <SectorSection
            key={g.sector.id}
            group={g}
            now={now}
            onEditSector={() => setDialog({ kind: 'sector', sector: g.sector })}
            onAddPlant={() => setDialog({ kind: 'plant', defaultSectorId: g.sector.id })}
          />
        ))}
        {groups.length === 0 && (
          <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-[15px] text-ink-2">
            Todavía no hay sectores. Creá el primero y sumale plantas.
          </p>
        )}
      </div>

      <div>
        <Button onClick={() => setDialog({ kind: 'sector' })}>
          <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden />
          Agregar sector
        </Button>
      </div>

      <SettingsDialog
        open={settings.open}
        tab={settings.tab}
        onTab={(tab) => setSettings({ open: true, tab })}
        onClose={() => setSettings((s) => ({ ...s, open: false }))}
      />
      {dialog?.kind === 'sector' && <SectorDialog sector={dialog.sector} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'plant' && <PlantDialog defaultSectorId={dialog.defaultSectorId} onClose={() => setDialog(null)} />}
    </div>
  );
}
