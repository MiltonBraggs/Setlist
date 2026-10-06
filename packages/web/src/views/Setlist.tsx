import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDuration, playView, searchSongs, setlistToText, type SetlistEntry, type Song } from '@setlist/core';
import { act, usePlayhead, usePref, useStore } from '../store.ts';
import { Button, Dialog, Icon, TextInput, colorOf } from '../components/ui.tsx';

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
  let number = 0;

  return (
    <div className="flex h-full flex-col">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="mr-auto">
          <div className="text-lg font-semibold">{state.setlist.name}</div>
          <div className="text-sm text-muted tabular">
            {active.length} songs · {formatDuration(total)} · {formatDuration(v.setRemaining)} left
          </div>
        </div>
        {editing ? (
          <>
            <Button onClick={() => setDialog('add')} title="Add songs (Ctrl+K)">
              <Icon name="plus" className="w-4 h-4" /> Add
            </Button>
            <Button active={hideRemoved} onClick={() => setHideRemoved(!hideRemoved)} title="Hide removed songs (⇧H)">
              <Icon name="eye" className="w-4 h-4" /> Hide removed
            </Button>
            <Button onClick={() => setDialog('save')} title="Save setlist (⇧S)">Save</Button>
            <Button onClick={() => setDialog('load')} title="Load setlist (⇧O)">Load</Button>
            <Button onClick={() => setDialog('import')}>Import / Export</Button>
            <Button variant="primary" onClick={() => setEditing(false)} title="Done (Ctrl+Enter)">Done</Button>
          </>
        ) : (
          <>
            <Button onClick={() => window.print()} title="Print (Ctrl+P)">Print</Button>
            <Button onClick={() => setEditing(true)} disabled={state.locked}>Edit</Button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3 no-print">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((e) => e.songId)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-1.5">
              {visible.map((entry) => {
                const song = songs.get(entry.songId);
                if (!song) return null;
                if (!entry.removed && !song.noSong) number++;
                return (
                  <SongRow
                    key={entry.songId}
                    song={song}
                    entry={entry}
                    number={entry.removed || song.noSong ? null : number}
                    editing={editing}
                    current={v.song?.id === song.id}
                    progress={v.song?.id === song.id ? v.loc.songProgress : 0}
                    currentSectionId={v.song?.id === song.id ? v.section?.id : undefined}
                    queued={state.queued?.songId === song.id}
                    locked={state.locked}
                    onToggleRemoved={() => update(entries.map((e) => (e.songId === song.id ? { ...e, removed: !e.removed } : e)))}
                    onDetails={() => setDialog({ details: song.id })}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
        {state.songs.length === 0 && <div className="p-8 text-center text-muted">No songs yet. Add locators to your Arrangement in Live.</div>}
      </div>

      <PrintView />

      {dialog === 'add' && <AddSongsDialog onClose={() => setDialog(null)} onAdd={(id) => update([...entries.filter((e) => e.songId !== id), { ...entries.find((e) => e.songId === id)!, removed: false }])} />}
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
  number: number | null;
  editing: boolean;
  current: boolean;
  progress: number;
  currentSectionId?: string;
  queued: boolean;
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
      className={`rounded-xl border bg-panel ${current ? 'border-accent' : props.queued ? 'border-dashed border-accent' : 'border-line'} ${entry.removed ? 'opacity-40' : ''}`}
    >
      {entry.stopDescription && <div className="border-b border-line px-4 py-1 text-sm italic text-muted">— {entry.stopDescription} —</div>}
      <div className="flex items-stretch">
        {editing && (
          <button className="touch-none px-2 text-muted" {...attributes} {...listeners} aria-label="Drag to reorder">
            <Icon name="grip" className="w-5 h-5" />
          </button>
        )}
        <button
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left"
          disabled={editing || props.locked}
          onClick={() => act('jumpToSong', song.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            props.onDetails();
          }}
        >
          <span className="w-6 text-right tabular text-muted">{props.number ?? ''}</span>
          <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: colorOf(song.color, 'var(--line)') }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-medium">
              {song.stopBefore && <span className="mr-1 text-danger" title="Stops before this song">■</span>}
              {song.title}
            </span>
            {(description || song.tags.length > 0) && (
              <span className="block truncate text-sm text-muted">
                {description}
                {song.tags.map((t) => (
                  <span key={t} className="ml-2 text-accent">#{t}</span>
                ))}
              </span>
            )}
          </span>
          {props.queued && <span className="rounded bg-accent px-2 py-0.5 text-xs text-white">QUEUED</span>}
          <span className="tabular text-muted">{formatDuration(song.duration)}</span>
        </button>
        {editing && (
          <>
            <Button variant="ghost" onClick={props.onDetails} title="Song details">
              <Icon name="more" className="w-5 h-5" />
            </Button>
            <Button variant="ghost" onClick={props.onToggleRemoved} title={entry.removed ? 'Restore' : 'Remove'}>
              <Icon name={entry.removed ? 'restore' : 'close'} className="w-5 h-5" />
            </Button>
          </>
        )}
      </div>
      {current && !editing && (
        <>
          <div className="flex flex-wrap gap-1.5 px-3 pb-3 pl-12">
            {song.sections.map((sec) => (
              <button
                key={sec.id}
                disabled={props.locked}
                onClick={() => act('jumpToSection', song.id, sec.id)}
                className={`rounded-md px-2.5 py-1 text-sm ${sec.id === props.currentSectionId ? 'bg-accent text-white' : 'bg-panel2'} ${sec.optional || sec.flags.skip ? 'opacity-50' : ''}`}
              >
                {sec.title}
              </button>
            ))}
          </div>
          <div className="h-1 overflow-hidden rounded-b-xl bg-panel2">
            <div className="h-full bg-accent" style={{ width: `${props.progress * 100}%` }} />
          </div>
        </>
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
      <TextInput autoFocus placeholder="Search title, description, #tag, initials…" value={query} onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && results[0] && onAdd(results[0].id)} />
      <ul className="mt-3 flex flex-col gap-1">
        {results.map((s) => (
          <li key={s.id}>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-panel2" onClick={() => onAdd(s.id)}>
              <span className="h-5 w-1.5 rounded-full" style={{ background: colorOf(s.color, 'var(--line)') }} />
              <span className="flex-1">{s.title}</span>
              <span className="text-sm text-muted">{formatDuration(s.duration)}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="p-3 text-sm text-muted">All songs are already in the setlist.</li>}
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
      <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      {state.savedSetlists.includes(name.trim()) && <p className="mt-2 text-sm text-muted">This will overwrite the saved setlist.</p>}
      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={save}>Save</Button>
      </div>
    </Dialog>
  );
}

function LoadDialog({ onClose }: { onClose: () => void }) {
  const state = useStore((s) => s.state)!;
  return (
    <Dialog title="Load setlist" onClose={onClose}>
      <ul className="flex flex-col gap-1">
        {state.savedSetlists.map((name) => (
          <li key={name} className="flex items-center gap-2">
            <button className="flex-1 rounded-lg px-3 py-2 text-left hover:bg-panel2" onClick={() => { act('loadSetlist', name); onClose(); }}>
              {name}
            </button>
            <Button variant="ghost" title={`Delete ${name}`} onClick={() => confirm(`Delete "${name}"?`) && act('deleteSetlist', name)}>
              <Icon name="close" className="w-4 h-4" />
            </Button>
          </li>
        ))}
        {state.savedSetlists.length === 0 && <li className="p-3 text-sm text-muted">No saved setlists yet (⇧S to save).</li>}
      </ul>
      <div className="mt-4 border-t border-line pt-3">
        <Button onClick={() => { if (confirm('Reset to arrangement order?')) { act('resetSetlist'); onClose(); } }}>Reset to arrangement order</Button>
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
        alert('Not a valid setlist JSON file');
        return;
      }
    }
    setText(content);
  };
  return (
    <Dialog title="Import / Export" onClose={onClose} wide>
      <p className="mb-2 text-sm text-muted">One song per line. Descriptions in {'{braces}'}; stop notes as <code>-- note --</code>. Titles are matched fuzzily.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
        className="w-full rounded-lg border border-line bg-panel2 p-3 font-mono text-sm outline-none focus:border-accent" />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => { act('importSetlistText', text); onClose(); }}>Apply text</Button>
        <Button onClick={() => navigator.clipboard?.writeText(setlistToText(state.setlist, state.songs))}>Copy as text</Button>
        <Button onClick={() => file.current?.click()}>Upload file…</Button>
        <a className="inline-flex items-center rounded-lg bg-panel2 px-3 py-2 text-sm" href="/api/setlist.json" download>Download JSON</a>
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
      <label className="block text-sm text-muted">Description (this setlist)</label>
      <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
      <label className="mt-3 block text-sm text-muted">Stop description (shown above the song)</label>
      <TextInput value={stop} onChange={(e) => setStop(e.target.value)} placeholder="e.g. Talk to the crowd" />
      <div className="mt-3 text-sm text-muted">
        {song.sections.length} sections · {formatDuration(song.duration)}{song.durationIsManual ? ' (manual)' : ''}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save}>Save</Button>
      </div>
    </Dialog>
  );
}
