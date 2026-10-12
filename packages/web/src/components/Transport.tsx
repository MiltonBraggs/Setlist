import { act, useAccess, useStore } from '../store.ts';
import { Icon, IconButton } from './ui.tsx';

/** Transport pill below every view (in normal flow, so it never covers content). */
export function Transport() {
  const playing = useStore((s) => s.playing);
  // Narrow selections: this bar shouldn't re-render on every state patch.
  const hasState = useStore((s) => !!s.state);
  const locked = useStore((s) => s.state?.locked ?? false);
  const loopOn = useStore((s) => s.state?.live.loop.on ?? false);
  const recording = useStore((s) => s.state?.live.recordMode ?? false);
  const access = useAccess();
  if (!hasState) return null;
  const transport = access.can('transport');
  const navigate = access.can('navigate');
  // Viewers without any control rights get no transport bar at all.
  if (!transport && !navigate) return null;

  return (
    <div className="no-print flex shrink-0 justify-center px-3 pt-1.5 pb-3">
      <div
        role="toolbar"
        aria-label="Transport"
        className="glass flex w-full max-w-[420px] flex-wrap items-center justify-between gap-1.5 rounded-[28px] bg-glass2 p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.12)] sm:w-auto sm:max-w-none sm:flex-nowrap sm:justify-center sm:rounded-full sm:px-3 sm:py-2"
      >
        {navigate && <IconButton icon="prev" label="Previous song (←)" disabled={locked} onClick={() => act('prevSong')} />}
        {navigate && <IconButton icon="up" label="Previous section (↑)" disabled={locked} onClick={() => act('prevSection')} />}
        {transport && (
          <button
            type="button"
            aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            disabled={locked}
            onClick={() => act('playPause')}
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-fg text-bg transition active:scale-95 disabled:opacity-40"
          >
            <Icon name={playing ? 'pause' : 'play'} className="h-7 w-7" />
          </button>
        )}
        {transport && <IconButton icon="stop" label="Stop" disabled={locked} onClick={() => act('stop')} className="!hidden sm:!grid" />}
        {navigate && <IconButton icon="down" label="Next section (↓)" disabled={locked} onClick={() => act('nextSection')} />}
        {navigate && <IconButton icon="next" label="Next song / escape loop (→)" disabled={locked} onClick={() => act('nextSong')} />}
        {navigate && <IconButton icon="loop" label="Loop section (L)" active={loopOn} disabled={locked} onClick={() => act('toggleLoop')} className="!hidden sm:!grid" />}
        {transport && (
          <button
            type="button"
            title="GO (G)"
            disabled={locked}
            onClick={() => act('go')}
            className="min-h-12 w-full rounded-full bg-accent px-7 text-[17px] font-semibold tracking-[0.02em] text-onaccent transition hover:brightness-110 active:scale-95 disabled:opacity-40 sm:ml-1 sm:w-auto"
          >
            GO
          </button>
        )}
        {access.isOwner && <span className="mx-1 hidden h-8 w-px bg-line sm:block" aria-hidden />}
        {transport && (
          <IconButton
            icon="record"
            label="Record (⇧R)"
            active={recording}
            disabled={locked}
            onClick={() => act('toggleRecord')}
            className={`!hidden sm:!grid ${recording ? '!text-danger' : 'text-muted'}`}
          />
        )}
        {access.isOwner && (
          <IconButton icon={locked ? 'lock' : 'unlock'} label="Lock controls (⇧L)" active={locked} onClick={() => act('toggleLock')} className={`!hidden sm:!grid ${locked ? '' : 'text-muted'}`} />
        )}
      </div>
    </div>
  );
}
