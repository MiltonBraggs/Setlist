import type { PlaybackPlan } from './plan.ts';
import type { Setlist } from './setlist.ts';
import type { Song } from './songs.ts';
import type { Beats, LiveSnapshot, Settings } from './types.ts';

// ---------------------------------------------------------------------------
// Remote Script <-> server (UDP, one JSON object per datagram)

export const SCRIPT_PORT = 39100; // script listens
export const SERVER_PORT = 39101; // server listens

export type ScriptToServer =
  | { type: 'hello'; version: string }
  | { type: 'snapshot'; state: LiveSnapshot }
  | { type: 'patch'; state: Partial<LiveSnapshot> }
  | { type: 'time'; time: Beats; playing: boolean }
  | { type: 'meters'; levels: [id: string, left: number, right: number][] }
  | { type: 'fired'; event: 'stop' | 'jump' | 'loopEnd' | 'queued'; at: Beats }
  | { type: 'pong' }
  | { type: 'log'; level: 'info' | 'error'; message: string };

export type ScriptCommand =
  | { name: 'play' }
  | { name: 'continue' }
  | { name: 'stop' }
  | { name: 'pause' }
  | { name: 'toggleRecord' }
  /** quantized: cue.jump() (Live global quantization); otherwise immediate. */
  | { name: 'jump'; to: Beats; quantized: boolean }
  /** Jump exactly at `at` (song/section boundary). */
  | { name: 'queue'; at: Beats; to: Beats }
  | { name: 'cancelQueue' }
  | { name: 'setLoop'; on: boolean; start?: Beats; length?: Beats; count?: number | null }
  | { name: 'setTrack'; id: string; mute?: boolean; solo?: boolean; volume?: number }
  | { name: 'setMeters'; enabled: boolean }
  /** Solo click tracks and start `bars` before `from`; unsolo on the downbeat. */
  | { name: 'countIn'; from: Beats; bars: number; clickTrackIds: string[] }
  | { name: 'placeLocators'; items: { time: Beats; name: string }[] }
  | { name: 'removeLocators'; times: Beats[] };

export type ServerToScript =
  | { type: 'ping' }
  | { type: 'getSnapshot' }
  | { type: 'cmd'; cmd: ScriptCommand }
  | { type: 'plan'; plan: PlaybackPlan };

// ---------------------------------------------------------------------------
// "Setlist Sync" VST3 plugin <-> server (UDP, one JSON object per datagram)

export const PLUGIN_PORT = 39102; // server listens; plugins send from an ephemeral port

export type PluginToServer =
  /** Sent every second as a heartbeat. `track` is the Live track the plugin sits on, if known. */
  | { type: 'hello'; id: string; version: string; track?: string }
  /** Sample-accurate playhead, ~60/s. */
  | { type: 'time'; id: string; time: Beats; playing: boolean; tempo: number }
  /** The plugin started silencing at a stop point. */
  | { type: 'gated'; id: string; at: Beats };

export type ServerToPlugin =
  /** Arrangement positions (beats) where audio must be silenced (STOP / +PAUSE). */
  { type: 'gates'; points: Beats[] };

export interface PluginInstance {
  id: string;
  track: string | null;
  version: string;
}

// ---------------------------------------------------------------------------
// Server <-> browser (WebSocket)

export interface QueuedJump {
  kind: 'song' | 'section';
  songId: string;
  sectionId?: string;
  to: Beats;
  /** Boundary at which it executes; null = quantized / held. */
  at: Beats | null;
  hold: boolean;
}

export interface Notification {
  id: number;
  text: string;
  big: boolean;
}

export interface AppState {
  liveConnected: boolean;
  scriptVersion: string | null;
  live: Omit<LiveSnapshot, 'time' | 'isPlaying'>;
  /** Songs in arrangement order. */
  songs: Song[];
  setlist: Setlist;
  savedSetlists: string[];
  queued: QueuedJump | null;
  settings: Settings;
  /** Device-wide lock: disables controls on all clients. */
  locked: boolean;
  notification: Notification | null;
  errors: string[];
  urls: string[];
  midiInputs: string[];
  midiLearn: { mappingId: string } | null;
  /** Connected "Setlist Sync" plugin instances. */
  plugins: PluginInstance[];
}

export type ServerToClient =
  | { type: 'state'; state: AppState }
  /** Top-level keys that changed. */
  | { type: 'patch'; state: Partial<AppState> }
  | { type: 'time'; time: Beats; playing: boolean }
  | { type: 'meters'; levels: [string, number, number][] };

export type ClientToServer =
  | { type: 'action'; action: string; args?: unknown[] }
  | { type: 'meters'; enabled: boolean };
