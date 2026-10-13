import { useEffect, useState, type ReactNode } from 'react';
import { beatsPerBar, countdownLabel, formatDuration, parseTrackName, playView, type Song } from '@setlist/core';
import { act, useAccess, usePlayhead, useStore } from '../store.ts';
import { NotesPanel } from '../components/Notes.tsx';
import { SetlistColumn } from '../components/SetlistColumn.tsx';
import { Button, colorOf } from '../components/ui.tsx';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Stat({ value, label, children }: { value?: string; label: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      {children ?? <span className="text-[26px] font-semibold tracking-[-0.02em] tabular lg:text-[clamp(20px,3.4vh,34px)]">{value}</span>}
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

export function Metronome({ time }: { time: number }) {
  const playing = useStore((s) => s.playing);
  const sigNum = useStore((s) => s.state!.live.sigNum);
  const sigDen = useStore((s) => s.state!.live.sigDen);
  const tracks = useStore((s) => s.state!.tracks);
  const bar = beatsPerBar(sigNum, sigDen);
  const beatLen = 4 / sigDen;
  const beat = Math.floor((((time % bar) + bar) % bar) / beatLen + 1e-6);
  const measureTrack = tracks.find((t) => parseTrackName(t.name).isMeasures);
  const measureClip = measureTrack?.clips?.find((c) => time >= c.start - 1e-6 && time < c.end - 1e-6);
  const measure = measureClip ? measureClip.name : String(Math.floor(time / bar) + 1);
  return (
    <Stat label={`Bar ${measure}`}>
      <span className="flex h-[31px] items-center gap-2 lg:h-[clamp(24px,4vh,41px)]" aria-hidden>
        {Array.from({ length: Math.min(sigNum, 16) }, (_, i) => (
          <span key={i} className={`h-3 w-3 rounded-full transition-colors duration-75 ${i === beat && playing ? 'bg-accent' : 'bg-line2'}`} />
        ))}
      </span>
    </Stat>
  );
}

/** All sections, always readable: buttons are at least 110 px and wrap onto more rows in long songs. */
function SongMap({ song, time, locked }: { song: Song; time: number; locked: boolean }) {
  return (
    <nav aria-label="Song map" className="flex shrink-0 flex-wrap gap-1.5">
      {song.sections.map((sec) => {
        const active = time >= sec.start && time < sec.end;
        const dim = sec.optional || sec.flags.skip;
        return (
          <button
            key={sec.id}
            type="button"
            disabled={locked}
            aria-current={active ? 'true' : undefined}
            onClick={() => act('jumpToSection', song.id, sec.id)}
            title={sec.description ? `${sec.title} — ${sec.description}` : sec.title}
            style={{ flex: `${Math.max(1, sec.end - sec.start)} 1 110px` }}
            className={`relative min-h-11 min-w-[110px] truncate rounded-[14px] px-3 text-sm transition active:scale-[0.98] ${
              active ? 'bg-accent font-semibold text-onaccent' : `bg-panel ${dim ? 'text-faint line-through' : 'text-fg'} hover:brightness-95`
            }`}
          >
            {sec.description && <span aria-hidden className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#ff9f0a]" />}
            {sec.title}
          </button>
        );
      })}
    </nav>
  );
}

/** A section description: a cue for the band, shown in orange. */
function Cue({ text, large }: { text: string; large?: boolean }) {
  return (
    <p
      className={`m-0 self-start rounded-[14px] bg-[#ff9f0a] px-3 py-1 font-semibold text-black [overflow-wrap:anywhere] ${
        large ? 'text-[19px] lg:text-[clamp(17px,2.8vh,30px)]' : 'text-[15px] lg:text-[clamp(14px,2.1vh,22px)]'
      }`}
    >
      {text}
    </p>
  );
}

const card = 'flex min-h-0 flex-col justify-center overflow-hidden rounded-[28px] bg-panel px-6 py-4 lg:px-7';
const bigName = 'm-0 text-[40px] leading-[1.05] font-bold tracking-[-0.03em] [overflow-wrap:anywhere] line-clamp-2 lg:text-[clamp(28px,6.5vh,76px)]';

export function Performance() {
  const state = useStore((s) => s.state)!;
  const time = usePlayhead();
  const playing = useStore((s) => s.playing);
  const clock = useClock();
  const navigate = useAccess().can('navigate');
  const jumpLocked = state.locked || !navigate;
  const v = playView(state.songs, state.setlist, time, state.live.tempo, state.queued);
  const song = v.song;
  const entry = song ? state.setlist.entries.find((e) => e.songId === song.id) : undefined;
  const description = entry?.description ?? song?.description;
  const sectionSpan = v.section ? v.section.end - v.section.start : 0;
  const sectionPct = v.section ? Math.max(0, Math.min(100, ((time - v.section.start) / (sectionSpan || 1)) * 100)) : 0;
  const quick = song?.sections.filter((s) => s.quickAccess) ?? [];
  const endTime = new Date(clock.getTime() + v.setRemaining * 1000);
  const fmtClock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sectionColor = v.section?.color ? colorOf(v.section.color) : undefined;
  const q = state.queued;
  const queuedName = v.queuedSection ? `${v.queuedSection.title} · ${v.queuedSong?.title}` : v.queuedSong?.title;
  const { sigNum, sigDen } = state.live;
  // Countdown to the next section, or to the end of the song after its last section.
  const nextAt = v.nextSection?.start ?? (song ? song.playEnd : undefined);
  const countdown = playing && nextAt !== undefined ? countdownLabel(time, nextAt, sigNum, sigDen) : null;

  return (
    <div className="h-full overflow-y-auto lg:overflow-hidden">
      <div className="mx-auto flex min-h-full max-w-[1500px] flex-col gap-3 px-4 pt-3 pb-2 sm:px-6 lg:h-full">
        <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          <span className="font-semibold text-accent">
            {v.songNumber > 0 ? `Song ${v.songNumber} of ${v.songCount}` : `${v.songCount} songs`} · {state.setlist.name}
          </span>
          <span className="text-muted tabular">
            {fmtClock(clock)} · {formatDuration(v.setRemaining)} left · ends ≈ {fmtClock(endTime)}
          </span>
        </div>

        <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[240px_minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="order-last max-h-[50vh] min-h-0 lg:order-none lg:max-h-none">
            <SetlistColumn currentId={song?.id} nextId={v.nextSong?.id} queuedId={q?.songId} canJump={!jumpLocked} />
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <article className={`${card} gap-[clamp(8px,1.5vh,16px)] lg:flex-1`}>
              <h1 className="headline m-0 text-[44px] [overflow-wrap:anywhere] line-clamp-2 lg:text-[clamp(34px,8vh,100px)]">
                {song?.title ?? v.nextSong?.title ?? 'No song'}
              </h1>
              <p className="m-0 text-xl text-muted lg:text-[clamp(16px,2.6vh,26px)]">
                {song ? description : v.nextSong ? 'Up next. Press GO to start.' : 'Add locators to your Arrangement in Live.'}
              </p>
              {song && (
                <div className="flex flex-wrap gap-x-7 gap-y-2">
                  <Stat value={formatDuration(v.songElapsed)} label="Elapsed" />
                  <Stat value={`−${formatDuration(v.songRemaining)}`} label="Remaining" />
                  <Stat value={String(Math.round(state.live.tempo))} label={`BPM · ${sigNum}/${sigDen}`} />
                  <Metronome time={time} />
                </div>
              )}
              {quick.length > 0 && song && (
                <div className="flex flex-wrap gap-2">
                  {quick.map((s) => (
                    <Button key={s.id} variant="outline" disabled={jumpLocked} onClick={() => act('jumpToSection', song.id, s.id)}>
                      {s.title}
                    </Button>
                  ))}
                </div>
              )}
            </article>
            <NotesPanel time={time} song={song} section={v.section} />
          </div>

          <div className="grid gap-3 lg:min-h-0 lg:grid-rows-2">
            <article className={`${card} gap-2`}>
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-sm font-semibold text-muted">Now</p>
                {state.live.loop.on && <span className="rounded-full bg-accent px-3 py-1 text-[13px] font-semibold text-onaccent">Looping</span>}
              </div>
              <h2 className={`${bigName} text-accent`} style={sectionColor ? { color: sectionColor } : undefined}>
                {v.section?.title ?? '—'}
              </h2>
              {v.section?.description && <Cue text={v.section.description} large />}
              <div className="mt-1 h-1.5 shrink-0 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent" style={{ width: `${sectionPct}%` }} />
              </div>
            </article>

            {q ? (
              <article aria-label="Queued jump" className={`${card} gap-2 ring-2 ring-accent`}>
                <p className="m-0 text-sm font-semibold text-accent">Queued · {q.hold ? 'when playback stops' : 'at the next boundary'}</p>
                <h2 className={bigName}>{queuedName}</h2>
                {navigate && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" onClick={() => act('jumpQueuedNow')} disabled={state.locked}>
                      Jump now
                    </Button>
                    <Button variant="ghost" onClick={() => act('cancelQueue')} disabled={state.locked}>
                      Cancel
                    </Button>
                  </div>
                )}
              </article>
            ) : (
              <article className={`${card} gap-2`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="m-0 text-sm font-semibold text-muted">Next</p>
                  {countdown && <span className="text-sm font-semibold text-accent tabular">{countdown}</span>}
                </div>
                <h2 className={bigName}>{v.nextSection?.title ?? v.nextSong?.title ?? 'End of set'}</h2>
                {v.nextSection?.description && <Cue text={v.nextSection.description} />}
                {v.nextSection && v.nextSong && <p className="m-0 text-[15px] text-muted">Then {v.nextSong.title}</p>}
              </article>
            )}
          </div>
        </div>

        {song && song.sections.length > 0 && <SongMap song={song} time={time} locked={jumpLocked} />}
      </div>
    </div>
  );
}
