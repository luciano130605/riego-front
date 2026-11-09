import { createContext, useContext, type ReactNode } from 'react';
import type { PlantView } from '@/core/types';

type Value = { plant: PlantView; order: PlantView[] };

const PlantScopeContext = createContext<Value | undefined>(undefined);

/**
 * La planta que se está mirando y el orden de sus vecinas (para pasar de una a otra). Los componentes de la pantalla
 * (humedad, gráficos, historial, riego) no cambian: leen el snapshot, que ya viene de esa planta.
 */
export function PlantScopeProvider({ value, children }: { value: Value; children: ReactNode }) {
  return <PlantScopeContext.Provider value={value}>{children}</PlantScopeContext.Provider>;
}

/** La planta a la vista, o undefined en la vista general. */
export function usePlantScope(): Value | undefined {
  return useContext(PlantScopeContext);
}
