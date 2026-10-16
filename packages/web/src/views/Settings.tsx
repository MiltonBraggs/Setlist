import { useState } from 'react';
import {
  chordTracks,
  lyricsTracks,
  type DeviceInfo,
  type JumpMode,
  type MidiMapping,
  type Settings as SettingsT,
  type ViewerPage,
  type ViewerPermissions,
} from '@setlist/core';
import { act, actThrottled, useStore } from '../store.ts';
import { PinDialog } from '../components/Access.tsx';
import { Button, Group, Row, Segmented, Select, Switch, TextInput } from '../components/ui.tsx';

const JUMP_MODES: { value: JumpMode; label: string; hint: string }[] = [
  { value: 'quantized', label: 'Quantized', hint: 'Jumps follow Live’s global quantization.' },
  { value: 'endOfSection', label: 'End of section', hint: 'Jumps wait for the current section to end.' },
  { value: 'endOfSong', label: 'End of song', hint: 'Jumps wait for the current song to end.' },
  { value: 'dynamic', label: 'Dynamic', hint: 'Sections jump at the end of a section, songs at the end of a song.' },
  { value: 'manual', label: 'Manual', hint: 'Jumps happen only while playback is stopped.' },
];

export const ACTION_LABELS: Record<string, string> = {
  go: 'GO',
  playPause: 'Play / pause',
  playStop: 'Play / stop',
  play: 'Play',
  pause: 'Pause',
  stop: 'Stop',
  nextSong: 'Next song',
  prevSong: 'Previous song',
  nextSection: 'Next section',
  prevSection: 'Previous section',
  toggleLoop: 'Loop',
  escapeLoop: 'Escape loop',
  metronome: 'Metronome (emergency click)',
  toggleBacking: 'Mute / unmute backing tracks',
  toggleVocals: 'Mute / unmute reference vocals',
  jumpQueued: 'Jump to queued',
  jumpQueuedNow: 'Jump to queued now',
  cancelQueue: 'Cancel queued jump',
  toggleRecord: 'Record',
  toggleLock: 'Lock',
  osc: 'Custom OSC command',
};

const VIEWER_PAGES: { id: ViewerPage; label: string }[] = [
  { id: 'performance', label: 'Performance' },
  { id: 'setlist', label: 'Setlist' },
  { id: 'lyrics', label: 'Lyrics' },
];

const VIEWER_CONTROLS: { key: 'transport' | 'navigate' | 'editSetlist'; label: string; hint: string }[] = [
  { key: 'transport', label: 'Play, stop and GO', hint: 'Start and stop the show.' },
  { key: 'navigate', label: 'Jump to songs and sections', hint: 'Queue jumps, skip around, loop sections.' },
  { key: 'editSetlist', label: 'Edit the setlist', hint: 'Reorder, add, remove, save and load.' },
];

