import { useEffect, type ReactNode } from 'react';
import { resolveColor } from '@setlist/core';

const stroke = { stroke: 'currentColor', strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const paths: Record<string, ReactNode> = {
  play: <path d="M8 5v14l11-7z" fill="currentColor" />,
  pause: <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />,
  prev: <path d="M6 5h2v14H6zM19 5v14L9 12z" fill="currentColor" />,
  next: <path d="M16 5h2v14h-2zM5 5v14l10-7z" fill="currentColor" />,
  up: <path d="M6 15l6-6 6 6" {...stroke} />,
  down: <path d="M6 9l6 6 6-6" {...stroke} />,
  loop: (
    <g {...stroke}>
      <path d="M17 2l3 3-3 3" />
      <path d="M4 11V9a4 4 0 0 1 4-4h12" />
      <path d="M7 22l-3-3 3-3" />
      <path d="M20 13v2a4 4 0 0 1-4 4H4" />
    </g>
  ),
  record: <circle cx="12" cy="12" r="6" fill="currentColor" />,
  lock: <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" {...stroke} />,
  unlock: <path d="M7 11V8a5 5 0 0 1 9.6-2M6 11h12v9H6z" {...stroke} />,
  close: <path d="M6 6l12 12M18 6L6 18" {...stroke} />,
  plus: <path d="M12 5v14M5 12h14" {...stroke} />,
  grip: <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />,
  eye: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" {...stroke} />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />,
  restore: <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" {...stroke} />,
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
  variant?: 'default' | 'primary' | 'outline' | 'ghost' | 'danger';
}) {
  const base =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] transition select-none disabled:opacity-40 active:scale-[0.97]';
  const styles = {
    default: active ? 'bg-accent text-onaccent' : 'bg-panel2 text-fg hover:brightness-95',
    primary: 'bg-accent text-onaccent hover:brightness-110',
    outline: 'border border-line2 bg-panel text-fg hover:bg-panel2',
    ghost: active ? 'text-accent' : 'text-link hover:underline',
    danger: 'bg-danger text-white hover:brightness-110',
  }[variant];
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

/** Round icon button (transport, toolbars). */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  className = '',
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-12 w-12 shrink-0 place-items-center rounded-full transition disabled:opacity-40 active:scale-95 ${active ? 'bg-panel2 text-accent' : 'text-fg hover:bg-panel2'} ${className}`}
    >
      <Icon name={icon} className="h-[22px] w-[22px]" />
    </button>
  );
}

/** iOS-style switch. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-[31px] w-[51px] shrink-0 rounded-full p-0.5 transition-colors ${checked ? 'justify-end bg-switch' : 'justify-start bg-line2'}`}
    >
      <span className="h-[27px] w-[27px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]" />
    </button>
  );
}

/** Segmented control. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`flex flex-wrap gap-0.5 rounded-xl bg-panel2 p-[3px] ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`min-h-9 flex-1 whitespace-nowrap rounded-[9px] px-3 text-sm transition ${on ? 'bg-panel shadow-[0_1px_3px_rgba(0,0,0,0.15)]' : 'hover:bg-panel/50'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className = '',
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
      className={`min-h-9 rounded-xl bg-panel2 px-3 text-sm text-fg outline-none ${className}`}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Grouped list like iOS Settings: a title above a rounded white card of rows. */
export function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      {title && <h2 className="ml-5 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{title}</h2>}
      <div className="divide-y divide-line overflow-hidden rounded-[20px] bg-panel">{children}</div>
      {footer && <div className="mx-5 text-[13px] text-muted">{footer}</div>}
    </section>
  );
}

export function Row({ label, hint, children, stacked }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; stacked?: boolean }) {
  return (
    <div className={`flex min-h-16 gap-4 px-5 py-3 ${stacked ? 'flex-col' : 'flex-wrap items-center justify-between'}`}>
      <span className="flex flex-col gap-0.5">
        <span className="text-[17px]">{label}</span>
        {hint && <span className="text-sm text-muted">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[80vh] overflow-auto rounded-[28px] bg-panel p-6 shadow-[0_24px_64px_rgba(0,0,0,0.25)]`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-xl border border-line2 bg-panel px-4 text-[15px] outline-none focus:border-accent ${props.className ?? ''}`}
    />
  );
}

/** Small label above a big headline. */
export function Eyebrow({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <p className={`m-0 text-[15px] font-semibold ${accent ? 'text-accent' : 'text-muted'}`}>{children}</p>;
}
