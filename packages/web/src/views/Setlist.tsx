import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDuration, playView, searchSongs, setlistToText, type SetlistEntry, type Song } from '@setlist/core';
import { act, usePlayhead, usePref, useStore } from '../store.ts';
import { Button, Dialog, Eyebrow, Icon, IconButton, TextInput, colorOf } from '../components/ui.tsx';

type DialogKind = null | 'add' | 'save' | 'load' | 'import' | { details: string };

export function SetlistView() {
  const state = useStore((s) => s.state)!;
  const time = usePlayhead();
  const [editing, setEditing] = useState(false);
  const [hideRemoved, setHideRemoved] = usePref('hideRemoved', false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const songs = useMemo(() => new Map(state.songs.map((s) => [s.id, s])), [state.songs]);
  const v = playView(state.songs, state.setlist, time, state.live.tempo, state.queued);
  const entries = state.setlist.entries;
  const active = entries.filter((e) => !e.removed);
  const total = active.reduce((sum, e) => sum + (songs.get(e.songId)?.duration ?? 0), 0);

  const update = (next: SetlistEntry[]) => act('setSetlist', { ...state.setlist, entries: next });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || dialog) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setEditing(true);
        setDialog('add');
      } else if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        window.print();
      } else if (mod && e.key === 'Enter' && editing) {
        setEditing(false);
      } else if (e.shiftKey && !mod && e.key === 'S') {
        setDialog('save');
      } else if (e.shiftKey && !mod && e.key === 'O') {
        setDialog('load');
      } else if (e.shiftKey && !mod && e.key === 'H') {
        setHideRemoved(!hideRemoved);
      } else {
        return;
      }
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = entries.findIndex((x) => x.songId === e.active.id);
    const to = entries.findIndex((x) => x.songId === e.over!.id);
    update(arrayMove(entries, from, to));
  };

  const visible = editing ? entries.filter((e) => !(hideRemoved && e.removed)) : active;
  const nextId = v.nextSong?.id;
  let number = 0;

  return (
    <div className="h-full overflow-auto">
      <div className="no-print mx-auto flex max-w-[980px] flex-col gap-10 px-6 pt-16 pb-44">
        <section className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-2">
            <Eyebrow accent>{state.setlist.name}</Eyebrow>
            <h1 className="headline m-0 text-[clamp(48px,7vw,80px)]">Tonight’s set.</h1>
            <p className="m-0 text-[21px] text-muted tabular">
              {active.length} songs · {formatDuration(total)} total · {formatDuration(v.setRemaining)} left
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {editing ? (
              <>
                <Button variant="outline" onClick={() => setDialog('add')} title="Add songs (Ctrl+K)">
                  <Icon name="plus" className="h-4 w-4" /> Add
                </Button>
                <Button variant="outline" active={hideRemoved} onClick={() => setHideRemoved(!hideRemoved)} title="Hide removed songs (⇧H)">
                  {hideRemoved ? 'Show removed' : 'Hide removed'}
                </Button>
                <Button variant="outline" onClick={() => setDialog('save')} title="Save setlist (⇧S)">
                  Save
                </Button>
                <Button variant="outline" onClick={() => setDialog('import')}>
                  Import / Export
                </Button>
                <Button variant="primary" onClick={() => setEditing(false)} title="Done (Ctrl+Enter)">
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => window.print()} title="Print (Ctrl+P)">
                  Print
                </Button>
                <Button variant="outline" onClick={() => setDialog('load')} title="Load setlist (⇧O)">
                  Load
                </Button>
                <Button variant="primary" onClick={() => setEditing(true)} disabled={state.locked}>
                  Edit
                </Button>
              </>
            )}
          </div>
        </section>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((e) => e.songId)} strategy={verticalListSortingStrategy}>
            <ol className="m-0 flex list-none flex-col rounded-[28px] bg-panel p-0">
              {visible.map((entry, i) => {
                const song = songs.get(entry.songId);
                if (!song) return null;
                if (!entry.removed && !song.noSong) number++;
                return (
                  <SongRow
                    key={entry.songId}
                    song={song}
                    entry={entry}
                    first={i === 0}
                    number={entry.removed || song.noSong ? null : number}
                    editing={editing}
                    current={v.song?.id === song.id}
                    upNext={nextId === song.id || state.queued?.songId === song.id}
                    progress={v.song?.id === song.id ? v.loc.songProgress : 0}
                    currentSectionId={v.song?.id === song.id ? v.section?.id : undefined}
                    locked={state.locked}
                    onToggleRemoved={() => update(entries.map((e) => (e.songId === song.id ? { ...e, removed: !e.removed } : e)))}
                    onDetails={() => setDialog({ details: song.id })}
                  />
                );
              })}
            </ol>
          </SortableContext>
        </DndContext>
        {state.songs.length === 0 && <p className="m-0 text-center text-muted">No songs yet. Add locators to your Arrangement in Live.</p>}
        <p className="m-0 text-center text-sm text-muted">{editing ? 'Drag to reorder. Removed songs stay in the list, dimmed.' : 'Tap a song to queue it. Right-click for details.'}</p>
      </div>

      <PrintView />

      {dialog === 'add' && (
        <AddSongsDialog
          onClose={() => setDialog(null)}
          onAdd={(id) => update([...entries.filter((e) => e.songId !== id), { ...entries.find((e) => e.songId === id)!, removed: false }])}
        />
      )}
      {dialog === 'save' && <SaveDialog onClose={() => setDialog(null)} />}
      {dialog === 'load' && <LoadDialog onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && (
        <DetailsDialog
          song={songs.get(dialog.details)!}
          entry={entries.find((e) => e.songId === dialog.details)!}
          onClose={() => setDialog(null)}
          onSave={(patch) => update(entries.map((e) => (e.songId === dialog.details ? { ...e, ...patch } : e)))}
        />
      )}
    </div>
  );
}

