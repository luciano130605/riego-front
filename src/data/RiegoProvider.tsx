import { useMemo, useState, type ReactNode } from 'react';
import type { PushBackend, RiegoApi } from './api';
import { RiegoContext } from './context';
import { MockRiego } from './mockRiego';

type Props = {
  children: ReactNode;
  /** Para tests o para enchufar el backend real más adelante. */
  api?: RiegoApi;
  /** Servidor real para las notificaciones cuando los datos son de prueba. */
  backend?: PushBackend;
};

export function RiegoProvider({ children, api, backend }: Props) {
  // Se crea una sola vez por montaje; useState evita recrearlo en cada render.
  const [mock] = useState(() => (api ? undefined : new MockRiego({ backend })));
  const value = useMemo(
    () => ({ api: api ?? mock!, lab: mock }),
    [api, mock],
  );
  return <RiegoContext.Provider value={value}>{children}</RiegoContext.Provider>;
}
