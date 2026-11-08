import { useId } from 'react';
import { cn } from '@/lib/cn';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  className?: string;
};

/** Elegir una opción entre pocas. Usa radios nativos: teclado y lectores de pantalla funcionan solos. */
export function Segmented<T extends string>({ label, value, options, onChange, className }: Props<T>) {
  const name = useId();
  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)}>
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex rounded-control border border-line bg-ground/40 p-0.5">
        {options.map((o) => (
          <label key={o.value} className="relative">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span className="grid min-h-10 cursor-pointer place-items-center rounded-[10px] px-3.5 text-sm text-ink-2 transition-colors duration-150 peer-checked:bg-raised peer-checked:font-semibold peer-checked:text-ink peer-checked:shadow-[inset_0_0_0_1px_var(--color-line)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent hover:text-ink">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
