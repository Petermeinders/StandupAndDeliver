import { useStore } from '../lib/store';

const TONE = { info: 'border-white/15', error: 'border-danger/70', good: 'border-spark/70' } as const;

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pop-in max-w-sm rounded-xl border bg-coal px-4 py-3 text-sm font-medium shadow-xl ${TONE[t.kind]}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
