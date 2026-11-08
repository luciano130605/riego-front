import type { ReactNode } from 'react';

type Props = {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
};

/** Una fila de ajuste: qué es a la izquierda, el control a la derecha. */
export function SettingRow({ label, hint, children }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-[15px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-sm text-ink-2">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-0">
      <h3 className="mb-1 text-sm font-semibold text-ink-2">{title}</h3>
      <div className="rounded-control border border-line bg-ground/40 px-4 py-4">{children}</div>
    </section>
  );
}
