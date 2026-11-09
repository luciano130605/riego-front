import { useEffect, useState } from 'react';
import { groupBySector, neighborPlant, plantsInChip } from '@/core/plants';
import { HOME_HREF, plantHref } from '@/core/route';
import type { PlantView } from '@/core/types';
import { PlantScopeProvider, usePlantScope } from '@/data/plantScope';
import { useRiegoApi, useSnapshot } from '@/data/hooks';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { LastWatering } from '@/features/summary/SummaryCards';
import { Button, IconButton } from '@/ui/Button';
import { Card, CardTitle } from '@/ui/Card';
import { Switch } from '@/ui/Switch';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, ArrowRight01Icon, PencilEdit02Icon } from '@hugeicons/core-free-icons';
import { resolveChip, useChip } from './chipStore';
import { GardenSkeleton } from './GardenSkeleton';
import { PlantDialog } from './PlantDialog';
import { StatusBadge } from './StatusBadge';
import { goTo } from './useRoute';
import { useGardenAction } from './useGardenAction';
import { useSwipe } from './useSwipe';

/**
 * El detalle de una planta. Pone a esa planta "a la vista" en la API (el snapshot pasa a ser el suyo) y reutiliza el
 * tablero de siempre, que no sabe nada de plantas. Se puede pasar a la vecina con los botones o deslizando el dedo.
 */
export function PlantDetail({ id }: { id: string }) {
  const api = useRiegoApi();
  const snapshot = useSnapshot();
  const chip = useChip();

  useEffect(() => {
    api.setPlantScope(id);
  }, [api, id]);
  // Al salir del detalle se vuelve a la vista general.
  useEffect(() => () => api.setPlantScope(undefined), [api]);

  const plants = snapshot.plants ?? [];
  const plant = plants.find((p) => p.id === id);
  const missing = snapshot.load === 'ready' && !snapshot.error && snapshot.plants !== undefined && !plant;
  useEffect(() => {
    if (missing) goTo(HOME_HREF); // la planta se archivó o no existe
  }, [missing]);

  if (!plant) return <GardenSkeleton />;

  // El orden para pasar de una a otra sigue el sector elegido en los chips (si la planta no está ahí, todas).
  const groups = groupBySector(snapshot.sectors ?? [], plants);
  const wanted = plantsInChip(groups, resolveChip(chip, groups.map((g) => g.sector.id)));
  const order = wanted.some((p) => p.id === id) ? wanted : plantsInChip(groups, 'all');

  return (
    <PlantScopeProvider value={{ plant, order }}>
      <PlantPage plant={plant} order={order} />
    </PlantScopeProvider>
  );
}

function PlantPage({ plant, order }: { plant: PlantView; order: PlantView[] }) {
  const [editing, setEditing] = useState(false);
  const prev = neighborPlant(order, plant.id, -1);
  const next = neighborPlant(order, plant.id, 1);
  const swipe = useSwipe(
    () => next && goTo(plantHref(next.id)),
    () => prev && goTo(plantHref(prev.id)),
  );
  const header = { title: plant.name, back: { href: HOME_HREF, label: plant.sectorName } };
  const edit = () => setEditing(true);

  return (
    <div {...swipe}>
      <Dashboard
        header={header}
        bar={<PlantBar plant={plant} order={order} onEdit={edit} />}
        noSensor={plant.sensor ? undefined : <NoSensorPlant plant={plant} onEdit={edit} />}
      />
      {editing && <PlantDialog plant={plant} onClose={() => setEditing(false)} onArchived={() => goTo(HOME_HREF)} />}
    </div>
  );
}

/** Cambiar de planta, ver su estado y prender o apagar su propio automático. */
function PlantBar({ plant, order, onEdit }: { plant: PlantView; order: PlantView[]; onEdit: () => void }) {
  const api = useRiegoApi();
  const { settings } = useSnapshot();
  const { run, busy } = useGardenAction();
  const i = order.findIndex((p) => p.id === plant.id);
  const prev = neighborPlant(order, plant.id, -1);
  const next = neighborPlant(order, plant.id, 1);
  const nav = 'size-11 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="Plantas" className="flex items-center gap-1">
          <IconButton label="Planta anterior" className={nav} disabled={!prev} onClick={() => prev && goTo(plantHref(prev.id))}>
            <HugeiconsIcon icon={ArrowLeft01Icon} size={18} aria-hidden />
          </IconButton>
          <span className="min-w-[5.5rem] text-center text-sm text-ink-2 tabular-nums">
            {i >= 0 ? i + 1 : '—'} de {order.length}
          </span>
          <IconButton label="Planta siguiente" className={nav} disabled={!next} onClick={() => next && goTo(plantHref(next.id))}>
            <HugeiconsIcon icon={ArrowRight01Icon} size={18} aria-hidden />
          </IconButton>
        </nav>
        <div className="flex items-center gap-3">
          <StatusBadge status={plant.status} />
          {plant.sensor && (
            <div className="flex items-center gap-1">
              <span className="text-[15px] font-medium">Automático de la planta</span>
              <Switch
                checked={plant.auto}
                disabled={busy}
                label="Riego automático de esta planta"
                onChange={(auto) => void run(api.updatePlant(plant.id, { auto }), { ok: auto ? 'Automático de la planta activado.' : 'Automático de la planta apagado.' })}
              />
            </div>
          )}
          <IconButton label="Editar planta" onClick={onEdit}>
            <HugeiconsIcon icon={PencilEdit02Icon} size={18} aria-hidden />
          </IconButton>
        </div>
      </div>
      {plant.sensor && plant.auto && !settings.auto && (
        <p className="text-sm text-ink-3">El automático general está apagado: esta planta no riega sola.</p>
      )}
    </div>
  );
}

/** Una planta sin sensor: no hay humedad, umbral ni controles automáticos. Solo anotar el riego y ver el último. */
function NoSensorPlant({ plant, onEdit }: { plant: PlantView; onEdit: () => void }) {
  const api = useRiegoApi();
  const { run, busy } = useGardenAction();
  const scope = usePlantScope();
  return (
    <main className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="flex flex-col gap-3">
        <CardTitle>{scope?.plant.name ?? plant.name}</CardTitle>
        <p className="text-[22px] leading-none font-semibold text-ink-2">Sin sensor</p>
        <p className="text-[15px] text-ink-2">
          Esta planta no tiene un sensor asignado: no se mide su humedad ni se riega sola. Podés anotar los riegos que hacés a mano.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void run(api.waterPlant(plant.id), { ok: 'Riego anotado.' })}>
            {busy ? 'Anotando…' : 'Anotar riego'}
          </Button>
          <Button onClick={onEdit}>Asignar sensor</Button>
        </div>
      </Card>
      <LastWatering />
    </main>
  );
}
