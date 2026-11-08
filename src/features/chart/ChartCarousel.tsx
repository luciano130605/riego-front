import { Children, type ReactNode } from 'react';
import { SwipePager } from '@/ui/SwipePager';

/**
 * Gráficos en mobile: se deslizan con el dedo, uno a la vez, con puntitos que indican en cuál se está
 * (el siguiente asoma a la derecha). Desde `md` vuelven a ser una grilla de dos columnas.
 */
export function ChartCarousel({ children, labels }: { children: ReactNode; labels: string[] }) {
  return (
    <div className="col-span-full min-w-0">
      <SwipePager
        pages={Children.toArray(children)}
        labels={labels}
        ariaLabel="Gráficos de humedad. Deslizá para ver el otro."
        className="-mx-4 scroll-px-4 px-4 pb-1 sm:-mx-8 sm:scroll-px-8 sm:px-8 md:mx-0 md:grid md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 md:pb-0"
        pageClassName="basis-[92%] md:basis-auto md:shrink"
      />
    </div>
  );
}