function SongRow(props: {
  song: Song;
  entry: SetlistEntry;
  first: boolean;
  number: number | null;
  editing: boolean;
  current: boolean;
  upNext: boolean;
  progress: number;
  currentSectionId?: string;
  locked: boolean;
  onToggleRemoved: () => void;
  onDetails: () => void;
}) {
  const { song, entry, editing, current } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id, disabled: !editing });
  const description = entry.description ?? song.description;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`relative flex flex-col ${props.first ? '' : 'border-t border-line'} ${isDragging ? 'rounded-[20px] bg-panel shadow-[0_12px_40px_rgba(0,0,0,0.18)]' : ''} ${entry.removed ? 'opacity-40' : ''}`}
    >
      {entry.stopDescription && <div className="px-8 pt-4 pl-28 text-[15px] italic text-muted">— {entry.stopDescription} —</div>}
      <div className="flex items-center gap-2 px-4 sm:px-6">
        {editing && (
          <button type="button" className="grid h-11 w-8 touch-none place-items-center text-muted" {...attributes} {...listeners} aria-label={`Drag ${song.title}`}>
            <Icon name="grip" className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-5 py-6 text-left"
          disabled={editing || props.locked}
          onClick={() => act('jumpToSong', song.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            props.onDetails();
          }}
        >
          <span className="w-7 text-right text-[17px] text-muted tabular">{props.number ?? ''}</span>
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(song.color, 'var(--line-2)') }} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[28px] font-semibold tracking-[-0.02em]">{song.title}</span>
            {(description || song.tags.length > 0 || song.stopBefore) && (
              <span className="truncate text-[15px] text-muted">
                {[song.stopBefore ? 'Stops before this song' : null, description, ...song.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          {current && !editing && <span className="text-[13px] font-semibold text-accent">Playing</span>}
          {!current && props.upNext && !editing && <span className="rounded-full bg-accent/10 px-3 py-1 text-[13px] font-semibold text-link">Up next</span>}
          <span className="text-[17px] text-muted tabular">{formatDuration(song.duration)}</span>
        </button>
        {editing && (
          <>
            <IconButton icon="more" label={`Details for ${song.title}`} onClick={props.onDetails} />
            <IconButton icon={entry.removed ? 'restore' : 'close'} label={entry.removed ? `Restore ${song.title}` : `Remove ${song.title}`} onClick={props.onToggleRemoved} />
          </>
        )}
      </div>
      {current && !editing && song.sections.length > 0 && (
        <div className="flex flex-col gap-4 px-6 pb-6 pl-[104px]">
          <div className="flex flex-wrap gap-2">
            {song.sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                disabled={props.locked}
                onClick={() => act('jumpToSection', song.id, sec.id)}
                className={`min-h-9 rounded-full px-4 text-sm transition ${sec.id === props.currentSectionId ? 'bg-accent text-onaccent' : 'bg-panel2 hover:brightness-95'} ${sec.optional || sec.flags.skip ? 'text-faint' : ''}`}
              >
                {sec.title}
              </button>
            ))}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent" style={{ width: `${props.progress * 100}%` }} />
          </div>
        </div>
      )}
    </li>
  );
}

