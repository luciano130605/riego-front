import { useId, useState, type FormEvent } from 'react';
import { PLANTS } from '@/core/copy';
import { LIMITS, effectiveLimits, validateChannel, validateLimits, validateName } from '@/core/garden';
import type { PlantSensor, PlantView } from '@/core/types';
import { useRiegoApi, useSnapshot } from '@/data/hooks';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Stepper } from '@/ui/Stepper';
import { Switch } from '@/ui/Switch';
import { INPUT, LABEL } from './fields';
import { useGardenAction } from './useGardenAction';

type Props = {
  onClose: () => void;
  /** Sin planta se crea una nueva. */
  plant?: PlantView;
  /** Sector con el que arranca una planta nueva. */
  defaultSectorId?: string;
  /** Se llama después de archivar (el detalle de una planta archivada ya no existe). */
  onArchived?: () => void;
};

const sameSensor = (a: PlantSensor | null, b: PlantSensor | null) =>
  a === b || (!!a && !!b && a.deviceId === b.deviceId && a.channel === b.channel);

/**
 * Crear o editar una planta: nombre, sector (mover = elegir otro), sensor (placa y canal, o sin sensor), umbral propio
 * opcional ("usa el del sector") y su automático. Sin sensor no hay umbral ni automático: solo se anotan los riegos.
 */
