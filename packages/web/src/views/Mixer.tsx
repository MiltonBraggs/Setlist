import { useMemo } from 'react';
import { groupDisplayName, parseTrackName, type LiveTrack } from '@setlist/core';
import { act, useMeters, useStore } from '../store.ts';

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
  if (v <= 0.001) return '−∞';
  const db = 40 * Math.log10(v / 0.85);
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export function Mixer() {
  const state = useStore((s) => s.state)!;
  const meters = useMeters();
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

  if (groups.length === 0) {
    return (
      <div className="p-8 text-center text-muted">
        No track groups. Add <code>+G:NAME</code> to track names in Live (e.g. <code>Vox 1 +G:VOX</code>).
      </div>
    );
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {groups.map((g) => {
        const muted = g.tracks.every((t) => t.mute || parseTrackName(t.name).neverMute);
        const solo = g.tracks.some((t) => t.solo);
        const volume = g.tracks.reduce((s, t) => s + t.volume, 0) / g.tracks.length;
        const level = Math.max(0, ...g.tracks.map((t) => Math.max(...(meters.get(t.id) ?? [0, 0]))));
        return (
          <div key={g.id} className="flex w-28 shrink-0 flex-col items-center gap-3 rounded-xl border border-line bg-panel p-3">
            <div className="h-1.5 w-full rounded-full" style={{ background: hex(g.tracks[0].color) }} />
            <div className="w-full truncate text-center text-sm font-semibold" title={g.name}>{g.name}</div>
            <div className="flex flex-1 items-stretch gap-2">
              <div className="relative w-3 overflow-hidden rounded-full bg-panel2">
                <div
                  className="absolute bottom-0 w-full transition-[height] duration-75"
                  style={{ height: `${Math.min(1, level) * 100}%`, background: level > 0.9 ? 'var(--danger)' : 'var(--ok)' }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.005}
                value={volume}
                disabled={state.locked}
                onChange={(e) => act('mixerGroup', g.id, 'volume', Number(e.target.value))}
                onDoubleClick={() => act('mixerGroup', g.id, 'volume', 0.85)}
                className="min-h-48 w-6 [writing-mode:vertical-lr] [direction:rtl]"
                aria-label={`${g.name} volume`}
              />
            </div>
            <div className="tabular text-xs text-muted">{volumeLabel(volume)}</div>
            <div className="flex w-full gap-1.5">
              <button
                disabled={state.locked}
                onClick={() => act('mixerGroup', g.id, 'toggleMute')}
                className={`flex-1 rounded-md py-2 text-sm font-bold ${muted ? 'bg-amber-500 text-black' : 'bg-panel2'}`}
              >
                M
              </button>
              <button
                disabled={state.locked}
                onClick={() => act('mixerGroup', g.id, 'toggleSolo')}
                className={`flex-1 rounded-md py-2 text-sm font-bold ${solo ? 'bg-sky-500 text-black' : 'bg-panel2'}`}
              >
                S
              </button>
            </div>
            <div className="text-xs text-muted">{g.tracks.length} track{g.tracks.length > 1 ? 's' : ''}</div>
          </div>
        );
      })}
    </div>
  );
}
