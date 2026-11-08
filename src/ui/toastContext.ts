import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export type ToastApi = {
  show: (kind: ToastKind, message: string) => void;
};

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('Falta <ToastProvider> arriba en el árbol.');
  return ctx;
}
