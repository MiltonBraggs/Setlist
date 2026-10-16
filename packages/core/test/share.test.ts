import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEWER_PERMISSIONS, type ViewerPermissions } from '../src/access.ts';
import type { AppState } from '../src/protocol.ts';
import { stateForRole } from '../src/share.ts';
import { DEFAULT_SETTINGS } from '../src/types.ts';
import { track } from './fixtures.ts';

const TRACKS = [
  track(0, 'Vocals +LYRICS', { clips: [] }),
  track(1, 'Harmony +LYRICS', { clips: [] }),
  track(2, 'Chords +CHORDS', { clips: [] }),
  track(3, 'Drums +NOTES', { clips: [] }),
  track(4, 'Measures', { clips: [] }),
  track(5, 'Sections', { clips: [] }),
  track(6, 'Keys +BACKING'),
  track(7, 'Click'),
];

function stateWith(viewer: Partial<ViewerPermissions> = {}): AppState {
  return {
    liveConnected: true,
    scriptVersion: '0.1.0',
    scriptOutdated: true,
    live: {} as AppState['live'],
    tracks: TRACKS,
    cues: [{ id: 'c0', name: 'Song', time: 0 }],
    songs: [],
    setlist: { id: 's', name: 'All songs', entries: [] } as unknown as AppState['setlist'],
    setlists: [{ id: 's', name: 'All songs' } as AppState['setlists'][number]],
    queued: null,
    mix: { backing: false, vocals: null },
    metronomeReturn: null,
    settings: {
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      projectFolder: 'C:\\Users\\me\\Music\\Gig',
      oscPort: 9000,
      midiMappings: [{ id: 'm', input: 'Pedal', kind: 'cc', channel: 1, number: 64, action: 'go' }],
      viewer: { ...DEFAULT_VIEWER_PERMISSIONS, ...viewer },
    },
    locked: false,
    notification: null,
    errors: ['Traceback ...'],
    urls: ['http://localhost', 'http://192.168.0.10'],
    midiInputs: ['Pedal'],
    midiLearn: null,
    plugins: [],
    access: { pinSet: true, owners: 1, viewers: 7 },
  };
}

const names = (s: AppState) => s.tracks.map((t) => t.name);

describe('stateForRole: what each device is sent', () => {
  it('sends owners everything', () => {
    const state = stateWith();
    expect(stateForRole(state, 'owner')).toBe(state);
  });

  it('never sends viewers settings, errors, addresses or MIDI they have no use for', () => {
    const v = stateForRole(stateWith(), 'viewer');
    expect(v.settings.projectFolder).toBeNull();
    expect(v.settings.midiMappings).toEqual([]);
    expect(v.settings.oscPort).toBe(DEFAULT_SETTINGS.oscPort);
    expect(v.settings.theme).toBe('dark'); // what viewers do use is kept
    expect(v.settings.viewer).toEqual(stateWith().settings.viewer);
    expect([v.errors, v.urls, v.midiInputs, v.cues, v.plugins]).toEqual([[], [], [], [], []]);
    expect([v.scriptVersion, v.scriptOutdated]).toEqual([null, false]);
  });

  it('sends only the tracks their pages read, not the audio tracks', () => {
    expect(names(stateForRole(stateWith(), 'viewer'))).toEqual(['Vocals +LYRICS', 'Harmony +LYRICS', 'Chords +CHORDS', 'Drums +NOTES', 'Measures']);
  });

  it('follows the viewer permissions', () => {
    // Only the Vocals lyrics are shared.
    expect(names(stateForRole(stateWith({ lyricsTracks: ['Vocals'] }), 'viewer'))).toEqual([
      'Vocals +LYRICS',
      'Chords +CHORDS',
      'Drums +NOTES',
      'Measures',
    ]);
    // No Lyrics page: no lyrics or chords at all.
    expect(names(stateForRole(stateWith({ pages: { performance: true, setlist: true, lyrics: false } }), 'viewer'))).toEqual([
      'Drums +NOTES',
      'Measures',
    ]);
    // The Backing / Vocals buttons' state only for viewers allowed to use them.
    expect(stateForRole(stateWith(), 'viewer').mix).toEqual({ backing: null, vocals: null });
    expect(stateForRole(stateWith({ transport: true }), 'viewer').mix).toEqual({ backing: false, vocals: null });
  });
});
