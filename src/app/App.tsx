import { useEffect, useState } from 'react';
import { Dashboard } from '@/features/dashboard/Dashboard';
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

export default function App() {
  const example = useBackendExample(http);
  return (
    // `key` hace que, al detectar el modo ejemplo, arranque el simulador desde cero.
    <RiegoProvider key={example ? 'ejemplo' : 'real'} api={example ? undefined : http} backend={http}>
      <ToastProvider>
        <Dashboard />
      </ToastProvider>
    </RiegoProvider>
  );
}
