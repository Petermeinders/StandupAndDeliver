import type { ReactNode } from 'react';

export function Accordion({ title, children, open = false, tone = 'flame' }: { title: string; children: ReactNode; open?: boolean; tone?: 'flame' | 'ash' }) {
  return (
    <details className="panel group mb-3 overflow-hidden" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-semibold [&::-webkit-details-marker]:hidden">
        <span className={tone === 'flame' ? 'text-flame' : 'text-ash'}>{title}</span>
        <svg className="h-4 w-4 text-smoke transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="space-y-3 border-t border-white/5 px-5 pt-4 pb-5 text-sm leading-relaxed text-smoke">{children}</div>
    </details>
  );
}

/** Inline emphasis inside rules text. */
export const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-ash">{children}</strong>;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-6" onClick={onClose} role="presentation">
      <div
        className="pop-in max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-coal p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-2xl">{title}</h2>
          <button className="btn btn-ghost -mr-2 px-3 py-2" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-sm text-smoke">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-char transition-colors peer-checked:bg-ember peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-flame after:absolute after:top-1 after:left-1 after:h-5 after:w-5 after:rounded-full after:bg-ash after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}

export function WinnerScreen({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="screen-in flex min-h-[70dvh] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="pop-in text-7xl" aria-hidden="true">
        🏆
      </div>
      <h1 className="font-display text-4xl text-flame sm:text-5xl">{title}</h1>
      {subtitle && <p className="text-smoke">{subtitle}</p>}
      {children}
      <p className="mt-6 text-sm text-smoke">Back to the lobby in a few seconds…</p>
    </div>
  );
}
