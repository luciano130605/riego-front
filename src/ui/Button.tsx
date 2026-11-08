import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'raised' | 'primary' | 'ghost' | 'danger';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

const VARIANTS: Record<Variant, string> = {
  raised:
    'border border-line bg-raised text-ink hover:border-[#3a3a3a] hover:bg-[#242424] active:bg-[#1a1a1a] disabled:text-ink-3 disabled:hover:border-line disabled:hover:bg-raised',
  primary:
    'bg-accent font-semibold text-on-accent hover:brightness-110 active:brightness-95 disabled:bg-line disabled:text-ink-3 disabled:brightness-100',
  ghost: 'text-ink-2 hover:bg-raised hover:text-ink disabled:text-ink-3 disabled:hover:bg-transparent',
  danger:
    'border border-alert/40 bg-alert/10 text-ink hover:bg-alert/15 disabled:text-ink-3 disabled:hover:bg-alert/10',
};

export function Button({ variant = 'raised', className, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-[15px] font-medium transition-colors duration-150 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Obligatorio: el botón no tiene texto visible. */
  label: string;
};

/** Botón redondo con solo un ícono (campana, ajustes, cerrar). */
export function IconButton({ label, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'relative grid size-12 shrink-0 place-items-center rounded-full border border-line bg-card text-ink-2 transition-colors duration-150 hover:border-[#3a3a3a] hover:bg-raised hover:text-ink active:bg-[#1a1a1a]',
        className,
      )}
      {...rest}
    />
  );
}
