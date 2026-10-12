import { useMemo } from 'react';
import { groupDisplayName, parseTrackName, type LiveTrack } from '@setlist/core';
import { act, useAccess, useMeters, useStore } from '../store.ts';

interface Group {
  id: string;
  name: string;
  tracks: LiveTrack[];
}

function hex(color: number) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Live's volume parameter: 0.85 ≈ 0 dB. Rough dB display. */
function volumeLabel(v: number): string {
  if (v <= 0.001) return '−∞ dB';
  const db = 40 * Math.log10(v / 0.85);
  return `${db > 0.05 ? '+' : db < -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
}

export function Mixer() {
  const state = useStore((s) => s.state)!;
  const meters = useMeters();
  const canMix = useAccess().can('mixer') && !state.locked;
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const t of state.live.tracks) {
      for (const g of parseTrackName(t.name).groups) {
        if (!map.has(g)) map.set(g, { id: g, name: groupDisplayName(g), tracks: [] });
        map.get(g)!.tracks.push(t);
      }
    }
    return [...map.values()];
  }, [state.live.tracks]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-10 px-6 pt-16 pb-44">
        <section className="flex flex-col items-center gap-2 text-center">
          <h1 className="headline m-0 text-[clamp(48px,7vw,80px)]">Mixer.</h1>
          <p className="m-0 text-[21px] text-muted">{canMix ? 'Track groups from Live. Double-click a fader to reset it to 0 dB.' : 'Track groups from Live.'}</p>
        </section>

        {groups.length === 0 ? (
          <p className="m-0 text-center text-[17px] text-muted">
            No groups yet. Add <code>+G:NAME</code> to track names in Live, for example <code>Vox 1 +G:VOX</code>.
          </p>
        ) : (
          <section className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
            {groups.map((g) => {
              const muted = g.tracks.every((t) => t.mute || parseTrackName(t.name).neverMute);
              const solo = g.tracks.some((t) => t.solo);
              const volume = g.tracks.reduce((s, t) => s + t.volume, 0) / g.tracks.length;
              const level = Math.max(0, ...g.tracks.map((t) => Math.max(...(meters.get(t.id) ?? [0, 0]))));
              return (
                <article key={g.id} className="flex flex-col items-center gap-4 rounded-[24px] bg-panel px-4 py-5">
                  <div className="flex max-w-full items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hex(g.tracks[0].color) }} />
                    <h2 className="m-0 truncate text-[17px] font-semibold" title={g.name}>
                      {g.name}
                    </h2>
                  </div>
                  <div className="flex h-64 items-stretch gap-5">
                    <div aria-hidden className="relative w-1.5 overflow-hidden rounded-full bg-line">
                      <div
                        className={`absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-75 ${level > 0.9 ? 'bg-danger' : 'bg-ok'}`}
                        style={{ height: `${Math.min(1, level) * 100}%` }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.005}
                      value={volume}
                      disabled={!canMix}
                      onChange={(e) => act('mixerGroup', g.id, 'volume', Number(e.target.value))}
                      onDoubleClick={() => act('mixerGroup', g.id, 'volume', 0.85)}
                      aria-label={`${g.name} volume`}
                      aria-valuetext={volumeLabel(volume)}
                      className="w-10 cursor-pointer accent-[var(--accent)] [direction:rtl] [writing-mode:vertical-lr]"
                    />
                  </div>
                  <span className="text-[13px] text-muted tabular">{volumeLabel(volume)}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-label={`Mute ${g.name}`}
                      aria-pressed={muted}
                      disabled={!canMix}
                      onClick={() => act('mixerGroup', g.id, 'toggleMute')}
                      className={`h-11 w-11 rounded-full text-sm font-semibold transition active:scale-95 ${muted ? 'bg-[#ff9f0a] text-black' : 'bg-panel2'}`}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      aria-label={`Solo ${g.name}`}
                      aria-pressed={solo}
                      disabled={!canMix}
                      onClick={() => act('mixerGroup', g.id, 'toggleSolo')}
                      className={`h-11 w-11 rounded-full text-sm font-semibold transition active:scale-95 ${solo ? 'bg-accent text-onaccent' : 'bg-panel2'}`}
                    >
                      S
                    </button>
                  </div>
                  <span className="text-xs text-muted">
                    {g.tracks.length} track{g.tracks.length > 1 ? 's' : ''}
                  </span>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