function ViewerAccess() {
  const state = useStore((s) => s.state)!;
  const viewer = state.settings.viewer;
  const [pinOpen, setPinOpen] = useState(false);
  const set = (patch: Partial<ViewerPermissions>) => act('updateSettings', { viewer: { ...viewer, ...patch } });
  const lyricsOnly = lyricsTracks(state.tracks).map((t) => t.title);
  // Same tabs as the Lyrics page: the +CHORDS track only has its own tab when there are no lyrics tracks.
  const lyricTitles = [...new Set(lyricsOnly.length ? lyricsOnly : chordTracks(state.tracks).map((c) => c.title))];
  const allowedLyrics = viewer.lyricsTracks ?? lyricTitles;
  const { pinSet, owners, viewers } = state.access;

  return (
    <>
      <Group
        title="Owner and bandmates"
        footer={pinSet ? 'Devices that enter the PIN become owners. This computer is always owner.' : 'Without a PIN, every device that opens Setlist has full control.'}
      >
        <Row label="Owner PIN" hint={pinSet ? 'Set' : 'Not set'}>
          <Button variant="outline" onClick={() => setPinOpen(true)}>
            {pinSet ? 'Change…' : 'Set PIN…'}
          </Button>
        </Row>
        <Row label="Connected devices">
          <span className="text-[15px] text-muted tabular">
            {owners} owner{owners === 1 ? '' : 's'} · {viewers} viewer{viewers === 1 ? '' : 's'}
          </span>
        </Row>
      </Group>

      <Group title="What viewers can see" footer={pinSet ? undefined : 'These apply once you set an owner PIN.'}>
        {VIEWER_PAGES.map((page) => (
          <Row key={page.id} label={page.label}>
            <Switch label={`Viewers can see ${page.label}`} checked={viewer.pages[page.id]} onChange={(on) => set({ pages: { ...viewer.pages, [page.id]: on } })} />
          </Row>
        ))}
        {viewer.pages.lyrics && lyricTitles.length > 0 && (
          <Row label="Lyrics tracks" hint="Which +LYRICS tracks viewers can open." stacked>
            <div className="flex flex-wrap gap-2">
              {lyricTitles.map((title) => {
                const on = allowedLyrics.includes(title);
                return (
                  <button
                    key={title}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? allowedLyrics.filter((t) => t !== title) : [...allowedLyrics, title];
                      set({ lyricsTracks: next.length === lyricTitles.length ? null : next });
                    }}
                    className={`min-h-9 rounded-full px-4 text-sm transition ${on ? 'bg-accent text-onaccent' : 'bg-panel2 text-muted'}`}
                  >
                    {title}
                  </button>
                );
              })}
            </div>
          </Row>
        )}
      </Group>

      <Group title="What viewers can do">
        {VIEWER_CONTROLS.map((c) => (
          <Row key={c.key} label={c.label} hint={c.hint}>
            <Switch label={`Viewers can ${c.label.toLowerCase()}`} checked={viewer[c.key]} onChange={(on) => set({ [c.key]: on })} />
          </Row>
        ))}
      </Group>

      {pinOpen && <PinDialog onClose={() => setPinOpen(false)} />}
    </>
  );
}

/** Follows the drag locally; sends at most ~10 updates a second. */
function TextSizeSlider({ value }: { value: number }) {
  const [drag, setDrag] = useState<number | null>(null);
  const release = () => setTimeout(() => setDrag(null), 300);
  return (
    <input
      type="range"
      aria-label="Text size"
      min={0.75}
      max={1.5}
      step={0.05}
      value={drag ?? value}
      onChange={(e) => {
        const v = Number(e.target.value);
        setDrag(v);
        actThrottled('fontScale', 100, 'updateSettings', { fontScale: v });
      }}
      onPointerUp={release}
      onKeyUp={release}
      onBlur={() => setDrag(null)}
      className="w-52 accent-[var(--accent)]"
    />
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value < 0 ? '' : value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-9 w-16 rounded-xl bg-panel2 px-2 text-fg outline-none"
      />
    </label>
  );
}

