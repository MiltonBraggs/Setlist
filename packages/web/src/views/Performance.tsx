import { useEffect, useState } from 'react';
import { beatsPerBar, formatDuration, parseTrackName, playView, type Song } from '@setlist/core';
import { act, useAccess, usePlayhead, useStore } from '../store.ts';
import { Button, Eyebrow, colorOf } from '../components/ui.tsx';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Stat({ value, label, children }: { value?: string; label: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children ?? <span className="tabular text-[32px] font-semibold tracking-[-0.02em]">{value}</span>}
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

export function Metronome({ time }: { time: number }) {
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
    <Stat label={`Bar ${measure}`}>
      <span className="flex h-[38px] items-center gap-2" aria-hidden>
        {Array.from({ length: sigNum }, (_, i) => (
          <span key={i} className={`h-3 w-3 rounded-full transition-colors duration-75 ${i === beat && playing ? 'bg-accent' : 'bg-line2'}`} />
        ))}
      </span>
    </Stat>
  );
}

function SongMap({ song, time, locked }: { song: Song; time: number; locked: boolean }) {
  return (
    <div className="flex gap-1.5">
      {song.sections.map((sec) => {
        const active = time >= sec.start && time < sec.end;
        const dim = sec.optional || sec.flags.skip;
        return (
          <button
            key={sec.id}
            type="button"
            disabled={locked}
            onClick={() => act('jumpToSection', song.id, sec.id)}
            title={sec.title}
            style={{ flex: `${Math.max(1, sec.end - sec.start)} 1 0` }}
            className={`min-h-14 min-w-0 truncate rounded-[14px] px-2 text-sm transition active:scale-[0.98] ${
              active ? 'bg-accent font-semibold text-onaccent' : `bg-panel ${dim ? 'text-faint line-through' : 'text-fg'} hover:brightness-95`
            }`}
          >
            {sec.title}
          </button>
        );
      })}
    </div>
  );
}

export function Performance() {
  const state = useStore((s) => s.state)!;
  const time = usePlayhead();
  const clock = useClock();
  const navigate = useAccess().can('navigate');
  const jumpLocked = state.locked || !navigate;
  const v = playView(state.songs, state.setlist, time, state.live.tempo, state.queued);
  const song = v.song;
  const entry = song ? state.setlist.entries.find((e) => e.songId === song.id) : undefined;
  const description = entry?.description ?? song?.description;
  const sectionSpan = v.section ? v.section.end - v.section.start : 0;
  const sectionPct = v.section ? Math.min(100, ((time - v.section.start) / (sectionSpan || 1)) * 100) : 0;
  const quick = song?.sections.filter((s) => s.quickAccess) ?? [];
  const endTime = new Date(clock.getTime() + v.setRemaining * 1000);
  const fmtClock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sectionColor = v.section?.color ? colorOf(v.section.color) : undefined;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-12 px-6 pt-16 pb-44">
        <section className="flex flex-col items-center gap-3 text-center">
          <Eyebrow accent>
            {v.songNumber > 0 ? `Song ${v.songNumber} of ${v.songCount}` : `${v.songCount} songs`} · {state.setlist.name}
          </Eyebrow>
          <h1 className="headline m-0 text-[clamp(56px,9vw,112px)]">{song?.title ?? (v.nextSong ? v.nextSong.title : 'No song')}</h1>
          <p className="m-0 text-[28px] tracking-[-0.01em] text-muted">{song ? description : v.nextSong ? 'Up next. Press GO to start.' : 'Add locators to your Arrangement in Live.'}</p>
          {song && (
            <div className="mt-7 flex flex-wrap justify-center gap-12">
              <Stat value={formatDuration(v.songElapsed)} label="Elapsed" />
              <Stat value={`−${formatDuration(v.songRemaining)}`} label="Remaining" />
              <Stat value={String(Math.round(state.live.tempo))} label={`BPM · ${state.live.sigNum}/${state.live.sigDen}`} />
              <Metronome time={time} />
            </div>
          )}
        </section>

        {state.queued && (
          <section aria-label="Queued jump" className="flex flex-wrap items-center gap-4 rounded-[18px] bg-panel px-6 py-4">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
            <p className="m-0 min-w-[220px] flex-1 text-[17px]">
              Up next: <strong className="font-semibold">{v.queuedSection ? `${v.queuedSection.title} · ${v.queuedSong?.title}` : v.queuedSong?.title}</strong>{' '}
              <span className="text-muted">— {state.queued.hold ? 'when playback stops' : 'at the next boundary'}</span>
            </p>
            {navigate && (
              <>
                <Button variant="primary" onClick={() => act('jumpQueuedNow')} disabled={state.locked}>
                  Jump now
                </Button>
                <Button variant="ghost" onClick={() => act('cancelQueue')} disabled={state.locked}>
                  Cancel
                </Button>
              </>
            )}
          </section>
        )}

        {song && (
          <section className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-5">
            <article className="flex flex-col gap-3 rounded-[28px] bg-panel p-6 sm:p-10">
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-sm font-semibold text-muted">Now</p>
                {state.live.loop.on && <span className="rounded-full bg-accent px-3 py-1 text-[13px] font-semibold text-onaccent">Looping</span>}
              </div>
              <h2 className="m-0 text-[40px] font-bold sm:text-[56px] tracking-[-0.03em] text-accent" style={sectionColor ? { color: sectionColor } : undefined}>
                {v.section?.title ?? '—'}
              </h2>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent" style={{ width: `${sectionPct}%` }} />
              </div>
            </article>
            <article className="flex flex-col gap-3 rounded-[28px] bg-panel p-6 sm:p-10">
              <p className="m-0 text-sm font-semibold text-muted">Next</p>
              <h2 className="m-0 text-[40px] font-bold sm:text-[56px] tracking-[-0.03em]">{v.nextSection?.title ?? v.nextSong?.title ?? 'End of set'}</h2>
              {v.nextSection && v.nextSong && <p className="m-0 text-[17px] text-muted">Then {v.nextSong.title}</p>}
            </article>
          </section>
        )}

        {song && song.sections.length > 0 && (
          <section className="flex flex-col gap-3.5">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="m-0 text-[21px] font-semibold tracking-[-0.01em]">Song map</h3>
              {navigate && <span className="text-sm text-muted">Tap a section to jump</span>}
            </div>
            <SongMap song={song} time={time} locked={jumpLocked} />
            {quick.length > 0 && (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {quick.map((s) => (
                  <Button key={s.id} variant="outline" disabled={jumpLocked} onClick={() => act('jumpToSection', song.id, s.id)}>
                    {s.title}
                  </Button>
                ))}
              </div>
            )}
          </section>
        )}

        <p className="m-0 text-center text-sm text-muted tabular">
          Set ends at about {fmtClock(endTime)} · {formatDuration(v.setRemaining)} left
        </p>
      </div>
    </div>
  );
}
