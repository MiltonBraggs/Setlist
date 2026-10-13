import { useEffect, useState } from 'react';
import { canDispatch } from '@setlist/core';
import { act, loadPref, savePref, useAccess, useStore } from './store.ts';
import { RoleBadge } from './components/Access.tsx';
import { Transport } from './components/Transport.tsx';
import { Performance } from './views/Performance.tsx';
import { SetlistView } from './views/Setlist.tsx';
import { Lyrics } from './views/Lyrics.tsx';
import { SettingsView } from './views/Settings.tsx';

const VIEWS = {
  performance: { label: 'Performance', Component: Performance },
  setlist: { label: 'Setlist', Component: SetlistView },
  lyrics: { label: 'Lyrics', Component: Lyrics },
  settings: { label: 'Settings', Component: SettingsView },
} as const;
type ViewId = keyof typeof VIEWS;

/** The page in the URL, else the last page this device used (a singer's phone reopens on Lyrics). */
function viewFromHash(): ViewId {
  const id = location.hash.replace(/^#\/?/, '');
  if (id in VIEWS) return id as ViewId;
  const last = loadPref<string>('lastPage', 'performance');
  return last in VIEWS ? (last as ViewId) : 'performance';
}

/** AbleSet-compatible global shortcuts. View-specific ones live in the views. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, [string, ...unknown[]]> = {
        ' ': ['playPause'],
        'shift+ ': ['play'],
        'shift+R': ['toggleRecord'],
        ArrowLeft: ['prevSong'],
        ArrowRight: ['nextSong'],
        ArrowUp: ['prevSection'],
        ArrowDown: ['nextSection'],
        'shift+ArrowLeft': ['jumpByMeasures', -1],
        'shift+ArrowRight': ['jumpByMeasures', 1],
        l: ['toggleLoop'],
        'shift+L': ['toggleLock'],
        j: ['jumpQueued'],
        'shift+J': ['jumpQueuedNow'],
        c: ['cancelQueue'],
        g: ['go'],
      };
      const key = `${e.shiftKey && e.key !== 'Shift' ? 'shift+' : ''}${e.key}`;
      const entry = map[key];
      const { role, state } = useStore.getState();
      if (!entry || !state || !canDispatch(role ?? 'viewer', state.settings.viewer, entry[0])) return;
      e.preventDefault();
      act(entry[0], ...entry.slice(1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function NotificationOverlay() {
  const n = useStore((s) => s.state?.notification);
  const [dismissed, setDismissed] = useState<number | null>(null);
  if (!n || n.id === dismissed) return null;
  if (!n.big) {
    return (
      <button
        type="button"
        className="no-print glass fixed bottom-28 left-1/2 z-40 -translate-x-1/2 rounded-full bg-glass2 px-6 py-3 text-[15px] shadow-[0_8px_32px_rgba(0,0,0,0.15)]"
        onClick={() => setDismissed(n.id)}
      >
        {n.text}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label="Dismiss message"
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-8 text-center"
      onClick={() => setDismissed(n.id)}
    >
      <span className="headline text-[clamp(2.5rem,8vw,7rem)] text-white">{n.text}</span>
    </button>
  );
}

function Status({ connected, live }: { connected: boolean; live: boolean }) {
  const text = !connected ? 'Reconnecting…' : live ? 'Live connected' : 'Waiting for Live';
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${connected && live ? 'bg-ok' : connected ? 'bg-amber-400' : 'bg-danger'}`} title={text} />
      <span className="hidden sm:inline">{text}</span>
    </span>
  );
}

export function App() {
  const connected = useStore((s) => s.connected);
  const state = useStore((s) => s.state);
  const role = useStore((s) => s.role);
  const access = useAccess();
  const [view, setView] = useState<ViewId>(viewFromHash);
  useShortcuts();

  useEffect(() => {
    const onHash = () => {
      const next = viewFromHash();
      savePref('lastPage', next);
      setView(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.style.setProperty('--font-scale', String(state.settings.fontScale));
  }, [state?.settings.theme, state?.settings.fontScale]);

  if (!state || !role) {
    return <div className="flex h-full items-center justify-center text-muted">{connected ? 'Loading…' : 'Connecting to Setlist…'}</div>;
  }

  const visible = (Object.keys(VIEWS) as ViewId[]).filter((id) => access.canSee(id));
  // A viewer who opens a page they can't see lands on the first one they can.
  const current: ViewId | undefined = visible.includes(view) ? view : visible[0];
  const Component = current ? VIEWS[current].Component : null;
  return (
    <div className="flex h-full flex-col">
      <header className="no-print glass z-20 border-b border-line bg-glass">
        <nav aria-label="Main" className="mx-auto flex max-w-[1180px] items-center gap-2 px-4 py-1 sm:gap-4 sm:px-6">
          <a href="#/performance" className="inline-flex min-h-11 items-center text-[19px] font-semibold tracking-[-0.02em] text-fg no-underline">
            Setlist
          </a>
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] sm:justify-center">
            {visible.map((id) => (
              <a
                key={id}
                href={`#/${id}`}
                aria-current={current === id ? 'page' : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-[13px] no-underline transition sm:px-4 ${current === id ? 'bg-fg/[0.07] text-fg' : 'text-muted hover:text-fg'}`}
              >
                {VIEWS[id].label}
              </a>
            ))}
          </div>
          <RoleBadge />
          {state.locked && <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-semibold text-black">Locked</span>}
          <Status connected={connected} live={state.liveConnected} />
        </nav>
      </header>
      {connected && !state.liveConnected && (
        <div className="no-print bg-panel px-4 py-2 text-center text-sm text-muted">
          Waiting for Ableton Live. Choose <b className="text-fg">Setlist</b> as a Control Surface in Live’s preferences.
        </div>
      )}
      {access.isOwner && state.errors.length > 0 && current !== 'settings' && (
        <div className="no-print bg-panel px-4 py-2 text-center text-sm">
          The Remote Script reported an error.{' '}
          <a href="#/settings" className="text-link">
            Details
          </a>
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          {Component ? (
            <Component />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[17px] text-muted">The owner hasn’t shared any pages with viewers yet.</div>
          )}
        </div>
        <Transport />
      </main>
      <NotificationOverlay />
    </div>
  );
}
