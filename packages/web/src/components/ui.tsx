import { useEffect, type ReactNode } from 'react';
import { resolveColor } from '@setlist/core';

const paths: Record<string, ReactNode> = {
  play: <path d="M7 4.5v15l13-7.5z" fill="currentColor" />,
  pause: <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" />,
  prev: <path d="M6 5h2.5v14H6zM20 5v14L9.5 12z" fill="currentColor" />,
  next: <path d="M15.5 5H18v14h-2.5zM4 5v14l10.5-7z" fill="currentColor" />,
  up: <path d="M12 5l7 9H5z" fill="currentColor" />,
  down: <path d="M12 19l-7-9h14z" fill="currentColor" />,
  loop: <path d="M17 7H7a4 4 0 0 0-4 4v1m4 5h10a4 4 0 0 0 4-4v-1M14 4l3 3-3 3M10 20l-3-3 3-3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  record: <circle cx="12" cy="12" r="7" fill="currentColor" />,
  lock: <path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v10H5z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" />,
  unlock: <path d="M7 10V7a5 5 0 0 1 9.6-2M5 10h14v10H5z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" />,
  close: <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  plus: <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />,
  eye: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" strokeWidth="2" fill="none" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />,
  restore: <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />,
};

export function Icon({ name, className = 'w-6 h-6' }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}

export function colorOf(color: string | undefined, fallback = 'var(--muted)'): string {
  return resolveColor(color) ?? fallback;
}

export function Button({
  children,
  onClick,
  active,
  disabled,
  title,
  className = '',
  variant = 'default',
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
}) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors select-none disabled:opacity-40';
  const styles = {
    default: active ? 'bg-accent text-white' : 'bg-panel2 hover:brightness-125 text-fg',
    primary: 'bg-accent text-white hover:brightness-110',
    ghost: active ? 'text-accent' : 'text-muted hover:text-fg',
    danger: 'bg-danger text-white hover:brightness-110',
  }[variant];
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 cursor-pointer">
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-5.5' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
      className={`rounded-lg border border-line bg-panel2 px-2 py-1.5 text-sm ${className}`}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] no-print" onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[80vh] overflow-auto rounded-xl border border-line bg-panel p-4 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} title="Close">
            <Icon name="close" className="w-5 h-5" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent ${props.className ?? ''}`} />;
}
