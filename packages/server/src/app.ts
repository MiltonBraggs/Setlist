import { EventEmitter } from 'node:events';
import {
  ALL_SONGS_NAME,
  DEFAULT_SETTINGS,
  activeOrder,
  applyMixerUpdate,
  beatsPerBar,
  buildPlan,
  buildSongs,
  createSetlist,
  groupDisplayName,
  jumpTiming,
  locate,
  loopAt,
  matchSong,
  normalizeViewerPermissions,
  parseTrackName,
  reconcileSetlist,
  sectionByOffset,
  setlistFromText,
  silencePoints,
  songByOffset,
  summarizeSetlist,
  type AppState,
  type JumpMode,
  type MixerUpdate,
  type MidiMapping,
  type PlaybackPlan,
  type QueuedJump,
  type ScriptToServer,
  type Section,
  type Settings,
  type Setlist,
  type SetlistEntry,
  type Song,
} from '@setlist/core';
import type { LiveBridge } from './bridge.ts';
import type { PluginHub } from './plugins.ts';
import { newId, type Storage } from './storage.ts';

const EPS = 1e-6;
const SAVE_DELAY_MS = 300;
/** Tempo automation can change the tempo many times a second; song durations don't need that. */
const TEMPO_REFRESH_MS = 1000;
const MAX_TEXT = 500;
const MAX_NAME = 100;
const JUMP_MODES: JumpMode[] = ['quantized', 'endOfSection', 'endOfSong', 'dynamic', 'manual'];

export type ActionSource = 'ui' | 'midi' | 'osc' | 'internal';

export interface MidiEvent {
  input: string;
  kind: MidiMapping['kind'];
  channel: number;
  number: number;
  /** velocity / CC value / 127 for program changes */
  value: number;
}

interface AppEvents {
  patch: [Partial<AppState>];
  time: [number, boolean];
  meters: [[string, number, number][]];
  mixer: [MixerUpdate];
  settings: [Settings];
}

/** Actions that stay available on a locked device. */
const LOCK_EXEMPT = new Set(['toggleLock', 'clearNotification']);

const EMPTY_LIVE: AppState['live'] = {
  recordMode: false,
  tempo: 120,
  sigNum: 4,
  sigDen: 4,
  loop: { on: false, start: 0, length: 0 },
  quantization: 4,
  songLength: 0,
};

const EMPTY_SETLIST: Setlist = { id: '', name: '', entries: [] };

function cleanText(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim().slice(0, max);
  return t || undefined;
}

/** Entries from a client: well-formed, known songs only, each song once. */
function sanitizeEntries(value: unknown, knownIds: Set<string>): SetlistEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SetlistEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.songId !== 'string' || !knownIds.has(e.songId) || seen.has(e.songId)) continue;
    seen.add(e.songId);
    const entry: SetlistEntry = { songId: e.songId };
    if (e.removed === true) entry.removed = true;
    const description = cleanText(e.description);
    const stopDescription = cleanText(e.stopDescription);
    if (description !== undefined) entry.description = description;
    if (stopDescription !== undefined) entry.stopDescription = stopDescription;
    out.push(entry);
  }
  return out;
}

export class SetlistApp extends EventEmitter<AppEvents> {
  state: AppState;
  time = 0;
  playing = false;
  /** Stored setlists of the current project, including entries for songs that don't exist right now. */
  private setlists = new Map<string, Setlist>();
  private activeId = '';
  private plan: PlaybackPlan = { events: [], loops: [] };
  private structureKey = '';
  private songsJson = '';
  private setlistJson = '';
  private summariesJson = '';
  private planJson = '';
  private projectId: string | null = null;
  private songIdKey = '';
  private guideState = new Map<string, boolean>();
  private notificationId = 0;
  private notificationTimer?: NodeJS.Timeout;
  private pendingSaves = new Set<string>();
  private saveTimer?: NodeJS.Timeout;
  private settingsTimer?: NodeJS.Timeout;
  private tempoTimer?: NodeJS.Timeout;
  private lastLoopActive = false;
  private meterClients = 0;
  private pluginHub: PluginHub | null = null;
  /** Executes custom OSC strings (wired up by the OSC service). */
  oscExec: (commands: string) => void = () => {};

