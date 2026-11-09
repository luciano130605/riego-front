import { useId, useState, type FormEvent } from 'react';
import { LIMITS, validateLimits, validateName } from '@/core/garden';
import type { Sector } from '@/core/types';
import { useRiegoApi } from '@/data/hooks';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Stepper } from '@/ui/Stepper';
import { INPUT, LABEL } from './fields';
import { useGardenAction } from './useGardenAction';

type Props = {
  onClose: () => void;
  /** Sin sector se crea uno nuevo. */
  sector?: Sector;
};

/** Crear o editar un sector: nombre, umbral y objetivo. Borrar solo anda si no tiene plantas (lo dice el servidor). */
export function SectorDialog({ onClose, sector }: Props) {
  const api = useRiegoApi();
  const { run, busy } = useGardenAction();
  const formId = useId();
  const nameId = useId();
  const [name, setName] = useState(sector?.name ?? '');
  const [thresholdPct, setThreshold] = useState(sector?.thresholdPct ?? 35);
  const [targetPct, setTarget] = useState(sector?.targetPct ?? 55);
  const [error, setError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalid = validateName(name) ?? validateLimits(thresholdPct, targetPct);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || invalid) return;
    setError(undefined);
    const body = { name: name.trim(), thresholdPct, targetPct };
    const res = await run(sector ? api.updateSector(sector.id, body) : api.createSector(body), {
      inlineError: true,
      ok: sector ? 'Sector guardado.' : 'Sector creado.',
    });
    if (res.ok) onClose();
    else setError(res.error);
  }

  async function remove() {
    if (!sector || busy) return;
    setError(undefined);
    const res = await run(api.deleteSector(sector.id), { inlineError: true, ok: 'Sector borrado.' });
    if (res.ok) onClose();
    else {
      setError(res.error);
      setConfirmDelete(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={sector ? 'Editar sector' : 'Agregar sector'}
      description="Las plantas del sector usan su umbral y su objetivo, salvo que tengan los suyos."
      className="w-[min(30rem,calc(100%-1.5rem))]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {sector &&
              (confirmDelete ? (
                <Button variant="danger" onClick={() => void remove()} disabled={busy}>
                  Sí, borrar el sector
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Borrar sector
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
          <label htmlFor={nameId} className={LABEL}>
            Nombre
          </label>
          <input id={nameId} className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[15px]">Empezar a regar cuando baje de</span>
          <Stepper
            label="Umbral del sector"
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
            label="Objetivo del sector"
            display={`${targetPct} %`}
            value={targetPct}
            min={Math.max(LIMITS.target.min, thresholdPct + LIMITS.gap)}
            max={LIMITS.target.max}
            onChange={setTarget}
          />
        </div>
        {confirmDelete && <p className="text-sm text-ink-2">Un sector solo se puede borrar si no tiene plantas, ni siquiera archivadas.</p>}
        <p role="alert" className="min-h-5 text-sm text-alert">
          {error ?? (name.length > 0 ? invalid : undefined)}
        </p>
      </form>
    </Dialog>
  );
}
