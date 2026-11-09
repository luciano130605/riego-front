import { useEffect, useState, useSyncExternalStore } from 'react';
import { LoginScreen } from '@/features/auth/LoginScreen';
import { PinDialog } from '@/features/auth/PinDialog';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { GardenSkeleton } from '@/features/garden/GardenSkeleton';
import { GardenView } from '@/features/garden/GardenView';
import { PlantDetail } from '@/features/garden/PlantDetail';
import { useRoute } from '@/features/garden/useRoute';
import { useSnapshot } from '@/data/hooks';
import { API_URL } from '@/data/env';
import { HttpRiego } from '@/data/httpRiego';
import { RiegoProvider } from '@/data/RiegoProvider';
import { ToastProvider } from '@/ui/Toast';

// Con VITE_API_URL la pantalla habla con el backend; sin ella usa el simulador.
// Puede ser una lista separada por coma (por ejemplo local y Railway): si uno no responde, usa el otro.
const http = API_URL ? new HttpRiego(API_URL) : undefined;

/**
 * ¿El backend está en modo ejemplo (credenciales de eWeLink de ejemplo)? Entonces la pantalla muestra
 * datos inventados (el simulador). Con credenciales reales vuelve a mostrar lo del backend. Se consulta
 * al arrancar y se reintenta cada 10 s hasta que el servidor responda.
 */
function useBackendExample(api: HttpRiego | undefined): boolean {
  const [example, setExample] = useState(false);
  useEffect(() => {
    if (!api) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const status = await api.relayStatus();
      if (stopped) return;
      if (status.ok) setExample(status.example === true);
      else timer = setTimeout(() => void check(), 10_000);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api]);
  return example;
}

/**
 * Qué se ve: con sectores y plantas (backend nuevo y simulador) la vista general o el detalle de una planta, según la
 * dirección; con un backend viejo, que no los manda, el tablero de una sola planta de siempre.
 */
function Shell() {
  const snapshot = useSnapshot();
  const route = useRoute();
  if (snapshot.plants === undefined) return snapshot.load === 'loading' ? <GardenSkeleton /> : <Dashboard />;
  return route.name === 'plant' ? <PlantDetail id={route.id} /> : <GardenView />;
}

const noop = () => () => {};
const noSession = () => false;

/** ¿Hay sesión guardada? Sin backend (simulador) no hay sesión que pedir. */
function useSignedIn(api: HttpRiego | undefined): boolean {
  return useSyncExternalStore(
    api ? api.subscribeAuth : noop,
    api ? () => api.getAuthState().signedIn : noSession,
    noSession,
  );
}

export default function App() {
  const example = useBackendExample(http);
  const signedIn = useSignedIn(http);
  // Con backend real, sin sesión se ve la entrada; con el simulador (sin VITE_API_URL o en modo ejemplo) se salta.
  if (http && !example && !signedIn) {
    return (
      <ToastProvider>
        <LoginScreen auth={http} />
      </ToastProvider>
    );
  }
  return (
    // `key` hace que, al detectar el modo ejemplo, arranque el simulador desde cero.
    <RiegoProvider key={example ? 'ejemplo' : 'real'} api={example ? undefined : http} backend={http}>
      <ToastProvider>
        <Shell />
        {/* Con datos de prueba la API activa es el simulador, pero la push se pide al backend: el PIN va por él. */}
        <PinDialog auth={http} />
      </ToastProvider>
    </RiegoProvider>
  );
}