  constructor(
    private bridge: LiveBridge,
    private storage: Storage,
  ) {
    super();
    this.state = {
      liveConnected: false,
      scriptVersion: null,
      live: EMPTY_LIVE,
      tracks: [],
      cues: [],
      songs: [],
      setlist: EMPTY_SETLIST,
      setlists: [],
      queued: null,
      settings: storage.loadSettings(),
      locked: false,
      notification: null,
      errors: [],
      urls: [],
      midiInputs: [],
      midiLearn: null,
      plugins: [],
      access: { pinSet: false, owners: 0, viewers: 0 },
    };
    bridge.on('message', (m) => {
      try {
        this.onScriptMessage(m);
      } catch (err) {
        console.error('[app] failed to handle Live message', err);
      }
    });
    bridge.on('connected', (c) => {
      this.set({ liveConnected: c });
      if (!c) this.set({ queued: null });
    });
  }

  private set(partial: Partial<AppState>) {
    Object.assign(this.state, partial);
    this.emit('patch', partial);
  }

  // ------------------------------------------------------------- Live input

  private onScriptMessage(msg: ScriptToServer) {
    switch (msg.type) {
      case 'hello':
        this.set({ scriptVersion: msg.version });
        break;
      case 'snapshot': {
        const { time, isPlaying, tracks, cues, ...live } = msg.state;
        this.set({ live: { ...EMPTY_LIVE, ...live }, tracks: tracks ?? [], cues: cues ?? [] });
        this.updateTime(time, isPlaying);
        this.refreshSongs(true);
        this.updateGuides();
        break;
      }
      case 'patch': {
        const { time, isPlaying, tracks, cues, ...rest } = msg.state;
        const partial: Partial<AppState> = {};
        if (Object.keys(rest).length) partial.live = { ...this.state.live, ...rest };
        if (tracks) partial.tracks = tracks;
        if (cues) partial.cues = cues;
        if (Object.keys(partial).length) this.set(partial);
        if (isPlaying !== undefined || time !== undefined) this.updateTime(time ?? this.time, isPlaying ?? this.playing);
        if (tracks || cues || 'songLength' in rest) this.refreshSongs(false);
        else if ('tempo' in rest) this.scheduleTempoRefresh();
        if ('loop' in rest || tracks) this.updateGuides();
        break;
      }
      case 'mixer':
        this.applyMixer(msg.tracks);
        break;
      case 'time':
        // A connected Setlist Sync plugin reports a more precise playhead; prefer it.
        if (this.state.plugins.length === 0) this.updateTime(msg.time, msg.playing);
        break;
      case 'meters':
        this.emit('meters', msg.levels);
        break;
      case 'fired':
        if (msg.event === 'queued' || msg.event === 'stop') this.setQueued(null);
        break;
      case 'log':
        if (msg.level === 'error') this.set({ errors: [...this.state.errors, msg.message].slice(-20) });
        console.log(`[live] ${msg.message}`);
        break;
      case 'pong':
        break;
    }
  }

  /** Mute / solo / volume only: update in place and send the small update, never rebuild songs. */
  private applyMixer(update: MixerUpdate) {
    if (!Array.isArray(update) || update.length === 0) return;
    this.state.tracks = applyMixerUpdate(this.state.tracks, update); // no full 'patch': clients apply the 'mixer' event
    this.emit('mixer', update);
  }

  private updateTime(time: number, playing: boolean) {
    if (!Number.isFinite(time)) return;
    const wasPlaying = this.playing;
    this.time = time;
    this.playing = !!playing;
    this.emit('time', time, this.playing);
    if (wasPlaying && !this.playing) this.onStopped();
    const q = this.state.queued;
    // Safety net: a boundary we passed without the script reporting the jump.
    if (q && q.at !== null && this.playing && time > q.at + 1) this.setQueued(null);
    const loopActive = this.loopActive();
    if (loopActive !== this.lastLoopActive) {
      this.lastLoopActive = loopActive;
      this.updateGuides();
    }
  }

  private onStopped() {
    const q = this.state.queued;
    if (q) {
      // Held (manual mode) or pending jumps execute as soon as playback stops.
      this.bridge.command({ name: 'jump', to: q.to, quantized: false });
      this.setQueued(null);
    }
  }

  private scheduleTempoRefresh() {
    if (this.tempoTimer) return;
    this.tempoTimer = setTimeout(() => {
      this.tempoTimer = undefined;
      this.refreshSongs(false);
    }, TEMPO_REFRESH_MS);
  }

