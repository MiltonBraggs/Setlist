import { EventEmitter } from 'node:events';
import {
  activeOrder,
  beatsPerBar,
  buildPlan,
  buildSongs,
  groupDisplayName,
  jumpTiming,
  locate,
  loopAt,
  matchSong,
  parseTrackName,
  reconcileSetlist,
  silencePoints,
  sectionByOffset,
  setlistFromText,
  songByOffset,
  type AppState,
  type MidiMapping,
  type PlaybackPlan,
  type QueuedJump,
  type ScriptToServer,
  type Section,
  type Settings,
  type Setlist,
  type Song,
} from '@setlist/core';
import type { LiveBridge } from './bridge.ts';
import type { PluginHub } from './plugins.ts';
import type { Storage } from './storage.ts';

const EPS = 1e-6;

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
  cues: [],
  tracks: [],
};

export class SetlistApp extends EventEmitter<AppEvents> {
  state: AppState;
  time = 0;
  playing = false;
  /** Setlist including entries for songs that currently don't exist (e.g. mid-rename). */
  private rawSetlist: Setlist | null = null;
  private plan: PlaybackPlan = { events: [], loops: [] };
  private songKey = '';
  private projectId: string | null = null;
  private guideState = new Map<string, boolean>();
  private notificationId = 0;
  private notificationTimer?: NodeJS.Timeout;
  private saveTimer?: NodeJS.Timeout;
  private lastLoopActive = false;
  private meterClients = 0;
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
      songs: [],
      setlist: { name: 'Untitled Setlist', entries: [] },
      savedSetlists: [],
      queued: null,
      settings: storage.loadSettings(),
      locked: false,
      notification: null,
      errors: [],
      urls: [],
      midiInputs: [],
      midiLearn: null,
      plugins: [],
    };
    bridge.on('message', (m) => this.onScriptMessage(m));
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
        const { time, isPlaying, ...live } = msg.state;
        this.set({ live });
        this.updateTime(time, isPlaying);
        this.refreshSongs(true);
        break;
      }
      case 'patch': {
        const { time, isPlaying, ...rest } = msg.state;
        const live = { ...this.state.live, ...rest };
        this.set({ live });
        if (isPlaying !== undefined || time !== undefined) this.updateTime(time ?? this.time, isPlaying ?? this.playing);
        if ('cues' in rest || 'tracks' in rest || 'tempo' in rest || 'songLength' in rest) this.refreshSongs(false);
        if ('loop' in rest || 'tracks' in rest) this.updateGuides();
        break;
      }
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

  private updateTime(time: number, playing: boolean) {
    const wasPlaying = this.playing;
    this.time = time;
    this.playing = playing;
    this.emit('time', time, playing);
    if (wasPlaying && !playing) this.onStopped();
    const q = this.state.queued;
    // Safety net: a boundary we passed without the script reporting the jump.
    if (q && q.at !== null && playing && time > q.at + 1) this.setQueued(null);
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

  private refreshSongs(force: boolean) {
    const live = this.state.live;
    const songs = buildSongs({ cues: live.cues, tracks: live.tracks, tempo: live.tempo, songLength: live.songLength });
    const key = songs.map((s) => s.id).join('\n');
    this.set({ songs });
    if (key !== this.songKey && songs.length > 0) {
      this.songKey = key;
      const project = this.storage.selectProject(songs.map((s) => s.id));
      if (project.id !== this.projectId) {
        this.projectId = project.id;
        this.rawSetlist = project.current;
      }
      this.set({ savedSetlists: this.storage.listSetlists() });
    }
    this.applySetlist(this.rawSetlist, false);
    if (force) this.pushPlan();
  }

  // --------------------------------------------------------------- setlists

  private applySetlist(raw: Setlist | null, persist = true) {
    this.rawSetlist = raw;
    const setlist = reconcileSetlist(raw, this.state.songs);
    this.set({ setlist });
    this.pushPlan();
    if (persist) this.scheduleSave();
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const raw = this.rawSetlist ?? this.state.setlist;
      this.storage.saveCurrent(raw, this.state.songs.map((s) => s.id));
    }, 300);
  }

  /** Keep entries for songs that don't exist right now at the end of the raw setlist. */
  private mergeOrphans(next: Setlist): Setlist {
    const ids = new Set(this.state.songs.map((s) => s.id));
    const orphans = (this.rawSetlist?.entries ?? []).filter((e) => !ids.has(e.songId));
    return { ...next, entries: [...next.entries.filter((e) => ids.has(e.songId)), ...orphans] };
  }

  private order(): string[] {
    return activeOrder(this.state.setlist);
  }

  private pluginHub: PluginHub | null = null;

  /** Connect "Setlist Sync" VST3 instances: precise playhead in, stop points out. */
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

  private pushPlan() {
    this.plan = buildPlan(this.state.songs, this.order(), this.state.settings);
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
    const { section } = this.currentSection();
    const atSectionStart = section && Math.abs(section.start - this.time) < 0.01;
    const bars = atSectionStart && section.countIn?.bars !== undefined ? section.countIn.bars : this.state.settings.countInBars;
    if (bars > 0) {
      const clickTrackIds = this.state.settings.countInSoloClick
        ? this.state.live.tracks.filter((t) => parseTrackName(t.name).isClick).map((t) => t.id)
        : [];
      this.bridge.command({ name: 'countIn', from: this.time, bars, clickTrackIds });
    } else {
      this.bridge.command({ name: 'play' });
    }
  }

  /** Context-aware single button (AbleSet's GO). */
  private go() {
    if (!this.playing) {
      const loc = locate(this.state.songs, this.time);
      if (loc.songIndex < 0 && this.state.songs.length > 0) {
        const next = songByOffset(this.ctx(), 1);
        if (next) return this.queueJump(next);
      }
      return this.play();
    }
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
    if (!region) return;
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
    for (const track of this.state.live.tracks) {
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
    const tracks = this.state.live.tracks.filter((t) => ids.includes(t.id));
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
        case 'volume':
          if (typeof value === 'number') this.bridge.command({ name: 'setTrack', id: t.id, volume: value });
          break;
      }
    }
  }

  /** Mute/unmute +GUIDE / +LOOPGUIDE / +JUMPGUIDE tracks (edge-triggered, so manual changes stick). */
  private updateGuides() {
    const q = this.state.queued;
    const jumping = !!q && (q.hold || q.at === null || Math.abs(q.to - q.at) > EPS);
    const looping = this.loopActive();
    for (const track of this.state.live.tracks) {
      const p = parseTrackName(track.name);
      if (p.neverMute || !(p.guide || p.loopGuide || p.jumpGuide)) continue;
      let audible: boolean;
      if (p.loopGuide || p.jumpGuide) audible = (p.loopGuide && looping) || (p.jumpGuide && jumping);
      else audible = !(looping || jumping);
      const mute = !audible;
      if (this.guideState.get(track.id) === mute) continue;
      this.guideState.set(track.id, mute);
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
    this.set({ midiInputs: inputs });
  }

  // --------------------------------------------------------------- settings

  updateSettings(partial: Partial<Settings>) {
    const settings = { ...this.state.settings, ...partial };
    this.storage.saveSettings(settings);
    this.set({ settings });
    if ('autojumpNextSong' in partial) this.pushPlan();
    this.emit('settings', settings);
  }

  notify(text: string, big = true) {
    clearTimeout(this.notificationTimer);
    this.set({ notification: { id: ++this.notificationId, text, big } });
    this.notificationTimer = setTimeout(() => this.set({ notification: null }), 15000);
  }

  setUrls(urls: string[]) {
    this.set({ urls });
  }

  // ---------------------------------------------------------------- actions

  dispatch(action: string, args: unknown[] = [], source: ActionSource = 'internal'): void {
    if (source === 'ui' && this.state.locked && !LOCK_EXEMPT.has(action)) return;
    const handler = this.actions[action];
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

    jumpBySongs: (n: number) => {
      const song = songByOffset(this.ctx(), Number(n) || 0);
      if (song) this.queueJump(song);
    },
    nextSong: () => (this.loopActive() ? this.escapeLoop() : this.actions.jumpBySongs(1)),
    prevSong: () => this.actions.jumpBySongs(-1),
    jumpBySections: (n: number) => {
      const target = sectionByOffset(this.ctx(), Number(n) || 0);
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
    jumpByMeasures: (n: number) => this.jumpByMeasures(Number(n) || 0),
    jumpToTime: (beats: number) => {
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

    setSetlist: (setlist: Setlist) => this.applySetlist(this.mergeOrphans(setlist)),
    renameSetlist: (name: string) => this.applySetlist({ ...(this.rawSetlist ?? this.state.setlist), name: String(name) }),
    saveSetlist: (name?: string) => {
      const setlist = { ...this.state.setlist, name: name ? String(name) : this.state.setlist.name };
      this.storage.saveSetlist(setlist);
      this.applySetlist(this.mergeOrphans(setlist));
      this.set({ savedSetlists: this.storage.listSetlists() });
    },
    loadSetlist: (name: string) => {
      const setlist = this.storage.loadSetlist(String(name));
      if (setlist) this.applySetlist(setlist);
    },
    deleteSetlist: (name: string) => {
      this.storage.deleteSetlist(String(name));
      this.set({ savedSetlists: this.storage.listSetlists() });
    },
    importSetlistText: (text: string, name?: string) => {
      const { setlist, unmatched } = setlistFromText(String(text), this.state.songs, name ? String(name) : this.state.setlist.name);
      this.applySetlist(setlist);
      if (unmatched.length) this.notify(`Couldn't match: ${unmatched.join(', ')}`, false);
    },
    resetSetlist: () => this.applySetlist({ name: this.state.setlist.name, entries: [] }),

    updateSettings: (partial: Partial<Settings>) => this.updateSettings(partial),
    mixerGroup: (group: string, op: string, value?: number) => this.mixerGroup(String(group), String(op), value),
    setTrack: (id: string, props: { mute?: boolean; solo?: boolean; volume?: number }) =>
      this.bridge.command({ name: 'setTrack', id, ...props }),

    notify: (text: string, big = true) => this.notify(String(text), big !== false),
    clearNotification: () => this.set({ notification: null }),
    clearErrors: () => this.set({ errors: [] }),

    midiLearn: (mappingId: string) => this.set({ midiLearn: { mappingId } }),
    midiLearnCancel: () => this.set({ midiLearn: null }),

    placeSectionLocators: () => {
      const items = this.state.songs.flatMap((s) =>
        s.sections.filter((sec) => !sec.hasCue).map((sec) => ({ time: sec.start, name: sec.raw.trim().startsWith('>') ? sec.raw : `> ${sec.raw}` })),
      );
      if (this.playing) return this.notify('Stop playback to place locators', false);
      this.bridge.command({ name: 'placeLocators', items });
    },
    removeAutoLocators: () => {
      if (this.playing) return this.notify('Stop playback to remove locators', false);
      // Locators that sit exactly on a section clip with the same name were placed by the tool.
      const clips = this.state.live.tracks.filter((t) => parseTrackName(t.name).isSections).flatMap((t) => t.clips ?? []);
      const times = this.state.live.cues
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
