import { useEffect, useState } from 'react';
import { act, useStore } from './store.ts';
import { Transport } from './components/Transport.tsx';
import { Button } from './components/ui.tsx';
import { Performance } from './views/Performance.tsx';
import { SetlistView } from './views/Setlist.tsx';
import { Lyrics } from './views/Lyrics.tsx';
import { Mixer } from './views/Mixer.tsx';
import { SettingsView } from './views/Settings.tsx';

const VIEWS = {
  performance: { label: 'Performance', Component: Performance },
  setlist: { label: 'Setlist', Component: SetlistView },
  lyrics: { label: 'Lyrics', Component: Lyrics },
  mixer: { label: 'Mixer', Component: Mixer },
  settings: { label: 'Settings', Component: SettingsView },
} as const;
type ViewId = keyof typeof VIEWS;

function viewFromHash(): ViewId {
  const id = location.hash.replace(/^#\/?/, '');
  return id in VIEWS ? (id as ViewId) : 'performance';
}

/** AbleSet-compatible global shortcuts. View-specific ones live in the views. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, () => void> = {
        ' ': () => act('playPause'),
        'shift+ ': () => act('play'),
        'shift+R': () => act('toggleRecord'),
        ArrowLeft: () => act('prevSong'),
        ArrowRight: () => act('nextSong'),
        ArrowUp: () => act('prevSection'),
        ArrowDown: () => act('nextSection'),
        'shift+ArrowLeft': () => act('jumpByMeasures', -1),
        'shift+ArrowRight': () => act('jumpByMeasures', 1),
        l: () => act('toggleLoop'),
        'shift+L': () => act('toggleLock'),
        j: () => act('jumpQueued'),
        'shift+J': () => act('jumpQueuedNow'),
        c: () => act('cancelQueue'),
        g: () => act('go'),
      };
      const key = `${e.shiftKey && e.key !== 'Shift' ? 'shift+' : ''}${e.key}`;
      const fn = map[key];
      if (fn) {
        e.preventDefault();
        fn();
      }
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
      <div className="no-print fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-line bg-panel px-4 py-3 shadow-xl" onClick={() => setDismissed(n.id)}>
        {n.text}
      </div>
    );
  }
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-8 text-center" onClick={() => setDismissed(n.id)}>
      <div className="text-[clamp(2rem,8vw,6rem)] font-bold leading-tight text-white">{n.text}</div>
    </div>
  );
}

export function App() {
  const connected = useStore((s) => s.connected);
  const state = useStore((s) => s.state);
  const [view, setView] = useState<ViewId>(viewFromHash);
  useShortcuts();

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.settings.theme;
    document.documentElement.style.setProperty('--font-scale', String(state.settings.fontScale));
  }, [state?.settings.theme, state?.settings.fontScale]);

  if (!state) {
    return <div className="flex h-full items-center justify-center text-muted">{connected ? 'Loading…' : 'Connecting to Setlist…'}</div>;
  }

  const { Component } = VIEWS[view];
  return (
    <div className="flex h-full flex-col">
      <nav className="no-print flex items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2">
        <span className="mr-3 px-2 font-bold tracking-tight">Setlist</span>
        {(Object.keys(VIEWS) as ViewId[]).map((id) => (
          <a
            key={id}
            href={`#/${id}`}
            className={`border-b-2 px-3 py-3 text-sm font-medium ${view === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {VIEWS[id].label}
          </a>
        ))}
        <div className="flex-1" />
        {state.locked && <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">LOCKED</span>}
        <span
          className={`ml-2 h-2.5 w-2.5 shrink-0 rounded-full ${connected && state.liveConnected ? 'bg-ok' : 'bg-danger'}`}
          title={connected ? (state.liveConnected ? 'Connected to Live' : 'Waiting for Live') : 'Disconnected'}
        />
      </nav>
      {!connected && <div className="no-print bg-danger px-4 py-1.5 text-center text-sm text-white">Connection to Setlist lost. Reconnecting…</div>}
      {connected && !state.liveConnected && (
        <div className="no-print bg-amber-500 px-4 py-1.5 text-center text-sm text-black">
          Waiting for Ableton Live: select <b>Setlist</b> as a Control Surface in Live's preferences.
        </div>
      )}
      {state.errors.length > 0 && view !== 'settings' && (
        <div className="no-print flex items-center justify-center gap-3 bg-danger/20 px-4 py-1 text-sm">
          Remote Script reported errors.
          <Button variant="ghost" onClick={() => (location.hash = '#/settings')}>Details</Button>
        </div>
      )}
      <main className="min-h-0 flex-1">
        <Component />
      </main>
      <Transport />
      <NotificationOverlay />
    </div>
  );
}
