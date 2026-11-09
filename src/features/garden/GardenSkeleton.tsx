import { Skeleton } from '@/ui/Skeleton';

/** Mientras llegan los datos: el encabezado, los chips y unas tarjetas, sin inventar ningún número. */
export function GardenSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando" className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 py-6 sm:px-8 sm:py-9">
      <Skeleton className="h-12 w-64 max-w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36 w-full" />
        ))}
      </div>
    </div>
  );
}
