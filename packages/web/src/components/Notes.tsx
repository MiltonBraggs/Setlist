import { Fragment, useMemo, useState } from 'react';
import { activeNotes, beatsPerBar, noteTracks, sectionNote, type ActiveNote, type LyricLine, type Section, type Song } from '@setlist/core';
import { usePref, useStore } from '../store.ts';
import { InlineText } from './InlineText.tsx';
import { Button, Dialog, colorOf } from './ui.tsx';

/** A note's text: rows from `\`, **bold** / *italic*, chords ignored. */
function NoteText({ line }: { line: LyricLine }) {
  return (
    <>
      {line.rows.map((parts, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <InlineText text={parts.map((p) => p.text).join('')} />
        </Fragment>
      ))}
    </>
  );
}

function inBars(bars: number) {
  return bars <= 1 ? 'next bar' : `in ${bars} bars`;
}

/** Notes data for the current position; memoised so only the time-dependent part runs per frame. */
export function useNotes(time: number, song: Song | undefined, section: Section | undefined) {
  const tracks = useStore((s) => s.state?.tracks);
  const sigNum = useStore((s) => s.state?.live.sigNum ?? 4);
  const sigDen = useStore((s) => s.state?.live.sigDen ?? 4);
  const [followed, setFollowed] = usePref<string[]>('followedParts', []);
  const all = useMemo(() => noteTracks(tracks ?? []), [tracks]);
  const partTitles = useMemo(() => [...new Set(all.filter((t) => !t.everyone).map((t) => t.title))], [all]);
  const shown = useMemo(() => all.filter((t) => t.everyone || followed.includes(t.title)), [all, followed]);
  const notes = activeNotes(shown, time, beatsPerBar(sigNum, sigDen), song?.end ?? Infinity);
  const everyone = notes.filter((n) => n.everyone && (n.current || n.barsToNext !== null));
  const parts = notes.filter((n) => !n.everyone);
  return { everyone, parts, sectionText: sectionNote(section), partTitles, followed, setFollowed };
}

export function PartPicker({ titles, followed, onChange, onClose }: { titles: string[]; followed: string[]; onChange: (v: string[]) => void; onClose: () => void }) {
  return (
    <Dialog title="Your parts" onClose={onClose}>
      <p className="mt-0 mb-4 text-[15px] text-muted">Show the notes for these parts on this device. Notes for everyone always show.</p>
      <div className="flex flex-wrap gap-2">
        {titles.map((title) => {
          const on = followed.includes(title);
          return (
            <button
              key={title}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? followed.filter((t) => t !== title) : [...followed, title])}
              className={`min-h-11 rounded-full px-5 text-[15px] transition ${on ? 'bg-accent text-onaccent' : 'bg-panel2'}`}
            >
              {title}
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

function EveryoneNote({ note }: { note: ActiveNote }) {
  const line = note.current ?? note.next!;
  const upcoming = !note.current;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[18px] px-5 py-2.5 ${upcoming ? 'border-2 border-[#ff9f0a] text-fg' : 'bg-[#ff9f0a] text-black'}`}
    >
      <span className="text-xs font-semibold tracking-[0.06em] uppercase opacity-80">{upcoming ? `Everyone · ${inBars(note.barsToNext!)}` : note.trackTitle}</span>
      <span className="min-w-0 text-[clamp(20px,3.4vh,36px)] leading-tight font-bold [overflow-wrap:anywhere]">
        <NoteText line={line} />
      </span>
    </div>
  );
}

function PartNote({ note }: { note: ActiveNote }) {
  const color = note.current?.color ?? note.color;
  return (
    <div className="flex min-w-[200px] flex-1 flex-col gap-0.5 rounded-[18px] bg-panel px-5 py-2.5">
      <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{note.trackTitle}</span>
      <span className="text-[clamp(20px,3.4vh,34px)] leading-tight font-bold [overflow-wrap:anywhere]" style={color ? { color: colorOf(color) } : undefined}>
        {note.current ? <NoteText line={note.current} /> : <span className="text-faint">—</span>}
      </span>
      {note.next && note.barsToNext !== null && (
        <span className="text-sm text-muted">
          Then <strong className="font-semibold text-fg">{<NoteText line={note.next} />}</strong> · {inBars(note.barsToNext)}
        </span>
      )}
    </div>
  );
}

/** Notes block for the Performance page. Renders nothing if the set has no notes. */
export function NotesPanel({ time, song, section }: { time: number; song?: Song; section?: Section }) {
  const { everyone, parts, sectionText, partTitles, followed, setFollowed } = useNotes(time, song, section);
  const [picking, setPicking] = useState(false);
  if (!sectionText && everyone.length === 0 && parts.length === 0 && partTitles.length === 0) return null;
  return (
    <section aria-label="Notes" className="flex flex-col gap-2">
      {sectionText && (
        <div role="status" className="rounded-[18px] bg-[#ff9f0a] px-5 py-2.5 text-[clamp(20px,3.4vh,36px)] leading-tight font-bold text-black [overflow-wrap:anywhere]">
          {sectionText}
        </div>
      )}
      {everyone.map((n) => (
        <EveryoneNote key={n.trackTitle} note={n} />
      ))}
      {(parts.length > 0 || partTitles.length > 0) && (
        <div className="flex flex-wrap items-stretch gap-2">
          {parts.map((n) => (
            <PartNote key={n.trackTitle} note={n} />
          ))}
          {partTitles.length > 0 && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className={`min-h-11 rounded-[18px] px-4 text-sm ${parts.length ? 'text-link hover:bg-panel' : 'flex-1 bg-panel text-link'}`}
            >
              {parts.length ? 'Parts…' : 'Choose your part to see its notes'}
            </button>
          )}
        </div>
      )}
      {picking && <PartPicker titles={partTitles} followed={followed} onChange={setFollowed} onClose={() => setPicking(false)} />}
    </section>
  );
}

/** One-line notes banner for the top of the Lyrics page. */
export function NotesBanner({ time, song, section }: { time: number; song?: Song; section?: Section }) {
  const { everyone, parts, sectionText } = useNotes(time, song, section);
  const items: { key: string; label: string; line?: LyricLine; text?: string; loud: boolean }[] = [];
  if (sectionText) items.push({ key: 'section', label: 'Everyone', text: sectionText, loud: true });
  for (const n of everyone) items.push({ key: n.trackTitle, label: n.current ? n.trackTitle : `Everyone · ${inBars(n.barsToNext!)}`, line: n.current ?? n.next, loud: !!n.current });
  for (const n of parts) if (n.current) items.push({ key: n.trackTitle, label: n.trackTitle, line: n.current, loud: false });
  if (items.length === 0) return null;
  return (
    <div className="no-print mx-auto flex w-full max-w-[980px] flex-wrap gap-2 px-6 pt-3">
      {items.map((it) => (
        <div
          key={it.key}
          role="status"
          className={`flex min-w-0 items-baseline gap-2 rounded-full px-4 py-1.5 ${it.loud ? 'bg-[#ff9f0a] text-black' : 'bg-panel2'}`}
        >
          <span className="text-[11px] font-semibold tracking-[0.06em] uppercase opacity-75">{it.label}</span>
          <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{it.line ? <NoteText line={it.line} /> : it.text}</span>
        </div>
      ))}
    </div>
  );
}
