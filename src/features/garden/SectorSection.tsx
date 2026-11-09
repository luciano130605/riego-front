import { sectorSummary, summaryText, type SectorGroup } from '@/core/plants';
import { LIMITS } from '@/core/garden';
import { useRiegoApi } from '@/data/hooks';
import { Button, IconButton } from '@/ui/Button';
import { Stepper } from '@/ui/Stepper';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons';
import { PlantCard } from './PlantCard';
import { useGardenAction } from './useGardenAction';

type Props = {
  group: SectorGroup;
  now: number;
  onEditSector: () => void;
  onAddPlant: () => void;
};

/**
 * Un sector: su nombre, el resumen ("2 de 3 necesitan agua"), su umbral y objetivo editables y las tarjetas de sus
 * plantas. Cada cambio de umbral u objetivo se guarda por la API; los botones quedan quietos hasta que responde.
 */
export function SectorSection({ group, now, onEditSector, onAddPlant }: Props) {
  const api = useRiegoApi();
  const { run, busy } = useGardenAction();
  const { sector, plants } = group;
  const headingId = `sector-${sector.id}`;

  const save = (patch: { thresholdPct?: number; targetPct?: number }) => void run(api.updateSector(sector.id, patch));

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 id={headingId} className="truncate text-xl font-semibold">
            {sector.name}
          </h2>
          <p className="text-sm text-ink-2">{summaryText(sectorSummary(plants))}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex items-center gap-1">
            <span className="text-sm text-ink-2">Umbral</span>
            <Stepper
              label={`Umbral de ${sector.name}`}
              display={`${sector.thresholdPct} %`}
              value={sector.thresholdPct}
              min={LIMITS.threshold.min}
              max={Math.min(LIMITS.threshold.max, sector.targetPct - LIMITS.gap)}
              disabled={busy}
              onChange={(thresholdPct) => save({ thresholdPct })}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm text-ink-2">Objetivo</span>
            <Stepper
              label={`Objetivo de ${sector.name}`}
              display={`${sector.targetPct} %`}
              value={sector.targetPct}
              min={Math.max(LIMITS.target.min, sector.thresholdPct + LIMITS.gap)}
              max={LIMITS.target.max}
              disabled={busy}
              onChange={(targetPct) => save({ targetPct })}
            />
          </div>
          <IconButton label={`Editar el sector ${sector.name}`} onClick={onEditSector}>
            <HugeiconsIcon icon={PencilEdit02Icon} size={18} aria-hidden />
          </IconButton>
        </div>
      </header>

      {plants.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {plants.map((p) => (
            <PlantCard key={p.id} plant={p} now={now} />
          ))}
        </div>
      ) : (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[15px] text-ink-2">Este sector todavía no tiene plantas.</p>
      )}

      <div>
        <Button variant="ghost" onClick={onAddPlant} className="-ml-2">
          <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden />
          Agregar planta a {sector.name}
        </Button>
      </div>
    </section>
  );
}
