import type { LiveCue, LiveSnapshot, LiveTrack } from '../src/types.ts';

export function cues(list: [number, string][]): LiveCue[] {
  return list.map(([time, name], i) => ({ id: `c${i}`, time, name }));
}

export function snapshot(cueList: [number, string][], tracks: LiveTrack[] = [], extra: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    isPlaying: false,
    recordMode: false,
    time: 0,
    tempo: 120,
    sigNum: 4,
    sigDen: 4,
    loop: { on: false, start: 0, length: 16 },
    quantization: 4,
    songLength: 512,
    cues: cues(cueList),
    tracks,
    ...extra,
  };
}

export function track(index: number, name: string, extra: Partial<LiveTrack> = {}): LiveTrack {
  return { id: `t${index}`, index, name, color: 0x888888, mute: false, solo: false, volume: 0.85, isGroup: false, ...extra };
}

/** Three-song demo set used across tests (120 bpm, 4/4). */
export const DEMO = snapshot([
  [0, 'Opener {Capo 2} [red]'],
  [0, '> Intro'],
  [16, '> Verse'],
  [48, '> Chorus +LOOP:2'],
  [64, '> Outro +END'],
  [80, 'SONG END'],
  [96, 'Ballad #slow'],
  [96, '> Intro >>> Chorus'],
  [112, '> Verse'],
  [128, '> Chorus'],
  [160, 'STOP'],
  [176, '. Closer [5:00]'],
  [176, '> Main'],
  [208, '> Solo +SKIP'],
  [224, '> End'],
  [240, 'SONG END'],
]);