export function SettingsView() {
  const state = useStore((s) => s.state)!;
  const s = state.settings;
  const set = (partial: Partial<SettingsT>) => act('updateSettings', partial);
  const mappings = s.midiMappings;
  const setMapping = (id: string, patch: Partial<MidiMapping>) => set({ midiMappings: mappings.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const lanUrl = state.urls.find((u) => !u.includes('localhost')) ?? state.urls[0];

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-[760px] flex-col gap-9 px-6 pt-16 pb-12">
        <h1 className="headline m-0 text-[clamp(48px,7vw,72px)]">Settings.</h1>

        <Group title="Connection">
          <Row label="Ableton Live">
            <span className="inline-flex items-center gap-2 text-[15px] text-muted">
              <span className={`h-2 w-2 rounded-full ${state.liveConnected ? 'bg-ok' : 'bg-danger'}`} />
              {state.liveConnected
                ? `Connected · script ${state.scriptVersion ?? ''}${state.scriptOutdated ? ' · out of date: run npm run install-script, then restart Live' : ''}`
                : 'Not connected'}
            </span>
          </Row>
          <Row label="Open on other devices" hint={state.urls.length > 2 ? state.urls.slice(1).join(' · ') : undefined}>
            {lanUrl && (
              <a href={lanUrl} className="text-[15px] text-link no-underline hover:underline">
                {lanUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
          </Row>
        </Group>

        <NetworkCheck />

        <ViewerAccess />

        <Group title="Playback">
          <Row label="Jump mode" hint={JUMP_MODES.find((m) => m.value === s.jumpMode)?.hint} stacked>
            <Segmented label="Jump mode" value={s.jumpMode} options={JUMP_MODES} onChange={(jumpMode) => set({ jumpMode })} />
          </Row>
          <Row label="Autojump to the next song" hint="After a STOP locator, park at the next song.">
            <Switch label="Autojump to the next song" checked={s.autojumpNextSong} onChange={(autojumpNextSong) => set({ autojumpNextSong })} />
          </Row>
          <Row label="Count-in" hint="When starting playback. Override per section with [c:N].">
            <Segmented
              label="Count-in"
              value={s.countInBars}
              options={[0, 1, 2, 4].map((n) => ({ value: n as SettingsT['countInBars'], label: n === 0 ? 'Off' : n === 1 ? '1 bar' : String(n) }))}
              onChange={(countInBars) => set({ countInBars })}
            />
          </Row>
          <Row label="Solo click during count-in" hint="Tracks named Click or flagged +CLICK.">
            <Switch label="Solo click during count-in" checked={s.countInSoloClick} onChange={(countInSoloClick) => set({ countInSoloClick })} />
          </Row>
        </Group>

        <Group
          title="MIDI"
          footer={state.midiInputs.length === 0 ? 'No MIDI inputs found. On Windows, turn the device off in Live’s MIDI preferences so Setlist can use it.' : undefined}
        >
          {mappings.map((m) => {
            const learning = state.midiLearn?.mappingId === m.id;
            return (
              <div key={m.id} className="flex flex-col gap-3 px-5 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    label="Action"
                    value={m.action}
                    options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
                    onChange={(action) => setMapping(m.id, { action })}
                  />
                  <span className="flex-1 text-sm text-muted">
                    {m.number >= 0 ? `${m.input && m.input !== '*' ? m.input : 'Any input'} · ${m.kind === 'cc' ? 'CC' : m.kind === 'pc' ? 'Program' : 'Note'} ${m.number} · Channel ${m.channel}` : 'Not assigned yet'}
                  </span>
                  <Button active={learning} onClick={() => act(learning ? 'midiLearnCancel' : 'midiLearn', m.id)}>
                    {learning ? 'Press a control…' : 'Learn'}
                  </Button>
                  <Button variant="ghost" onClick={() => set({ midiMappings: mappings.filter((x) => x.id !== m.id) })}>
                    Remove
                  </Button>
                </div>
                {m.action === 'osc' && (
                  <TextInput
                    aria-label="OSC commands"
                    placeholder="/global/stop; //sleep 500; /setlist/jumpBySongs 1"
                    defaultValue={m.osc}
                    onBlur={(e) => setMapping(m.id, { osc: e.target.value })}
                  />
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Segmented
                    label="Message type"
                    value={m.kind}
                    options={[
                      { value: 'note', label: 'Note' },
                      { value: 'cc', label: 'CC' },
                      { value: 'pc', label: 'Program' },
                    ]}
                    onChange={(kind) => setMapping(m.id, { kind })}
                  />
                  <NumberField label="Number" value={m.number} min={0} max={127} onChange={(number) => setMapping(m.id, { number })} />
                  <NumberField label="Channel" value={m.channel} min={1} max={16} onChange={(channel) => setMapping(m.id, { channel })} />
                  <Select
                    label="MIDI input"
                    value={m.input || '*'}
                    options={[{ value: '*', label: 'Any input' }, ...state.midiInputs.map((i) => ({ value: i, label: i }))]}
                    onChange={(input) => setMapping(m.id, { input })}
                  />
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="min-h-14 w-full px-5 text-left text-[17px] text-link hover:bg-panel2"
            onClick={() => {
              const id = Math.random().toString(36).slice(2, 10);
              set({ midiMappings: [...mappings, { id, input: '*', kind: 'note', channel: 1, number: -1, action: 'go' }] });
              act('midiLearn', id);
            }}
          >
            Add mapping…
          </button>
        </Group>

        <Group title="Appearance">
          <Row label="Theme" hint="Dark is easier on the eyes on a dim stage.">
            <Segmented
              label="Theme"
              value={s.theme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              onChange={(theme) => set({ theme })}
            />
          </Row>
          <Row label="Text size">
            <TextSizeSlider value={s.fontScale} />
          </Row>
        </Group>

        <Group
          title="Project"
          footer={
            <>
              OSC examples: <code>/global/play</code>, <code>/setlist/jumpBySongs 1</code>, <code>/loop/toggle</code>. Send{' '}
              <code>/subscribe &lt;port&gt;</code> to receive state.
            </>
          }
        >
          <Row label="OSC port" hint="Restart Setlist after changing it.">
            <input
              type="number"
              aria-label="OSC port"
              defaultValue={s.oscPort}
              onBlur={(e) => set({ oscPort: Number(e.target.value) || 39051 })}
              className="min-h-9 w-24 rounded-xl bg-panel2 px-3 text-right text-fg outline-none tabular"
            />
          </Row>
          <Row label="Project folder" hint="Lyrics images are read from the Lyrics folder inside it." stacked>
            <TextInput
              aria-label="Project folder"
              defaultValue={s.projectFolder ?? ''}
              placeholder="C:\Music\My Show"
              onBlur={(e) => set({ projectFolder: e.target.value.trim() || null })}
            />
          </Row>
          <button
            type="button"
            className="min-h-14 w-full px-5 text-left text-[17px] text-link hover:bg-panel2"
            title="Section clips can only be jumped to while stopped unless they have a locator"
            onClick={() => act('placeSectionLocators')}
          >
            Place locators on section clips
          </button>
          <button type="button" className="min-h-14 w-full px-5 text-left text-[17px] text-link hover:bg-panel2" onClick={() => act('removeAutoLocators')}>
            Remove placed locators
          </button>
        </Group>

        {state.errors.length > 0 && (
          <Group title="Remote Script errors">
            <pre className="m-0 max-h-64 overflow-auto px-5 py-4 text-xs whitespace-pre-wrap text-danger">{state.errors.join('\n\n')}</pre>
            <button type="button" className="min-h-14 w-full px-5 text-left text-[17px] text-link hover:bg-panel2" onClick={() => act('clearErrors')}>
              Clear errors
            </button>
          </Group>
        )}
      </div>
    </div>
  );
}

/** How healthy a round trip is for following along live (ms). */
function delayTone(rtt: number | null): { dot: string; text: string } {
  if (rtt === null) return { dot: 'bg-danger', text: 'Not answering' };
  if (rtt < 100) return { dot: 'bg-ok', text: `${rtt} ms` };
  if (rtt < 300) return { dot: 'bg-[#ff9f0a]', text: `${rtt} ms` };
  return { dot: 'bg-danger', text: `${rtt} ms` };
}

/**
 * Settings → Network: every connected device with its delay (checked every 2 s), its worst delay in
 * about the last minute and how often it reconnected. For the soundcheck: spot a struggling device
 * before the doors open.
 */
function NetworkCheck() {
  const devices = useStore((s) => s.devices);
  const sorted = [...(devices ?? [])].sort((a, b) => Number(b.local) - Number(a.local) || a.label.localeCompare(b.label));
  return (
    <Group
      title="Network"
      footer="Delay to each device, checked every 2 seconds: green under 100 ms, orange under 300 ms. Reconnects mean the device lost the Wi-Fi or locked its screen."
    >
      {!devices && <Row label="Checking…" />}
      {sorted.map((d) => (
        <DeviceRow key={`${d.id}-${d.since}`} device={d} />
      ))}
    </Group>
  );
}

function DeviceRow({ device: d }: { device: DeviceInfo }) {
  const now = delayTone(d.rtt);
  const reconnects = Math.max(0, d.connects - 1);
  const minutes = Math.max(0, Math.round((Date.now() - d.since) / 60000));
  return (
    <Row
      label={d.label}
      hint={`${d.role === 'owner' ? 'Owner' : 'Viewer'} · ${d.address} · connected ${minutes < 1 ? 'just now' : `${minutes} min`}${
        reconnects ? ` · reconnected ${reconnects}×` : ''
      }`}
    >
      <span className="flex flex-col items-end gap-0.5 text-[15px] tabular">
        <span className="inline-flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${now.dot}`} />
          {now.text}
        </span>
        {d.worstRtt !== null && <span className="text-[13px] text-muted">worst {d.worstRtt} ms</span>}
      </span>
    </Row>
  );
}
