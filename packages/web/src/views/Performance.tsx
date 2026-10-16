import { useEffect, useState, type ReactNode } from 'react';
import { beatsPerBar, countdownLabel, formatDuration, metronomeSection, parseTrackName, playView, songLeadIn, type Song } from '@setlist/core';
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
  // The bar(s) between the song locator and the first section get a button with the song's name.
  const leadIn = songLeadIn(song);
  return (
    <nav aria-label="Song map" className="flex shrink-0 flex-wrap gap-1.5">
      {leadIn && (
        <SectionButton
          title={song.title}
          length={leadIn.end - leadIn.start}
          active={time >= leadIn.start && time < leadIn.end}
          locked={locked}
          onClick={() => act('jumpToSongStart', song.id)}
        />
      )}
      {song.sections.filter((sec) => !sec.metronome).map((sec) => {
        return (
          <SectionButton
            key={sec.id}
            title={sec.title}
            description={sec.description}
            length={sec.end - sec.start}
            active={time >= sec.start && time < sec.end}
            dim={sec.optional || sec.flags.skip}
            locked={locked}
            onClick={() => act('jumpToSection', song.id, sec.id)}
          />
        );
      })}
    </nav>
  );
}

function SectionButton({
  title,
  description,
  length,
  active,
  dim,
  locked,
  onClick,
}: {
  title: string;
  description?: string;
  length: number;
  active: boolean;
  dim?: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      title={description ? `${title} — ${description}` : title}
      style={{ flex: `${Math.max(1, length)} 1 110px` }}
      className={`relative min-h-11 min-w-[110px] truncate rounded-[14px] px-3 text-sm transition active:scale-[0.98] ${
        active ? 'bg-accent font-semibold text-onaccent' : `bg-panel ${dim ? 'text-faint line-through' : 'text-fg'} hover:brightness-95`
      }`}
    >
      {description && <span aria-hidden className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#ff9f0a]" />}
      {title}
    </button>
  );
}

/** Mute / unmute a set of tracks (+BACKING / +VOCALS): green while you hear them, red while muted. */
function MixButton({ label, muted, hotkey, disabled, onClick }: { label: string; muted: boolean; hotkey: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={muted}
      onClick={onClick}
      title={`${muted ? 'Unmute' : 'Mute'} ${label.toLowerCase()} (${hotkey})`}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-5 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-40 ${
        muted ? 'border-[#ff3b30] bg-[#ff3b30] text-white' : 'border-line2 text-fg hover:bg-panel2'
      }`}
    >
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${muted ? 'bg-white' : 'bg-[#30d158]'}`} />
      {muted ? `${label} muted` : label}
    </button>
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
  const access = useAccess();
  const navigate = access.can('navigate');
  const mixing = access.can('transport') && !state.locked;
  const hasMix = state.mix.backing !== null || state.mix.vocals !== null;
  const jumpLocked = state.locked || !navigate;
  const v = playView(state.songs, state.setlist, time, state.live.tempo, state.queued);
  const song = v.song;
  const entry = song ? state.setlist.entries.find((e) => e.songId === song.id) : undefined;
  const description = entry?.description ?? song?.description;
  // The next song's {description}, usually its key, so the band can get ready.
  const nextNote = v.nextSong ? (state.setlist.entries.find((e) => e.songId === v.nextSong!.id)?.description ?? v.nextSong.description) : undefined;
  const sectionSpan = v.section ? v.section.end - v.section.start : 0;
  const sectionPct = v.section ? Math.max(0, Math.min(100, ((time - v.section.start) / (sectionSpan || 1)) * 100)) : 0;
  const quick = song?.sections.filter((s) => s.quickAccess && !s.metronome) ?? [];
  // Emergency click: the song's metronome section, and where the button / GO return to.
  const click = song ? metronomeSection(song) : undefined;
  const inClick = !!v.section?.metronome;
  const clickReturn = state.metronomeReturn?.songId === song?.id ? state.metronomeReturn : null;
  const backTitle = clickReturn?.title ?? song?.sections.find((s) => !s.metronome)?.title ?? song?.title;
  const endTime = new Date(clock.getTime() + v.setRemaining * 1000);
  const fmtClock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sectionColor = v.section?.color ? colorOf(v.section.color) : undefined;
  // In the gap between the song locator and its first section, "Now" shows the song's name.
  const leadIn = song ? songLeadIn(song) : undefined;
  const inLeadIn = !!song && !!leadIn && !v.section && time >= leadIn.start && time < leadIn.end;
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

        {/* Phones: one column (the grid dissolves into it) with the section buttons above the setlist. */}
        <div className="grid gap-3 max-lg:contents lg:min-h-0 lg:flex-1 lg:grid-cols-[240px_minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* flex: the list is held to this box (half the screen on phones) and scrolls inside it. */}
          <div className="order-last flex max-h-[50vh] min-h-0 flex-col lg:order-none lg:max-h-none">
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
              {((quick.length > 0 || click) && song) || hasMix ? (
                <div className="flex flex-wrap gap-2">
                  {state.mix.backing !== null && (
                    <MixButton label="Backing" muted={state.mix.backing} hotkey="B" disabled={!mixing} onClick={() => act('toggleBacking')} />
                  )}
                  {state.mix.vocals !== null && (
                    <MixButton label="Vocals" muted={state.mix.vocals} hotkey="V" disabled={!mixing} onClick={() => act('toggleVocals')} />
                  )}
                  {click && song && (
                    <button
                      type="button"
                      disabled={jumpLocked}
                      aria-pressed={inClick}
                      onClick={() => act('metronome')}
                      title={inClick ? 'Back to the song at the next bar (GO does the same)' : 'Click only, at the next bar (K)'}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-[#ff9f0a] px-5 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-40 ${
                        inClick ? 'bg-[#ff9f0a] text-black' : 'text-fg hover:bg-[#ff9f0a]/15'
                      }`}
                    >
                      <span aria-hidden>{inClick ? '↩' : '♩'}</span>
                      {inClick ? `Back to ${backTitle}` : 'Metronome'}
                    </button>
                  )}
                  {song &&
                    quick.map((s) => (
                      <Button key={s.id} variant="outline" disabled={jumpLocked} onClick={() => act('jumpToSection', song.id, s.id)}>
                        {s.title}
                      </Button>
                    ))}
                </div>
              ) : null}
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
                {v.section?.title ?? (inLeadIn ? song.title : '—')}
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
            ) : inClick ? (
              <article aria-label="Leaving the metronome" className={`${card} gap-2 ring-2 ring-[#ff9f0a]`}>
                <p className="m-0 text-sm font-semibold text-muted">Metronome · GO goes back to</p>
                <h2 className={bigName}>{backTitle}</h2>
                <p className="m-0 text-[15px] text-muted">At the next bar. Or tap any section.</p>
              </article>
            ) : (
              <article className={`${card} gap-2`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="m-0 text-sm font-semibold text-muted">Next</p>
                  {countdown && <span className="text-sm font-semibold text-accent tabular">{countdown}</span>}
                </div>
                <h2 className={bigName}>{v.nextSection?.title ?? v.nextSong?.title ?? 'End of set'}</h2>
                {!v.nextSection && nextNote && <p className="m-0 text-[17px] font-semibold text-muted lg:text-[clamp(15px,2.2vh,22px)]">{nextNote}</p>}
                {v.nextSection?.description && <Cue text={v.nextSection.description} />}
                {v.nextSection && v.nextSong && (
                  <p className="m-0 text-[15px] text-muted">
                    Then {v.nextSong.title}
                    {nextNote && ` · ${nextNote}`}
                  </p>
                )}
              </article>
            )}
          </div>
        </div>

        {song && song.sections.length > 0 && <SongMap song={song} time={time} locked={jumpLocked} />}
      </div>
    </div>
  );
}
