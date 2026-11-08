import { cn } from '@/lib/cn';
import { MinusIcon, PlusIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

type Props = {
  label: string;
  /** Texto que se muestra, ya con su unidad. */
  display: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Paso que depende del valor y del sentido (+1 sube, −1 baja). Tiene prioridad sobre `step`. */
  stepFor?: (value: number, dir: 1 | -1) => number;
  onChange: (value: number) => void;
  /** Bloquea los dos botones: el valor se muestra pero no se puede cambiar. */
  disabled?: boolean;
  className?: string;
};

/** Valor con botones − y +. Cada botón mide 44 px para usarlo con el dedo. */
export function Stepper({ label, display, value, min, max, step = 1, stepFor, onChange, disabled, className }: Props) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  const btn =
    'grid size-11 place-items-center rounded-control text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink active:bg-[#1a1a1a] disabled:text-line disabled:hover:bg-transparent disabled:hover:text-line';

  return (
    <div
      role="group"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn('inline-flex items-center rounded-control border border-line bg-ground/40', disabled && 'opacity-60', className)}
    >
      <button
        type="button"
        className={btn}
        aria-label={`Bajar: ${label}`}
        disabled={disabled || value <= min}
        onClick={() => set(value - (stepFor ? stepFor(value, -1) : step))}
      >
        <HugeiconsIcon icon={MinusIcon} size={16} aria-hidden />
      </button>
      <output aria-live="polite" className="min-w-16 text-center text-[15px] font-medium tabular-nums">
        {display}
      </output>
      <button
        type="button"
        className={btn}
        aria-label={`Subir: ${label}`}
        disabled={disabled || value >= max}
        onClick={() => set(value + (stepFor ? stepFor(value, 1) : step))}
      >
        <HugeiconsIcon icon={PlusIcon} size={16} aria-hidden />
      </button>
    </div>
  );
}
