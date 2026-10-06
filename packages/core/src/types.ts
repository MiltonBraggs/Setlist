/** All arrangement times are in beats (quarter notes), as reported by Live. */
export type Beats = number;

export interface LiveCue {
  id: string;
  name: string;
  time: Beats;
}

export interface LiveClip {
  id: string;
  name: string;
  start: Beats;
  end: Beats;
  /** 0xRRGGBB */
  color: number;
}

export interface LiveTrack {
  /** Index-based id ("t3"); Live has no stable track ids. */
  id: string;
  index: number;
  name: string;
  /** 0xRRGGBB */
  color: number;
  mute: boolean;
  solo: boolean;
  /** Live mixer volume parameter, 0..1 (0.85 ≈ 0 dB). */
  volume: number;
  isGroup: boolean;
  /** Arrangement clips; only reported for +SECTIONS, +LYRICS and Measures tracks. */
  clips?: LiveClip[];
}

export interface LiveLoop {
  on: boolean;
  start: Beats;
  length: Beats;
}

export interface LiveSnapshot {
  isPlaying: boolean;
  recordMode: boolean;
  time: Beats;
  tempo: number;
  sigNum: number;
  sigDen: number;
  loop: LiveLoop;
  /** Live global quantization enum value. */
  quantization: number;
  /** End of the last event in the arrangement. */
  songLength: Beats;
  cues: LiveCue[];
  tracks: LiveTrack[];
}

export type JumpMode = 'quantized' | 'endOfSection' | 'endOfSong' | 'dynamic' | 'manual';

export interface Settings {
  jumpMode: JumpMode;
  autojumpNextSong: boolean;
  countInBars: 0 | 1 | 2 | 4;
  countInSoloClick: boolean;
  theme: 'dark' | 'light';
  fontScale: number;
  oscPort: number;
  /** Optional folder for setlists and lyrics images (Live doesn't expose the .als path). */
  projectFolder: string | null;
  midiMappings: MidiMapping[];
}

export type MidiMessageKind = 'note' | 'cc' | 'pc';

export interface MidiMapping {
  id: string;
  input: string;
  kind: MidiMessageKind;
  channel: number;
  /** Note number, CC number or program number. */
  number: number;
  /** Named action (see ACTIONS) or 'osc' for a custom OSC string. */
  action: string;
  /** For action === 'osc': `/global/stop; //sleep 500; /setlist/jumpBySongs 1` */
  osc?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  jumpMode: 'dynamic',
  autojumpNextSong: true,
  countInBars: 0,
  countInSoloClick: true,
  theme: 'dark',
  fontScale: 1,
  oscPort: 39051,
  projectFolder: null,
  midiMappings: [],
};
