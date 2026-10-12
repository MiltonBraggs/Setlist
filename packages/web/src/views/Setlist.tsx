import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDuration, playView, searchSongs, setlistToText, type SetlistEntry, type Song } from '@setlist/core';
import { act, useAccess, usePlayhead, usePref, useStore } from '../store.ts';
import { Button, Dialog, Eyebrow, Icon, IconButton, TextInput, colorOf } from '../components/ui.tsx';

type DialogKind = null | 'add' | 'new' | 'options' | 'import' | { details: string };

function SetlistSwitcher({ onNew }: { onNew: () => void }) {
  const setlists = useStore((s) => s.state!.setlists);
  const activeId = useStore((s) => s.state!.setlist.id);
  const locked = useStore((s) => s.state!.locked);
  return (
    <nav aria-label="Setlists" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {setlists.map((sl) => {
        const on = sl.id === activeId;
        return (
          <button
            key={sl.id}
            type="button"
            aria-current={on ? 'true' : undefined}
            disabled={locked}
            onClick={() => !on && act('selectSetlist', sl.id)}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[15px] transition ${on ? 'bg-fg text-bg' : 'bg-panel text-fg hover:brightness-95'}`}
          >
            <span className="max-w-[16rem] truncate">{sl.name}</span>
            <span className={`text-xs tabular ${on ? 'opacity-70' : 'text-muted'}`}>{sl.songCount}</span>
          </button>
        );
      })}
      <button
        type="button"
        disabled={locked}
        onClick={onNew}
        className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line2 px-4 text-[15px] text-link hover:bg-panel"
      >
        <Icon name="plus" className="h-4 w-4" /> New setlist
      </button>
    </nav>
  );
}

export function SetlistView() {
  const state = useStore((s) => s.state)!;
  const time = usePlayhead();
  const [editing, setEditing] = useState(false);
  const [hideRemoved, setHideRemoved] = usePref('hideRemoved', false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const access = useAccess();
  const canEdit = access.can('editSetlist');
  const canJump = access.can('navigate');
  const songs = useMemo(() => new Map(state.songs.map((s) => [s.id, s])), [state.songs]);
  const v = playView(state.songs, state.setlist, time, state.live.tempo, state.queued);
  const entries = state.setlist.entries;
  const active = entries.filter((e) => !e.removed && songs.has(e.songId));
  const total = active.reduce((sum, e) => sum + (songs.get(e.songId)?.duration ?? 0), 0);

  const update = (next: SetlistEntry[]) => act('setSetlist', { ...state.setlist, entries: next });

  // Leave edit mode when switching setlists or losing the right to edit.
  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);
  useEffect(() => setEditing(false), [state.setlist.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || dialog) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        window.print();
      } else if (!canEdit) {
        return;
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setEditing(true);
        setDialog('add');
      } else if (mod && e.key === 'Enter' && editing) {
        setEditing(false);
      } else if (e.shiftKey && !mod && e.key === 'S') {
        setDialog('new');
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
    if (from < 0 || to < 0) return;
    update(arrayMove(entries, from, to));
  };

  const visible = (editing ? entries.filter((e) => !(hideRemoved && e.removed)) : active).filter((e) => songs.has(e.songId));
  const nextId = v.nextSong?.id;
  const detailsSong = dialog && typeof dialog === 'object' ? songs.get(dialog.details) : undefined;
  const detailsEntry = detailsSong ? entries.find((e) => e.songId === detailsSong.id) : undefined;
  let number = 0;

  return (
    <div className="h-full overflow-auto">
      <div className="no-print mx-auto flex max-w-[980px] flex-col gap-8 px-4 pt-10 pb-12 sm:px-6">
        {canEdit && <SetlistSwitcher onNew={() => setDialog('new')} />}
        <section className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-2">
            <Eyebrow accent>Setlist</Eyebrow>
            <h1 className="headline m-0 text-[clamp(40px,7vw,80px)] [overflow-wrap:anywhere]">{state.setlist.name}</h1>
            <p className="m-0 text-[19px] text-muted tabular">
              {active.length} songs · {formatDuration(total)} total · {formatDuration(v.setRemaining)} left
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {editing ? (
              <>
                <Button variant="outline" onClick={() => setDialog('add')} title="Add songs (Ctrl+K)">
                  <Icon name="plus" className="h-4 w-4" /> Add songs
                </Button>
                <Button variant="outline" active={hideRemoved} onClick={() => setHideRemoved(!hideRemoved)} title="Hide removed songs (⇧H)">
                  {hideRemoved ? 'Show removed' : 'Hide removed'}
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
                {canEdit && (
                  <>
                    <Button variant="outline" onClick={() => setDialog('options')} disabled={state.locked} title="Rename, duplicate, delete, import or export">
                      Options
                    </Button>
                    <Button variant="primary" onClick={() => setEditing(true)} disabled={state.locked}>
                      Edit
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </section>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((e) => e.songId)} strategy={verticalListSortingStrategy}>
            <ol className="m-0 flex list-none flex-col rounded-[28px] bg-panel p-0">
              {visible.map((entry, i) => {
                const song = songs.get(entry.songId)!;
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
                    locked={state.locked || !canJump}
                    canEdit={canEdit}
                    onToggleRemoved={() => update(entries.map((e) => (e.songId === song.id ? { ...e, removed: !e.removed } : e)))}
                    onDetails={() => setDialog({ details: song.id })}
                  />
                );
              })}
            </ol>
          </SortableContext>
        </DndContext>
        {state.songs.length === 0 && <p className="m-0 text-center text-muted">No songs yet. Add locators to your Arrangement in Live.</p>}
        {state.songs.length > 0 && visible.length === 0 && (
          <p className="m-0 text-center text-muted">This setlist is empty. {canEdit ? 'Tap Edit, then Add songs.' : ''}</p>
        )}
        <p className="m-0 text-center text-sm text-muted">{editing ? 'Drag to reorder. Removed songs stay in the list, dimmed.' : canJump ? 'Tap a song to queue it.' : ''}</p>
      </div>

      <PrintView />

      {dialog === 'add' && (
        <AddSongsDialog
          onClose={() => setDialog(null)}
          onAdd={(id) => {
            const existing = entries.find((e) => e.songId === id);
            update([...entries.filter((e) => e.songId !== id), { ...(existing ?? { songId: id }), removed: false }]);
          }}
        />
      )}
      {dialog === 'new' && <NewSetlistDialog onClose={() => setDialog(null)} />}
      {dialog === 'options' && <OptionsDialog onClose={() => setDialog(null)} onImport={() => setDialog('import')} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {detailsSong && detailsEntry && (
        <DetailsDialog
          song={detailsSong}
          entry={detailsEntry}
          onClose={() => setDialog(null)}
          onSave={(patch) => update(entries.map((e) => (e.songId === detailsSong.id ? { ...e, ...patch } : e)))}
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
  canEdit: boolean;
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
            if (!props.canEdit) return;
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

/** Build a setlist by tapping songs in the order they'll be played. */
function NewSetlistDialog({ onClose }: { onClose: () => void }) {
  const songs = useStore((s) => s.state!.songs);
  const setlistCount = useStore((s) => s.state!.setlists.length);
  const [name, setName] = useState(`Setlist ${setlistCount + 1}`);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const results = searchSongs(query, songs);
  const byId = new Map(songs.map((s) => [s.id, s]));
  const duration = picked.reduce((sum, id) => sum + (byId.get(id)?.duration ?? 0), 0);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const create = () => {
    if (picked.length === 0) return;
    act('createSetlist', name.trim() || 'New setlist', picked);
    onClose();
  };
  return (
    <Dialog title="New setlist" onClose={onClose} wide>
      <label htmlFor="new-setlist-name" className="mb-1.5 block text-sm text-muted">
        Name
      </label>
      <TextInput id="new-setlist-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <div className="mt-5 mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted">Tap songs in the order you'll play them.</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setPicked(songs.map((s) => s.id))}>
            Select all
          </Button>
          <Button variant="ghost" onClick={() => setPicked([])} disabled={picked.length === 0}>
            Clear
          </Button>
        </div>
      </div>
      {songs.length > 8 && <TextInput aria-label="Search songs" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-2" />}
      <ul className="m-0 flex max-h-[45vh] list-none flex-col gap-1 overflow-y-auto p-0">
        {results.map((s) => {
          const pos = picked.indexOf(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={pos >= 0}
                onClick={() => toggle(s.id)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left transition ${pos >= 0 ? 'bg-accent/10' : 'hover:bg-panel2'}`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold tabular ${pos >= 0 ? 'bg-accent text-onaccent' : 'border border-line2 text-transparent'}`}
                >
                  {pos >= 0 ? pos + 1 : '·'}
                </span>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(s.color, 'var(--line-2)') }} />
                <span className="min-w-0 flex-1 truncate text-[17px]">{s.title}</span>
                <span className="text-sm text-muted tabular">{formatDuration(s.duration)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        <span className="mr-auto text-sm text-muted tabular">
          {picked.length} song{picked.length === 1 ? '' : 's'} · {formatDuration(duration)}
        </span>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={create} disabled={picked.length === 0}>
          Create setlist
        </Button>
      </div>
    </Dialog>
  );
}

function OptionsDialog({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const setlist = useStore((s) => s.state!.setlist);
  const count = useStore((s) => s.state!.setlists.length);
  const [name, setName] = useState(setlist.name);
  const rename = () => {
    if (name.trim() && name.trim() !== setlist.name) act('renameSetlist', setlist.id, name.trim());
    onClose();
  };
  return (
    <Dialog title="Setlist options" onClose={onClose}>
      <label htmlFor="rename-setlist" className="mb-1.5 block text-sm text-muted">
        Name
      </label>
      <div className="flex gap-2">
        <TextInput id="rename-setlist" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} />
        <Button variant="primary" onClick={rename} disabled={!name.trim()}>
          Rename
        </Button>
      </div>
      <div className="mt-5 flex flex-col divide-y divide-line overflow-hidden rounded-2xl bg-panel2">
        <button
          type="button"
          className="min-h-12 px-4 text-left text-[17px] text-link hover:brightness-95"
          onClick={() => {
            act('duplicateSetlist', setlist.id);
            onClose();
          }}
        >
          Duplicate
        </button>
        <button type="button" className="min-h-12 px-4 text-left text-[17px] text-link hover:brightness-95" onClick={onImport}>
          Import or export…
        </button>
        <button
          type="button"
          className="min-h-12 px-4 text-left text-[17px] text-link hover:brightness-95"
          onClick={() => {
            if (window.confirm('Put the songs back in arrangement order?')) {
              act('resetSetlist');
              onClose();
            }
          }}
        >
          Sort by arrangement order
        </button>
        <button
          type="button"
          disabled={count <= 1}
          title={count <= 1 ? 'You need at least one setlist' : undefined}
          className="min-h-12 px-4 text-left text-[17px] text-danger hover:brightness-95 disabled:opacity-40"
          onClick={() => {
            if (window.confirm(`Delete "${setlist.name}"? This can't be undone.`)) {
              act('deleteSetlist', setlist.id);
              onClose();
            }
          }}
        >
          Delete setlist
        </button>
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
          act('setSetlist', { entries: parsed.entries });
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
