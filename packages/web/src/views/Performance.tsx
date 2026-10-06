import { useEffect, useState } from 'react';
import { beatsPerBar, formatDuration, parseTrackName, playView, type Song } from '@setlist/core';
import { act, usePlayhead, useStore } from '../store.ts';
import { Button, colorOf } from '../components/ui.tsx';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Metronome({ time, color }: { time: number; color: string }) {
  const state = useStore((s) => s.state)!;
  const playing = useStore((s) => s.playing);
  const { sigNum, sigDen } = state.live;
  const bar = beatsPerBar(sigNum, sigDen);
  const beatLen = 4 / sigDen;
  const beat = Math.floor((((time % bar) + bar) % bar) / beatLen + 1e-6);
  const measureTrack = state.live.tracks.find((t) => parseTrackName(t.name).isMeasures);
  const measureClip = measureTrack?.clips?.find((c) => time >= c.start - 1e-6 && time < c.end - 1e-6);
  const measure = measureClip ? measureClip.name : String(Math.floor(time / bar) + 1);
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1.5">
        {Array.from({ length: sigNum }, (_, i) => (
          <div
            key={i}
            className="h-4 w-4 rounded-full transition-opacity duration-75"
            style={{ background: i === beat && playing ? color : 'var(--line)', opacity: i === beat && playing ? 1 : 0.8 }}
          />
        ))}
      </div>
      <span className="tabular text-sm text-muted">Bar {measure}</span>
    </div>
  );
}

function SongProgress({ song, time }: { song: Song; time: number }) {
  const span = song.end - song.start || 1;
  const pct = Math.max(0, Math.min(1, (time - song.start) / span)) * 100;
  const locked = useStore((s) => s.state!.locked);
  return (
    <div className="relative flex h-12 w-full overflow-hidden rounded-lg bg-panel2">
      {song.sections.map((sec) => {
        const left = ((sec.start - song.start) / span) * 100;
        const width = ((sec.end - sec.start) / span) * 100;
        const active = time >= sec.start && time < sec.end;
        return (
          <button
            key={sec.id}
            disabled={locked}
            onClick={() => act('jumpToSection', song.id, sec.id)}
            className={`absolute top-0 h-full truncate border-r border-bg px-2 text-left text-xs ${sec.optional || sec.flags.skip ? 'opacity-40' : ''}`}
            style={{ left: `${left}%`, width: `${width}%`, background: active ? `color-mix(in srgb, ${colorOf(sec.color ?? song.color, 'var(--accent)')} 35%, transparent)` : undefined }}
            title={sec.title}
          >
            {sec.title}
          </button>
        );
      })}
      <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-fg" style={{ left: `${pct}%` }} />
    </div>
  );
}

export function Performance() {
  const state = useStore((s) => s.state)!;
  const time = usePlayhead();
  const clock = useClock();
  const v = playView(state.songs, state.setlist, time, state.live.tempo, state.queued);
  const song = v.song;
  const color = colorOf(v.section?.color ?? song?.color, 'var(--accent)');
  const entry = song ? state.setlist.entries.find((e) => e.songId === song.id) : undefined;
  const description = entry?.description ?? song?.description;
  const sectionSpan = v.section ? v.section.end - v.section.start : 0;
  const quick = song?.sections.filter((s) => s.quickAccess) ?? [];
  const endTime = new Date(clock.getTime() + v.setRemaining * 1000);
  const fmtClock = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span>
          {v.songNumber > 0 ? `Song ${v.songNumber} of ${v.songCount}` : `${v.songCount} songs`} · {state.setlist.name}
        </span>
        <span className="tabular">
          {fmtClock(clock)} · set left {formatDuration(v.setRemaining)} · ends ≈ {fmtClock(endTime)}
        </span>
      </div>

      {state.queued && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent bg-accent/15 p-3">
          <span className="font-medium">
            Queued: {v.queuedSection ? `${v.queuedSection.title} (${v.queuedSong?.title})` : v.queuedSong?.title}
            {state.queued.hold && ' — jumps when stopped'}
          </span>
          <div className="flex-1" />
          <Button onClick={() => act('jumpQueuedNow')} variant="primary" disabled={state.locked}>
            Jump now
          </Button>
          <Button onClick={() => act('cancelQueue')} disabled={state.locked}>
            Cancel
          </Button>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-panel p-5" style={{ borderLeft: `8px solid ${colorOf(song?.color, 'var(--line)')}` }}>
        <div className="text-[clamp(2rem,6vw,4.5rem)] font-bold leading-tight">{song?.title ?? (v.nextSong ? `Next: ${v.nextSong.title}` : 'No song')}</div>
        {description && <div className="mt-1 text-xl text-muted">{description}</div>}
        {song && (
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 tabular text-lg">
            <span>{formatDuration(v.songElapsed)}</span>
            <span className="text-muted">−{formatDuration(v.songRemaining)}</span>
            <span className="text-muted">{Math.round(state.live.tempo)} BPM · {state.live.sigNum}/{state.live.sigDen}</span>
            <Metronome time={time} color={color} />
          </div>
        )}
      </div>

      {song && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-panel p-5">
            <div className="text-xs uppercase tracking-wider text-muted">Section</div>
            <div className="mt-1 flex items-center gap-3 text-[clamp(1.75rem,4vw,3rem)] font-semibold" style={{ color }}>
              {v.section?.title ?? '—'}
              {state.live.loop.on && <span className="rounded bg-accent px-2 py-0.5 text-sm text-white">LOOP</span>}
            </div>
            {v.section && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel2">
                <div className="h-full" style={{ width: `${Math.min(100, ((time - v.section.start) / (sectionSpan || 1)) * 100)}%`, background: color }} />
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-line bg-panel p-5">
            <div className="text-xs uppercase tracking-wider text-muted">Next</div>
            <div className="mt-1 text-[clamp(1.5rem,3.5vw,2.5rem)] font-semibold">
              {v.nextSection?.title ?? (v.nextSong ? v.nextSong.title : 'End of set')}
            </div>
            {v.nextSection && v.nextSong && <div className="text-muted">then {v.nextSong.title}</div>}
          </div>
        </div>
      )}

      {song && <SongProgress song={song} time={time} />}

      {quick.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quick.map((s) => (
            <Button key={s.id} disabled={state.locked} onClick={() => act('jumpToSection', song!.id, s.id)} className="h-12 px-5 text-base">
              {s.title}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
