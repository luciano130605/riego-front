import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Superficie base de todo el tablero. El padding lo pone quien la usa. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-card border border-line bg-card p-5 shadow-card sm:p-6', className)}
      {...rest}
    />
  );
}

export function CardTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-[17px] leading-tight font-semibold text-ink', className)} {...rest} />;
}
