import type { ReactNode } from 'react';
import type { JumpMode, MidiMapping, Settings as SettingsT } from '@setlist/core';
import { act, useStore } from '../store.ts';
import { Button, Select, TextInput, Toggle } from '../components/ui.tsx';

const JUMP_MODES: { value: JumpMode; label: string; hint: string }[] = [
  { value: 'quantized', label: 'Quantized', hint: "Uses Live's global quantization" },
  { value: 'endOfSection', label: 'End of section', hint: 'Waits for the current section to end' },
  { value: 'endOfSong', label: 'End of song', hint: 'Waits for the current song to end' },
  { value: 'dynamic', label: 'Dynamic', hint: 'Sections at section end, songs at song end' },
  { value: 'manual', label: 'Manual', hint: 'Jumps only when playback is stopped' },
];

export const ACTION_LABELS: Record<string, string> = {
  go: 'GO (context aware)',
  playPause: 'Play / pause',
  playStop: 'Play / stop',
  play: 'Play',
  pause: 'Pause',
  stop: 'Stop',
  nextSong: 'Next song / escape loop',
  prevSong: 'Previous song',
  nextSection: 'Next section',
  prevSection: 'Previous section',
  toggleLoop: 'Toggle loop',
  escapeLoop: 'Escape loop',
  jumpQueued: 'Jump to queued (quantized)',
  jumpQueuedNow: 'Jump to queued (instant)',
  cancelQueue: 'Cancel queued jump',
  toggleRecord: 'Toggle recording',
  toggleLock: 'Toggle lock',
  osc: 'Custom OSC command…',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsView() {
  const state = useStore((s) => s.state)!;
  const s = state.settings;
  const set = (partial: Partial<SettingsT>) => act('updateSettings', partial);
  const mappings = s.midiMappings;
  const setMapping = (id: string, patch: Partial<MidiMapping>) => set({ midiMappings: mappings.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 overflow-auto p-4">
      <Section title="Connection">
        <div className="text-sm">
          Ableton Live:{' '}
          {state.liveConnected ? <span className="text-ok">connected (script {state.scriptVersion})</span> : <span className="text-danger">not connected</span>}
        </div>
        <div className="mt-2 text-sm text-muted">Open Setlist on other devices on this network:</div>
        <ul className="mt-1 text-sm">
          {state.urls.map((u) => (
            <li key={u}><a className="text-accent" href={u}>{u}</a></li>
          ))}
        </ul>
      </Section>

      <Section title="Playback">
        <div className="flex items-center justify-between gap-4 py-2">
          <span>
            <span className="block">Jump mode</span>
            <span className="block text-xs text-muted">{JUMP_MODES.find((m) => m.value === s.jumpMode)?.hint}</span>
          </span>
          <Select value={s.jumpMode} options={JUMP_MODES} onChange={(jumpMode) => set({ jumpMode })} />
        </div>
        <Toggle label="Autojump to the next song" hint="At STOP locators, move to the next song in the setlist" checked={s.autojumpNextSong} onChange={(autojumpNextSong) => set({ autojumpNextSong })} />
        <div className="flex items-center justify-between gap-4 py-2">
          <span>
            <span className="block">Count-in</span>
            <span className="block text-xs text-muted">When starting playback. Override per section with [c:N]</span>
          </span>
          <Select
            value={s.countInBars}
            options={[0, 1, 2, 4].map((n) => ({ value: n as SettingsT['countInBars'], label: n ? `${n} bar${n > 1 ? 's' : ''}` : 'Off' }))}
            onChange={(countInBars) => set({ countInBars })}
          />
        </div>
        <Toggle label="Solo click during count-in" hint="Tracks named Click or flagged +CLICK" checked={s.countInSoloClick} onChange={(countInSoloClick) => set({ countInSoloClick })} />
      </Section>

      <Section title="Appearance">
        <div className="flex items-center justify-between gap-4 py-2">
          <span>Theme</span>
          <Select value={s.theme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} onChange={(theme) => set({ theme })} />
        </div>
        <div className="flex items-center justify-between gap-4 py-2">
          <span>Font size</span>
          <input type="range" min={0.75} max={1.5} step={0.05} value={s.fontScale} onChange={(e) => set({ fontScale: Number(e.target.value) })} />
        </div>
      </Section>

      <Section title="MIDI mapping">
        {state.midiInputs.length === 0 && <p className="text-sm text-muted">No MIDI inputs found. On Windows, disable the device in Live's MIDI preferences so Setlist can open it.</p>}
        <ul className="flex flex-col gap-2">
          {mappings.map((m) => {
            const learning = state.midiLearn?.mappingId === m.id;
            return (
              <li key={m.id} className="flex flex-col gap-2 rounded-lg bg-panel2 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={m.action} options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))} onChange={(action) => setMapping(m.id, { action })} />
                  <span className="text-sm text-muted">
                    {m.number >= 0 ? `${m.input || 'any input'} · ${m.kind.toUpperCase()} ${m.number} · ch ${m.channel}` : 'not assigned'}
                  </span>
                  <div className="flex-1" />
                  <Button active={learning} onClick={() => act(learning ? 'midiLearnCancel' : 'midiLearn', m.id)}>{learning ? 'Press a control…' : 'Learn'}</Button>
                  <Button variant="ghost" onClick={() => set({ midiMappings: mappings.filter((x) => x.id !== m.id) })}>Remove</Button>
                </div>
                {m.action === 'osc' && (
                  <TextInput
                    placeholder='/global/stop; //sleep 500; /setlist/jumpBySongs 1'
                    defaultValue={m.osc}
                    onBlur={(e) => setMapping(m.id, { osc: e.target.value })}
                  />
                )}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Select value={m.kind} options={[{ value: 'note', label: 'Note' }, { value: 'cc', label: 'CC' }, { value: 'pc', label: 'Program' }]} onChange={(kind) => setMapping(m.id, { kind })} />
                  <label>#<input type="number" min={0} max={127} value={m.number} onChange={(e) => setMapping(m.id, { number: Number(e.target.value) })} className="ml-1 w-16 rounded border border-line bg-panel px-1" /></label>
                  <label>ch<input type="number" min={1} max={16} value={m.channel} onChange={(e) => setMapping(m.id, { channel: Number(e.target.value) })} className="ml-1 w-14 rounded border border-line bg-panel px-1" /></label>
                  <Select value={m.input || '*'} options={[{ value: '*', label: 'Any input' }, ...state.midiInputs.map((i) => ({ value: i, label: i }))]} onChange={(input) => setMapping(m.id, { input })} />
                </div>
              </li>
            );
          })}
        </ul>
        <Button
          className="mt-3"
          onClick={() => {
            const id = Math.random().toString(36).slice(2, 10);
            set({ midiMappings: [...mappings, { id, input: '*', kind: 'note', channel: 1, number: -1, action: 'go' }] });
            act('midiLearn', id);
          }}
        >
          Add mapping
        </Button>
      </Section>

      <Section title="OSC">
        <div className="flex items-center justify-between gap-4 py-2">
          <span>
            <span className="block">OSC port</span>
            <span className="block text-xs text-muted">Restart Setlist after changing</span>
          </span>
          <input type="number" defaultValue={s.oscPort} onBlur={(e) => set({ oscPort: Number(e.target.value) || 39051 })} className="w-24 rounded-lg border border-line bg-panel2 px-2 py-1" />
        </div>
        <p className="text-xs text-muted">
          e.g. <code>/global/play</code>, <code>/setlist/jumpBySongs 1</code>, <code>/sections/next</code>, <code>/loop/toggle</code>,{' '}
          <code>/mixer/group VOX mute</code>, <code>/notify/big all "Hello"</code>. Send <code>/subscribe &lt;port&gt;</code> to receive state.
        </p>
      </Section>

      <Section title="Project">
        <label className="block text-sm">Project folder (for lyrics images in &lt;folder&gt;/Lyrics)</label>
        <TextInput className="mt-1" defaultValue={s.projectFolder ?? ''} placeholder="C:\Music\My Show Project" onBlur={(e) => set({ projectFolder: e.target.value.trim() || null })} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => act('placeSectionLocators')} title="Section clips can only be jumped to while stopped unless they have a locator">Place locators on section clips</Button>
          <Button onClick={() => act('removeAutoLocators')}>Remove placed locators</Button>
        </div>
      </Section>

      {state.errors.length > 0 && (
        <Section title="Remote Script errors">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-danger">{state.errors.join('\n\n')}</pre>
          <Button className="mt-2" onClick={() => act('clearErrors')}>Clear</Button>
        </Section>
      )}
    </div>
  );
}