function PrintView() {
  const state = useStore((s) => s.state)!;
  const songs = new Map(state.songs.map((s) => [s.id, s]));
  let n = 0;
  return (
    <div className="print-only p-8">
      <h1 className="mb-6 text-3xl font-bold">{state.setlist.name}</h1>
      <ol className="space-y-2 text-2xl">
        {state.setlist.entries
          .filter((e) => !e.removed)
          .map((e) => {
            const song = songs.get(e.songId);
            if (!song) return null;
            if (!song.noSong) n++;
            const desc = e.description ?? song.description;
            return (
              <li key={e.songId}>
                {e.stopDescription && <div className="text-base italic">— {e.stopDescription} —</div>}
                <span className="inline-block w-10 text-right">{song.noSong ? '' : `${n}.`}</span>{' '}
                <span style={{ borderLeft: `6px solid ${colorOf(song.color, 'transparent')}`, paddingLeft: 8 }}>{song.title}</span>
                {desc && <span className="ml-3 text-lg text-gray-600">{desc}</span>}
              </li>
            );
          })}
      </ol>
    </div>
  );
}

function AddSongsDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (id: string) => void }) {
  const state = useStore((s) => s.state)!;
  const [query, setQuery] = useState('');
  const removed = new Set(state.setlist.entries.filter((e) => e.removed).map((e) => e.songId));
  const results = searchSongs(query, state.songs).filter((s) => removed.has(s.id));
  return (
    <Dialog title="Add songs" onClose={onClose}>
      <TextInput
        autoFocus
        aria-label="Search songs"
        placeholder="Title, description, #tag or initials"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && results[0] && onAdd(results[0].id)}
      />
      <ul className="mt-3 flex list-none flex-col gap-1 p-0">
        {results.map((s) => (
          <li key={s.id}>
            <button type="button" className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-panel2" onClick={() => onAdd(s.id)}>
              <span className="h-3 w-3 rounded-full" style={{ background: colorOf(s.color, 'var(--line-2)') }} />
              <span className="flex-1 text-[17px]">{s.title}</span>
              <span className="text-sm text-muted tabular">{formatDuration(s.duration)}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="p-3 text-sm text-muted">Every song is already in the setlist.</li>}
      </ul>
    </Dialog>
  );
}

function SaveDialog({ onClose }: { onClose: () => void }) {
  const state = useStore((s) => s.state)!;
  const [name, setName] = useState(state.setlist.name);
  const save = () => {
    act('saveSetlist', name.trim() || 'Untitled Setlist');
    onClose();
  };
  return (
    <Dialog title="Save setlist" onClose={onClose}>
      <TextInput autoFocus aria-label="Setlist name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      {state.savedSetlists.includes(name.trim()) && <p className="mt-2 text-sm text-muted">This replaces the saved setlist with the same name.</p>}
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={save}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function LoadDialog({ onClose }: { onClose: () => void }) {
  const state = useStore((s) => s.state)!;
  return (
    <Dialog title="Load setlist" onClose={onClose}>
      <ul className="flex list-none flex-col gap-1 p-0">
        {state.savedSetlists.map((name) => (
          <li key={name} className="flex items-center gap-2">
            <button
              type="button"
              className="min-h-12 flex-1 rounded-xl px-3 text-left text-[17px] hover:bg-panel2"
              onClick={() => {
                act('loadSetlist', name);
                onClose();
              }}
            >
              {name}
            </button>
            <IconButton icon="close" label={`Delete ${name}`} onClick={() => confirm(`Delete "${name}"?`) && act('deleteSetlist', name)} />
          </li>
        ))}
        {state.savedSetlists.length === 0 && <li className="p-3 text-sm text-muted">No saved setlists yet. Press ⇧S to save one.</li>}
      </ul>
      <div className="mt-4 border-t border-line pt-4">
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm('Reset to the arrangement order?')) {
              act('resetSetlist');
              onClose();
            }
          }}
        >
          Reset to arrangement order
        </Button>
      </div>
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const state = useStore((s) => s.state)!;
  const [text, setText] = useState(() => setlistToText(state.setlist, state.songs));
  const file = useRef<HTMLInputElement>(null);
  const onFile = async (f: File) => {
    const content = await f.text();
    if (f.name.toLowerCase().endsWith('.json')) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed.entries)) {
          act('setSetlist', { name: parsed.name ?? f.name.replace(/\.json$/i, ''), entries: parsed.entries });
          onClose();
          return;
        }
      } catch {
        alert('That file isn’t a valid setlist.');
        return;
      }
    }
    setText(content);
  };
  return (
    <Dialog title="Import or export" onClose={onClose} wide>
      <p className="mt-0 mb-3 text-[15px] text-muted">
        One song per line. Descriptions go in {'{braces}'}, stop notes as <code>-- note --</code>. Titles are matched loosely.
      </p>
      <textarea
        aria-label="Setlist as text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        className="w-full rounded-2xl border border-line2 bg-panel p-4 font-mono text-sm outline-none focus:border-accent"
      />
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button
          variant="primary"
          onClick={() => {
            act('importSetlistText', text);
            onClose();
          }}
        >
          Apply text
        </Button>
        <Button variant="outline" onClick={() => navigator.clipboard?.writeText(setlistToText(state.setlist, state.songs))}>
          Copy as text
        </Button>
        <Button variant="outline" onClick={() => file.current?.click()}>
          Upload file…
        </Button>
        <a className="inline-flex min-h-11 items-center rounded-full border border-line2 px-5 text-[15px] text-fg no-underline hover:bg-panel2" href="/api/setlist.json" download>
          Download JSON
        </a>
        <input ref={file} type="file" accept=".json,.txt,.setlist,text/plain,application/json" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </div>
    </Dialog>
  );
}

function DetailsDialog({ song, entry, onClose, onSave }: { song: Song; entry: SetlistEntry; onClose: () => void; onSave: (p: Partial<SetlistEntry>) => void }) {
  const [description, setDescription] = useState(entry.description ?? song.description ?? '');
  const [stop, setStop] = useState(entry.stopDescription ?? '');
  const save = () => {
    onSave({
      description: description === (song.description ?? '') ? undefined : description,
      stopDescription: stop || undefined,
    });
    onClose();
  };
  return (
    <Dialog title={song.title} onClose={onClose}>
      <label htmlFor="song-desc" className="mb-1.5 block text-sm text-muted">
        Description for this setlist
      </label>
      <TextInput id="song-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      <label htmlFor="song-stop" className="mt-4 mb-1.5 block text-sm text-muted">
        Note above the song
      </label>
      <TextInput id="song-stop" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="e.g. Talk to the crowd" />
      <p className="mt-4 mb-0 text-sm text-muted">
        {song.sections.length} sections · {formatDuration(song.duration)}
        {song.durationIsManual ? ' (set by hand)' : ''}
      </p>
      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}
