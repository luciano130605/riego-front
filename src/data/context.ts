import { createContext } from 'react';
import type { LabApi, RiegoApi } from './api';

export type RiegoContextValue = {
  api: RiegoApi;
  /** Solo existe cuando los datos son de prueba. */
  lab: LabApi | undefined;
};

export const RiegoContext = createContext<RiegoContextValue | null>(null);
