import { act, useStore } from '../store.ts';
import { Button, Icon } from './ui.tsx';

/** Bottom transport bar shared by all views. */
export function Transport() {
  const playing = useStore((s) => s.playing);
  const state = useStore((s) => s.state);
  if (!state) return null;
  const locked = state.locked;
  const loop = state.live.loop.on;
  const big = 'h-14 min-w-14 text-lg';
  return (
    <div className="no-print flex items-center gap-2 overflow-x-auto border-t border-line bg-panel px-3 py-2">
      <Button className={big} disabled={locked} onClick={() => act('prevSong')} title="Previous song (←)">
        <Icon name="prev" />
      </Button>
      <Button className={big} disabled={locked} onClick={() => act('prevSection')} title="Previous section (↑)">
        <Icon name="up" />
      </Button>
      <Button className={`${big} min-w-20`} variant={playing ? 'default' : 'primary'} disabled={locked} onClick={() => act('playPause')} title="Play / pause (Space)">
        <Icon name={playing ? 'pause' : 'play'} className="w-8 h-8" />
      </Button>
      <Button className={big} disabled={locked} onClick={() => act('stop')} title="Stop">
        <Icon name="stop" />
      </Button>
      <Button className={big} disabled={locked} onClick={() => act('nextSection')} title="Next section (↓)">
        <Icon name="down" />
      </Button>
      <Button className={big} disabled={locked} onClick={() => act('nextSong')} title="Next song / escape loop (→)">
        <Icon name="next" />
      </Button>
      <Button className={big} active={loop} disabled={locked} onClick={() => act('toggleLoop')} title="Loop section (L)">
        <Icon name="loop" />
      </Button>
      <Button className={`${big} min-w-20 font-bold tracking-wider`} variant="primary" disabled={locked} onClick={() => act('go')} title="GO">
        GO
      </Button>
      <div className="flex-1" />
      <Button className={big} variant="ghost" active={state.live.recordMode} disabled={locked} onClick={() => act('toggleRecord')} title="Record (⇧R)">
        <Icon name="record" className={`w-5 h-5 ${state.live.recordMode ? 'text-danger' : ''}`} />
      </Button>
      <Button className={big} variant="ghost" active={locked} onClick={() => act('toggleLock')} title="Lock controls (⇧L)">
        <Icon name={locked ? 'lock' : 'unlock'} />
      </Button>
    </div>
  );
}