export function PlantDialog({ onClose, plant, defaultSectorId, onArchived }: Props) {
  const api = useRiegoApi();
  const { sectors = [], devices = [] } = useSnapshot();
  const { run, busy } = useGardenAction();
  const formId = useId();
  const ids = { name: useId(), sector: useId(), device: useId(), channel: useId() };

  const [name, setName] = useState(plant?.name ?? '');
  const [sectorId, setSectorId] = useState(plant?.sectorId ?? defaultSectorId ?? sectors[0]?.id ?? '');
  const [deviceId, setDeviceId] = useState(plant?.sensor?.deviceId ?? '');
  const [channel, setChannel] = useState(plant?.sensor?.channel ?? 'main');
  const [own, setOwn] = useState(plant ? plant.thresholdPct != null || plant.targetPct != null : false);
  const sector = sectors.find((s) => s.id === sectorId);
  const eff = effectiveLimits(plant ?? {}, sector ?? { thresholdPct: 35, targetPct: 55 });
  const [thresholdPct, setThreshold] = useState(plant?.thresholdPct ?? eff.thresholdPct);
  const [targetPct, setTarget] = useState(plant?.targetPct ?? eff.targetPct);
  const [auto, setAuto] = useState(plant?.auto ?? true);
  const [error, setError] = useState<string | undefined>();
  const [confirmArchive, setConfirmArchive] = useState(false);

  const hasSensor = deviceId !== '';
  const sensor: PlantSensor | null = hasSensor ? { deviceId, channel: channel.trim() } : null;
  const invalid =
    validateName(name) ?? (hasSensor ? validateChannel(channel.trim()) : undefined) ?? (hasSensor && own ? validateLimits(thresholdPct, targetPct) : undefined) ?? (sector ? undefined : 'Elegí un sector.');

  const ownLimits = hasSensor && own;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || invalid) return;
    setError(undefined);
    const limits = { thresholdPct: ownLimits ? thresholdPct : null, targetPct: ownLimits ? targetPct : null };

    if (!plant) {
      const res = await run(api.createPlant({ name: name.trim(), sectorId, sensor, ...limits, auto }), { inlineError: true, ok: 'Planta creada.' });
      if (res.ok) onClose();
      else setError(res.error);
      return;
    }

    // Edición: primero lo de la planta (solo lo que cambió) y después el sensor, para ver el primer error.
    const patch = {
      ...(name.trim() !== plant.name ? { name: name.trim() } : {}),
      ...(sectorId !== plant.sectorId ? { sectorId } : {}),
      ...((plant.thresholdPct ?? null) !== limits.thresholdPct ? { thresholdPct: limits.thresholdPct } : {}),
      ...((plant.targetPct ?? null) !== limits.targetPct ? { targetPct: limits.targetPct } : {}),
      ...(hasSensor && auto !== plant.auto ? { auto } : {}),
    };
    if (Object.keys(patch).length > 0) {
      const res = await run(api.updatePlant(plant.id, patch), { inlineError: true });
      if (!res.ok) return setError(res.error);
    }
    if (!sameSensor(sensor, plant.sensor)) {
      const res = await run(api.setPlantSensor(plant.id, sensor), { inlineError: true });
      if (!res.ok) return setError(res.error);
    }
    onClose();
  }

  async function archive() {
    if (!plant || busy) return;
    setError(undefined);
    const res = await run(api.archivePlant(plant.id), { inlineError: true, ok: 'Planta archivada.' });
    if (res.ok) {
      onClose();
      onArchived?.();
    } else {
      setError(res.error);
      setConfirmArchive(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={plant ? 'Editar planta' : 'Agregar planta'}
      className="w-[min(32rem,calc(100%-1.5rem))]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {plant &&
              (confirmArchive ? (
                <Button variant="danger" onClick={() => void archive()} disabled={busy}>
                  Sí, archivar la planta
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmArchive(true)} disabled={busy}>
                  Archivar planta
                </Button>
              ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form={formId} disabled={busy || !!invalid}>
              {busy ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.name} className={LABEL}>
            Nombre
          </label>
          <input id={ids.name} className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.sector} className={LABEL}>
            Sector
          </label>
          <select id={ids.sector} className={INPUT} value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.device} className={LABEL}>
            Sensor
          </label>
          <select id={ids.device} className={INPUT} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Sin sensor</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {hasSensor && (
            <div className="mt-1 flex flex-col gap-1.5">
              <label htmlFor={ids.channel} className={LABEL}>
                Canal de la placa
              </label>
              <input id={ids.channel} className={INPUT} value={channel} onChange={(e) => setChannel(e.target.value)} autoComplete="off" spellCheck={false} />
            </div>
          )}
          {!hasSensor && <p className="text-sm text-ink-3">Sin sensor no se mide la humedad ni se riega sola: solo se anotan los riegos a mano.</p>}
        </div>

        {hasSensor && (
          <>
            <div className="flex flex-col gap-3 rounded-control border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[15px] font-medium">Umbral propio</p>
                  <p className="text-sm text-ink-2">
                    {own ? 'Esta planta usa su propio umbral y objetivo.' : `${PLANTS.usesSector[0].toUpperCase()}${PLANTS.usesSector.slice(1)}${sector ? ` (${sector.thresholdPct} % · ${sector.targetPct} %)` : ''}.`}
                  </p>
                </div>
                <Switch
                  checked={own}
                  label="Umbral propio"
                  onChange={(next) => {
                    setOwn(next);
                    if (next) {
                      setThreshold(eff.thresholdPct);
                      setTarget(eff.targetPct);
                    }
                  }}
                />
              </div>
              {own && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[15px]">Empezar a regar cuando baje de</span>
                    <Stepper
                      label="Umbral de la planta"
                      display={`${thresholdPct} %`}
                      value={thresholdPct}
                      min={LIMITS.threshold.min}
                      max={Math.min(LIMITS.threshold.max, targetPct - LIMITS.gap)}
                      onChange={setThreshold}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[15px]">Regar hasta llegar a</span>
                    <Stepper
                      label="Objetivo de la planta"
                      display={`${targetPct} %`}
                      value={targetPct}
                      min={Math.max(LIMITS.target.min, thresholdPct + LIMITS.gap)}
                      max={LIMITS.target.max}
                      onChange={setTarget}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[15px] font-medium">Riego automático</p>
                <p className="text-sm text-ink-2">Riega solo si también está prendido el automático general.</p>
              </div>
              <Switch checked={auto} label="Riego automático de la planta" onChange={setAuto} />
            </div>
          </>
        )}

        {confirmArchive && <p className="text-sm text-ink-2">Archivar la saca de la vista y libera su canal. Se conservan todas sus lecturas y riegos.</p>}
        <p role="alert" className="min-h-5 text-sm text-alert">
          {error ?? (name.length > 0 ? invalid : undefined)}
        </p>
      </form>
    </Dialog>
  );
}
