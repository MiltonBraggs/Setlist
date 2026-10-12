import { act, useStore } from '../store.ts';
import { Icon, IconButton } from './ui.tsx';

/** Floating transport pill shared by all views. */
export function Transport() {
  const playing = useStore((s) => s.playing);
  const state = useStore((s) => s.state);
  if (!state) return null;
  const locked = state.locked;
  return (
    <div className="no-print pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6">
      <div
        role="toolbar"
        aria-label="Transport"
        className="glass pointer-events-auto flex w-full max-w-[420px] flex-wrap items-center justify-between gap-1.5 rounded-[28px] bg-glass2 p-3 shadow-[0_8px_32px_rgba(0,0,0,0.12)] sm:w-auto sm:max-w-none sm:flex-nowrap sm:justify-center sm:rounded-[32px] sm:px-3.5 sm:py-2.5"
      >
        <IconButton icon="prev" label="Previous song (←)" disabled={locked} onClick={() => act('prevSong')} />
        <IconButton icon="up" label="Previous section (↑)" disabled={locked} onClick={() => act('prevSection')} />
        <button
          type="button"
          aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          disabled={locked}
          onClick={() => act('playPause')}
          className="grid h-16 w-16 place-items-center rounded-full bg-fg text-bg transition active:scale-95 disabled:opacity-40"
        >
          <Icon name={playing ? 'pause' : 'play'} className="h-7 w-7" />
        </button>
        <IconButton icon="stop" label="Stop" disabled={locked} onClick={() => act('stop')} className="!hidden sm:!grid" />
        <IconButton icon="down" label="Next section (↓)" disabled={locked} onClick={() => act('nextSection')} />
        <IconButton icon="next" label="Next song / escape loop (→)" disabled={locked} onClick={() => act('nextSong')} />
        <IconButton icon="loop" label="Loop section (L)" active={state.live.loop.on} disabled={locked} onClick={() => act('toggleLoop')} className="!hidden sm:!grid" />
        <button
          type="button"
          title="GO (G)"
          disabled={locked}
          onClick={() => act('go')}
          className="min-h-12 w-full rounded-full bg-accent px-7 text-[17px] font-semibold tracking-[0.02em] text-onaccent transition hover:brightness-110 active:scale-95 disabled:opacity-40 sm:ml-1.5 sm:w-auto"
        >
          GO
        </button>
        <span className="mx-1 hidden h-8 w-px bg-line sm:block" aria-hidden />
        <IconButton
          icon="record"
          label="Record (⇧R)"
          active={state.live.recordMode}
          disabled={locked}
          onClick={() => act('toggleRecord')}
          className={`!hidden sm:!grid ${state.live.recordMode ? '!text-danger' : 'text-muted'}`}
        />
        <IconButton icon={locked ? 'lock' : 'unlock'} label="Lock controls (⇧L)" active={locked} onClick={() => act('toggleLock')} className={`!hidden sm:!grid ${locked ? '' : 'text-muted'}`} />
      </div>
    </div>
  );
}
