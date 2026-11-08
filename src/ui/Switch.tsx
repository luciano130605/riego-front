import { cn } from '@/lib/cn';

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Texto que lee el lector de pantalla. */
  label: string;
  disabled?: boolean;
  id?: string;
};

/** Interruptor. El área táctil mide 44 px aunque el control se vea más chico. */
export function Switch({ checked, onChange, label, disabled, id }: Props) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex h-11 w-14 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        className={cn(
          'relative h-7 w-12 rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-[#3a3a3a]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-6 rounded-full bg-ink shadow-sm transition-transform duration-200',
            checked && 'translate-x-5',
          )}
        />
      </span>
    </button>
  );
}