  /** Rebuild songs, but only when what they're built from actually changed. */
  private refreshSongs(force: boolean) {
    clearTimeout(this.tempoTimer); // this rebuild covers any pending tempo refresh
    this.tempoTimer = undefined;
    const { tracks, cues, live } = this.state;
    const key = JSON.stringify([cues, tracks.map((t) => [t.name, t.clips ?? null]), live.tempo, live.songLength]);
    if (key === this.structureKey && !force) return;
    this.structureKey = key;

    const songs = buildSongs({ cues, tracks, tempo: live.tempo, songLength: live.songLength });
    const json = JSON.stringify(songs);
    if (json !== this.songsJson) {
      this.songsJson = json;
      this.set({ songs });
    }
    if (songs.length > 0) this.selectProject(songs);
    this.applyActive(false, force);
  }

  // --------------------------------------------------------------- setlists

  private selectProject(songs: Song[]) {
    // Matching a stored project reads the disk: only when the set of songs changed.
    const idKey = songs.map((s) => s.id).join('\n');
    if (idKey === this.songIdKey) return;
    this.songIdKey = idKey;
    // Write pending edits while their setlists (and project folder) are still current.
    this.flushSetlists();
    const project = this.storage.selectProject(songs.map((s) => s.id));
    if (project.id === this.projectId) return;
    this.projectId = project.id;
    this.setlists = new Map(project.setlists.map((s) => [s.id, s]));
    if (this.setlists.size === 0) {
      const all: Setlist = { id: newId(), name: ALL_SONGS_NAME, autoAdd: true, entries: [] };
      this.setlists.set(all.id, all);
      this.storage.saveSetlist(all);
    }
    this.activeId = project.activeId && this.setlists.has(project.activeId) ? project.activeId : this.setlists.keys().next().value!;
    this.storage.setActiveSetlist(this.activeId);
  }

  /** Recompute the active setlist and the list of setlists from storage + songs; persist if asked. */
  private applyActive(persist: boolean, forcePlan = false) {
    const songs = this.state.songs;
    const raw = this.setlists.get(this.activeId);
    const setlist = raw ? reconcileSetlist(raw, songs) : EMPTY_SETLIST;
    const setlistJson = JSON.stringify(setlist);
    if (setlistJson !== this.setlistJson) {
      this.setlistJson = setlistJson;
      this.set({ setlist });
    }
    const summaries = [...this.setlists.values()].map((s) => summarizeSetlist(reconcileSetlist(s, songs), songs));
    const summariesJson = JSON.stringify(summaries);
    if (summariesJson !== this.summariesJson) {
      this.summariesJson = summariesJson;
      this.set({ setlists: summaries });
    }
    this.pushPlan(forcePlan);
    if (persist && raw) this.scheduleSave(raw.id);
  }

  private updateActive(fn: (raw: Setlist) => Setlist) {
    const raw = this.setlists.get(this.activeId);
    if (!raw) return;
    this.setlists.set(raw.id, fn(raw));
    this.applyActive(true);
  }

  private selectSetlist(id: string) {
    if (!this.setlists.has(id) || id === this.activeId) return;
    // A jump queued under the previous setlist may target a song that isn't in this one.
    this.cancelQueue();
    this.activeId = id;
    this.storage.setActiveSetlist(id);
    this.applyActive(false);
  }

