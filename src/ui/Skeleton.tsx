import { cn } from '@/lib/cn';

/** Bloque gris que ocupa el lugar de un dato mientras carga. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('rounded-lg bg-raised motion-safe:animate-pulse', className)} />;
}