  private scheduleSave(id: string) {
    this.pendingSaves.add(id);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSetlists(), SAVE_DELAY_MS);
  }

  private flushSetlists() {
    clearTimeout(this.saveTimer);
    for (const id of this.pendingSaves) {
      const s = this.setlists.get(id);
      if (s) this.storage.saveSetlist(s);
    }
    this.pendingSaves.clear();
  }

  /** Entries for songs that don't exist right now (e.g. mid-rename in Live) stay at the end. */
  private withOrphans(raw: Setlist, entries: SetlistEntry[]): SetlistEntry[] {
    const ids = new Set(this.state.songs.map((s) => s.id));
    return [...entries, ...raw.entries.filter((e) => !ids.has(e.songId))];
  }

  private knownSongIds(): Set<string> {
    return new Set(this.state.songs.map((s) => s.id));
  }

  private order(): string[] {
    return activeOrder(this.state.setlist);
  }

  /** Connect "Setlist Sync" VST3 instances: precise playhead in, stop points out. (On hold.) */
  attachPlugins(hub: PluginHub) {
    this.pluginHub = hub;
    hub.on('instances', (plugins) => this.set({ plugins }));
    hub.on('time', (id, time, playing) => {
      // Several instances (Master + other outputs) report the same transport: follow the first.
      if (id === this.state.plugins[0]?.id) this.updateTime(time, playing);
    });
    hub.on('gated', (_id, at) => console.log(`[plugins] silenced output at beat ${at}`));
    this.pushGates();
  }

  private pushGates() {
    this.pluginHub?.setGates(silencePoints(this.plan, this.state.queued?.at ?? null));
  }

  private pushPlan(force = false) {
    this.plan = buildPlan(this.state.songs, this.order(), this.state.settings);
    const json = JSON.stringify(this.plan);
    if (json === this.planJson && !force) return;
    this.planJson = json;
    if (this.state.liveConnected) this.bridge.send({ type: 'plan', plan: this.plan });
    this.pushGates();
  }

  // ------------------------------------------------------------- navigation

  private ctx() {
    return { songs: this.state.songs, order: this.order(), time: this.time, isPlaying: this.playing };
  }

  private loopActive(): boolean {
    const loop = this.state.live.loop;
    return loop.on && this.time >= loop.start - EPS && this.time < loop.start + loop.length - EPS;
  }

  private currentSection(): { song?: Song; section?: Section } {
    const loc = locate(this.state.songs, this.time);
    const song = this.state.songs[loc.songIndex];
    return { song, section: song?.sections[loc.sectionIndex] };
  }

  private setQueued(queued: QueuedJump | null) {
    if (queued === null && this.state.queued === null) return;
    this.set({ queued });
    this.pushGates();
    this.updateGuides();
  }

  private queueJump(song: Song, section?: Section) {
    const to = section ? section.start : song.start;
    const target = { kind: section ? ('section' as const) : ('song' as const), songId: song.id };
    let timing = jumpTiming(this.ctx(), target, this.state.settings.jumpMode);
    if (timing.kind === 'quantized' && this.loopActive()) {
      const loop = loopAt(this.plan, this.time);
      if (loop?.full) timing = { kind: 'at', at: loop.end };
    }
    const queued: QueuedJump = { kind: target.kind, songId: song.id, sectionId: section?.id, to, at: null, hold: false };
    switch (timing.kind) {
      case 'instant':
        this.bridge.command({ name: 'jump', to, quantized: false });
        this.setQueued(null);
        this.updateTime(to, false);
        break;
      case 'quantized':
        this.bridge.command({ name: 'jump', to, quantized: section ? section.hasCue : true });
        this.setQueued(null);
        break;
      case 'at':
        if (timing.at <= this.time + EPS) {
          this.bridge.command({ name: 'jump', to, quantized: true });
          this.setQueued(null);
        } else {
          this.bridge.command({ name: 'queue', at: timing.at, to });
          this.setQueued({ ...queued, at: timing.at });
        }
        break;
      case 'hold':
        this.setQueued({ ...queued, hold: true });
        break;
    }
  }

  private jumpQueued(instant: boolean) {
    const q = this.state.queued;
    if (!q) return;
    this.bridge.command({ name: 'jump', to: q.to, quantized: !instant });
    this.setQueued(null);
  }

  private cancelQueue() {
    if (!this.state.queued) return;
    this.bridge.command({ name: 'cancelQueue' });
    this.setQueued(null);
  }

  private findSong(ref: unknown): Song | undefined {
    const songs = this.state.songs;
    if (typeof ref === 'number') {
      // 1-based index into the setlist, like AbleSet's OSC API.
      return songs.find((s) => s.id === this.order()[ref - 1]);
    }
    if (typeof ref !== 'string') return undefined;
    return songs.find((s) => s.id === ref) ?? matchSong(ref, songs);
  }

  private findSection(song: Song, ref: unknown): Section | undefined {
    if (typeof ref === 'number') return song.sections[ref - 1];
    if (typeof ref !== 'string') return undefined;
    const lower = ref.toLowerCase();
    return song.sections.find((s) => s.id === ref) ?? song.sections.find((s) => s.title.toLowerCase() === lower);
  }

  // ---------------------------------------------------------------- transport

  private play() {
    if (this.playing) return;
    // Parked between songs (e.g. at a STOP locator): start the next song in the setlist, never
    // whatever happens to follow in the arrangement. A safety net in case Live didn't keep the
    // playhead where the Remote Script parked it.
    if (this.state.songs.length > 0 && locate(this.state.songs, this.time).songIndex < 0) {
      const next = songByOffset(this.ctx(), 1);
      if (next) {
        this.bridge.command({ name: 'jump', to: next.start, quantized: false });
        this.updateTime(next.start, false);
      }
    }
    const { section } = this.currentSection();
    const atSectionStart = section && Math.abs(section.start - this.time) < 0.01;
    const bars = atSectionStart && section.countIn?.bars !== undefined ? section.countIn.bars : this.state.settings.countInBars;
    if (bars > 0) {
      const clickTrackIds = this.state.settings.countInSoloClick
        ? this.state.tracks.filter((t) => parseTrackName(t.name).isClick).map((t) => t.id)
        : [];
      this.bridge.command({ name: 'countIn', from: this.time, bars, clickTrackIds });
    } else {
      this.bridge.command({ name: 'play' });
    }
  }

  /** Context-aware single button (AbleSet's GO). */
  private go() {
    // Stopped: play (between songs, play() first moves to the next setlist song).
    if (!this.playing) return this.play();
    if (this.loopActive()) return this.escapeLoop();
    if (this.state.queued) return this.jumpQueued(true);
  }

  private escapeLoop() {
    this.bridge.command({ name: 'setLoop', on: false });
  }

  private toggleLoop() {
    if (this.loopActive()) return this.escapeLoop();
    const { song, section } = this.currentSection();
    const region = section ?? (song ? { start: song.start, end: song.playEnd } : undefined);
    if (!region || region.end <= region.start) return;
    this.bridge.command({ name: 'setLoop', on: true, start: region.start, length: region.end - region.start });
  }

  private jumpByMeasures(n: number) {
    const bar = beatsPerBar(this.state.live.sigNum, this.state.live.sigDen);
    const base = Math.round(this.time / bar) * bar;
    const to = Math.max(0, base + n * bar);
    this.bridge.command({ name: 'jump', to, quantized: false });
    if (!this.playing) this.updateTime(to, false);
  }

  // ------------------------------------------------------------------ mixer

  groups(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const track of this.state.tracks) {
      for (const g of parseTrackName(track.name).groups) {
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(track.id);
      }
    }
    return groups;
  }

  private mixerGroup(group: string, op: string, value?: unknown) {
    const ids = this.groups().get(group.toUpperCase().replace(/ /g, '_'));
    if (!ids) return;
    const tracks = this.state.tracks.filter((t) => ids.includes(t.id));
    const anyMuted = tracks.some((t) => t.mute);
    const anySolo = tracks.some((t) => t.solo);
    for (const t of tracks) {
      const neverMute = parseTrackName(t.name).neverMute;
      switch (op) {
        case 'mute':
        case 'unmute':
        case 'toggleMute': {
          const mute = op === 'mute' || (op === 'toggleMute' && !anyMuted);
          if (!(mute && neverMute)) this.bridge.command({ name: 'setTrack', id: t.id, mute });
          break;
        }
        case 'solo':
        case 'unsolo':
        case 'toggleSolo':
          this.bridge.command({ name: 'setTrack', id: t.id, solo: op === 'solo' || (op === 'toggleSolo' && !anySolo) });
          break;
        case 'volume': {
          const v = Number(value);
          if (Number.isFinite(v)) this.bridge.command({ name: 'setTrack', id: t.id, volume: Math.max(0, Math.min(1, v)) });
          break;
        }
      }
    }
  }

  /** Mute/unmute +GUIDE / +LOOPGUIDE / +JUMPGUIDE tracks (edge-triggered, so manual changes stick). */
  private updateGuides() {
    const q = this.state.queued;
    const jumping = !!q && (q.hold || q.at === null || Math.abs(q.to - q.at) > EPS);
    const looping = this.loopActive();
    for (const track of this.state.tracks) {
      const p = parseTrackName(track.name);
      if (p.neverMute || !(p.guide || p.loopGuide || p.jumpGuide)) continue;
      let audible: boolean;
      if (p.loopGuide || p.jumpGuide) audible = (p.loopGuide && looping) || (p.jumpGuide && jumping);
      else audible = !(looping || jumping);
      const mute = !audible;
      const key = `${track.id}:${track.name}`;
      if (this.guideState.get(key) === mute) continue;
      this.guideState.set(key, mute);
      if (track.mute !== mute) this.bridge.command({ name: 'setTrack', id: track.id, mute });
    }
  }

  setMetersWanted(delta: number) {
    const before = this.meterClients > 0;
    this.meterClients = Math.max(0, this.meterClients + delta);
    const after = this.meterClients > 0;
    if (before !== after) this.bridge.command({ name: 'setMeters', enabled: after });
  }

  // ------------------------------------------------------------------- MIDI

  handleMidi(ev: MidiEvent) {
    const learn = this.state.midiLearn;
    if (learn) {
      const mappings = this.state.settings.midiMappings.map((m) =>
        m.id === learn.mappingId ? { ...m, input: ev.input, kind: ev.kind, channel: ev.channel, number: ev.number } : m,
      );
      this.set({ midiLearn: null });
      this.updateSettings({ midiMappings: mappings });
      return;
    }
    const pressed = ev.kind === 'pc' || ev.value >= 64 || (ev.kind === 'note' && ev.value > 0);
    if (!pressed) return;
    for (const m of this.state.settings.midiMappings) {
      if (m.kind !== ev.kind || m.channel !== ev.channel || m.number !== ev.number) continue;
      if (m.input && m.input !== '*' && m.input !== ev.input) continue;
      if (m.action === 'osc') this.oscExec(m.osc ?? '');
      else this.dispatch(m.action, [], 'midi');
    }
  }

  setMidiInputs(inputs: string[]) {
    if (inputs.length === this.state.midiInputs.length && inputs.every((x, i) => x === this.state.midiInputs[i])) return;
    this.set({ midiInputs: inputs });
  }

  // --------------------------------------------------------------- settings

  updateSettings(partial: Partial<Settings>) {
    if (!partial || typeof partial !== 'object') return;
    // Only known keys, with sane values.
    const clean: Partial<Settings> = {};
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (key in partial) (clean as Record<string, unknown>)[key] = partial[key];
    }
    if ('jumpMode' in clean && !JUMP_MODES.includes(clean.jumpMode!)) delete clean.jumpMode;
    if ('countInBars' in clean && ![0, 1, 2, 4].includes(clean.countInBars!)) delete clean.countInBars;
    if ('theme' in clean && clean.theme !== 'light' && clean.theme !== 'dark') delete clean.theme;
    if ('fontScale' in clean) clean.fontScale = Math.max(0.5, Math.min(2, Number(clean.fontScale) || 1));
    if ('oscPort' in clean) {
      const port = Number(clean.oscPort);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) delete clean.oscPort;
    }
    if ('midiMappings' in clean) {
      if (!Array.isArray(clean.midiMappings)) delete clean.midiMappings;
      else
        clean.midiMappings = clean.midiMappings.filter(
          (m) =>
            !!m &&
            typeof m === 'object' &&
            typeof m.id === 'string' &&
            typeof m.action === 'string' &&
            (m.kind === 'note' || m.kind === 'cc' || m.kind === 'pc') &&
            Number.isInteger(m.channel) &&
            Number.isInteger(m.number),
        );
    }
    if ('viewer' in clean) clean.viewer = normalizeViewerPermissions(clean.viewer);
    if (Object.keys(clean).length === 0) return;

    const settings = { ...this.state.settings, ...clean };
    this.set({ settings });
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => this.storage.saveSettings(this.state.settings), SAVE_DELAY_MS);
    if ('autojumpNextSong' in clean) this.pushPlan();
    this.emit('settings', settings);
  }

  notify(text: string, big = true) {
    clearTimeout(this.notificationTimer);
    this.set({ notification: { id: ++this.notificationId, text: text.slice(0, MAX_TEXT), big } });
    this.notificationTimer = setTimeout(() => this.set({ notification: null }), 15000);
  }

  setAccess(access: AppState['access']) {
    const a = this.state.access;
    if (a.pinSet === access.pinSet && a.owners === access.owners && a.viewers === access.viewers) return;
    this.set({ access });
  }

  setUrls(urls: string[]) {
    this.set({ urls });
  }

  /** Write pending setlist and settings changes now (on shutdown). */
  flush() {
    this.flushSetlists();
    if (this.settingsTimer) {
      clearTimeout(this.settingsTimer);
      this.storage.saveSettings(this.state.settings);
    }
    clearTimeout(this.tempoTimer);
    clearTimeout(this.notificationTimer);
  }

  // ---------------------------------------------------------------- actions

  dispatch(action: string, args: unknown[] = [], source: ActionSource = 'internal'): void {
    if (source === 'ui' && this.state.locked && !LOCK_EXEMPT.has(action)) return;
    const handler = Object.prototype.hasOwnProperty.call(this.actions, action) ? this.actions[action] : undefined;
    if (!handler) {
      console.warn(`[app] unknown action ${action}`);
      return;
    }
    try {
      handler(...args);
    } catch (err) {
      console.error(`[app] action ${action} failed`, err);
    }
  }

  readonly actions: Record<string, (...args: any[]) => void> = {
    play: () => this.play(),
    pause: () => this.bridge.command({ name: 'pause' }),
    stop: () => this.bridge.command({ name: 'stop' }),
    playPause: () => (this.playing ? this.bridge.command({ name: 'pause' }) : this.play()),
    playStop: () => (this.playing ? this.bridge.command({ name: 'stop' }) : this.play()),
    go: () => this.go(),
    toggleRecord: () => this.bridge.command({ name: 'toggleRecord' }),

    jumpBySongs: (n: unknown) => {
      const song = songByOffset(this.ctx(), Math.trunc(Number(n)) || 0);
      if (song) this.queueJump(song);
    },
    nextSong: () => (this.loopActive() ? this.escapeLoop() : this.actions.jumpBySongs(1)),
    prevSong: () => this.actions.jumpBySongs(-1),
    jumpBySections: (n: unknown) => {
      const target = sectionByOffset(this.ctx(), Math.trunc(Number(n)) || 0);
      if (target) this.queueJump(target.song, target.section);
    },
    nextSection: () => this.actions.jumpBySections(1),
    prevSection: () => this.actions.jumpBySections(-1),
    jumpToSong: (ref: unknown) => {
      const song = this.findSong(ref);
      if (song) this.queueJump(song);
    },
    jumpToSection: (songRef: unknown, sectionRef?: unknown) => {
      if (sectionRef === undefined) {
        // Section in the current song by name / 1-based index.
        const { song } = this.currentSection();
        const section = song && this.findSection(song, songRef);
        if (song && section) this.queueJump(song, section);
        return;
      }
      const song = this.findSong(songRef);
      const section = song && this.findSection(song, sectionRef);
      if (song && section) this.queueJump(song, section);
    },
    jumpByMeasures: (n: unknown) => this.jumpByMeasures(Math.trunc(Number(n)) || 0),
    jumpToTime: (beats: unknown) => {
      const to = Math.max(0, Number(beats) || 0);
      this.bridge.command({ name: 'jump', to, quantized: false });
      if (!this.playing) this.updateTime(to, false);
    },
    jumpQueued: () => this.jumpQueued(false),
    jumpQueuedNow: () => this.jumpQueued(true),
    cancelQueue: () => this.cancelQueue(),

    toggleLoop: () => this.toggleLoop(),
    escapeLoop: () => this.escapeLoop(),
    enableLoop: () => {
      if (!this.loopActive()) this.toggleLoop();
    },
    toggleLock: () => this.set({ locked: !this.state.locked }),

    // Setlists. Edits apply to the active setlist and save automatically.
    setSetlist: (setlist: unknown) => {
      const entries = sanitizeEntries((setlist as Setlist | null)?.entries, this.knownSongIds());
      this.updateActive((raw) => ({ ...raw, entries: this.withOrphans(raw, entries) }));
    },
    createSetlist: (name: unknown, songIds: unknown) => {
      if (this.state.songs.length === 0) return;
      const ids = Array.isArray(songIds) ? songIds.filter((x): x is string => typeof x === 'string') : [];
      const setlist = createSetlist(newId(), cleanText(name, MAX_NAME) ?? 'New setlist', ids, this.state.songs);
      this.setlists.set(setlist.id, setlist);
      this.storage.saveSetlist(setlist);
      this.selectSetlist(setlist.id);
    },
    selectSetlist: (id: unknown) => this.selectSetlist(String(id)),
    loadSetlist: (name: unknown) => {
      // By name (OSC: /setlist/load "Friday").
      const wanted = String(name).trim().toLowerCase();
      const match = [...this.setlists.values()].find((s) => s.name.toLowerCase() === wanted);
      if (match) this.selectSetlist(match.id);
    },
    renameSetlist: (id: unknown, name: unknown) => {
      const raw = this.setlists.get(String(id));
      const clean = cleanText(name, MAX_NAME);
      if (!raw || !clean) return;
      this.setlists.set(raw.id, { ...raw, name: clean });
      this.applyActive(false);
      this.scheduleSave(raw.id);
    },
    duplicateSetlist: (id: unknown) => {
      const raw = this.setlists.get(String(id));
      if (!raw) return;
      const copy: Setlist = {
        ...raw,
        id: newId(),
        name: `${raw.name} copy`.slice(0, MAX_NAME),
        autoAdd: false,
        created: Date.now(),
        entries: raw.entries.map((e) => ({ ...e })),
      };
      this.setlists.set(copy.id, copy);
      this.storage.saveSetlist(copy);
      this.selectSetlist(copy.id);
    },
    deleteSetlist: (id: unknown) => {
      const key = String(id);
      if (!this.setlists.has(key)) return;
      if (this.setlists.size <= 1) return this.notify('Keep at least one setlist.', false);
      this.setlists.delete(key);
      this.pendingSaves.delete(key);
      this.storage.deleteSetlist(key);
      if (this.activeId === key) this.selectSetlist(this.setlists.keys().next().value!);
      else this.applyActive(false);
    },
    importSetlistText: (text: unknown) => {
      const { entries, unmatched } = setlistFromText(String(text ?? ''), this.state.songs);
      this.updateActive((raw) => ({ ...raw, entries: this.withOrphans(raw, entries) }));
      if (unmatched.length) this.notify(`Couldn't match: ${unmatched.join(', ')}`, false);
    },
    resetSetlist: () => {
      // Back to arrangement order, keeping which songs are in or out.
      const index = new Map(this.state.songs.map((s) => [s.id, s.index]));
      this.updateActive((raw) => ({
        ...raw,
        entries: [...raw.entries].sort((a, b) => (index.get(a.songId) ?? Infinity) - (index.get(b.songId) ?? Infinity)),
      }));
    },

    updateSettings: (partial: Partial<Settings>) => this.updateSettings(partial),
    mixerGroup: (group: unknown, op: unknown, value?: unknown) => this.mixerGroup(String(group), String(op), value),
    setTrack: (id: unknown, props: { mute?: boolean; solo?: boolean; volume?: number }) => {
      if (typeof id !== 'string' || !props || typeof props !== 'object') return;
      this.bridge.command({ name: 'setTrack', id, mute: props.mute, solo: props.solo, volume: props.volume });
    },

    notify: (text: unknown, big = true) => this.notify(String(text ?? ''), big !== false),
    clearNotification: () => this.set({ notification: null }),
    clearErrors: () => this.set({ errors: [] }),

    midiLearn: (mappingId: unknown) => this.set({ midiLearn: { mappingId: String(mappingId) } }),
    midiLearnCancel: () => this.set({ midiLearn: null }),

    placeSectionLocators: () => {
      if (this.playing) return this.notify('Stop playback to place locators', false);
      const items = this.state.songs.flatMap((s) =>
        s.sections.filter((sec) => !sec.hasCue).map((sec) => ({ time: sec.start, name: sec.raw.trim().startsWith('>') ? sec.raw : `> ${sec.raw}` })),
      );
      this.bridge.command({ name: 'placeLocators', items });
    },
    removeAutoLocators: () => {
      if (this.playing) return this.notify('Stop playback to remove locators', false);
      // Locators that sit exactly on a section clip with the same name were placed by the tool.
      const clips = this.state.tracks.filter((t) => parseTrackName(t.name).isSections).flatMap((t) => t.clips ?? []);
      const times = this.state.cues
        .filter((c) => clips.some((k) => Math.abs(k.start - c.time) < 1e-3 && (c.name === k.name || c.name === `> ${k.name}`)))
        .map((c) => c.time);
      this.bridge.command({ name: 'removeLocators', times });
    },
  };

  /** Display names of mixer groups, for UIs. */
  groupNames(): { id: string; name: string }[] {
    return [...this.groups().keys()].map((id) => ({ id, name: groupDisplayName(id) }));
  }

  /** Full snapshot for tests / REST. */
  snapshot(): AppState & { time: number; isPlaying: boolean } {
    return { ...this.state, time: this.time, isPlaying: this.playing };
  }
}
