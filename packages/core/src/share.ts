/**
 * What each device is sent. Owners (and the host computer) get everything; viewers only what
 * their pages show: no MIDI / OSC settings, project folder, errors or network addresses, and only
 * the Live tracks those pages read (allowed lyrics tracks, chords, part notes, measures).
 */
import { can, canSeeLyricsTrack, canSeePage, type Role } from './access.ts';
import { parseTrackName } from './notation.ts';
import type { AppState } from './protocol.ts';
import { DEFAULT_SETTINGS } from './types.ts';

export function stateForRole(state: AppState, role: Role): AppState {
  if (role === 'owner') return state;
  const perms = state.settings.viewer;
  const lyricsPage = canSeePage('viewer', perms, 'lyrics');
  const performancePage = canSeePage('viewer', perms, 'performance');
  const parsed = state.tracks.map((t) => ({ t, p: parseTrackName(t.name) }));
  const lyricsTitles = parsed.filter(({ p }) => p.isLyrics).map(({ p }) => p.title);
  const visibleLyrics = lyricsTitles.filter((title) => canSeeLyricsTrack('viewer', perms, title));
  const tracks = parsed
    .filter(({ p }) => {
      if (p.isLyrics) return lyricsPage && canSeeLyricsTrack('viewer', perms, p.title);
      // Chords feed the visible lyrics tabs, or are their own tab when the set has no lyrics tracks.
      if (p.isChords) return lyricsPage && (lyricsTitles.length > 0 ? visibleLyrics.length > 0 : canSeeLyricsTrack('viewer', perms, p.title));
      if (p.notes) return lyricsPage || performancePage;
      if (p.isMeasures) return performancePage;
      return false;
    })
    .map(({ t }) => t);
  return {
    ...state,
    scriptVersion: null,
    scriptOutdated: false,
    tracks,
    cues: [],
    setlists: canSeePage('viewer', perms, 'setlist') ? state.setlists : [],
    mix: can('viewer', perms, 'transport') ? state.mix : { backing: null, vocals: null },
    settings: { ...DEFAULT_SETTINGS, theme: state.settings.theme, fontScale: state.settings.fontScale, viewer: perms },
    errors: [],
    urls: [],
    midiInputs: [],
    midiLearn: null,
    plugins: [],
  };
}

/** Top-level keys whose viewer copy also depends on the viewer permissions in `settings`. */
export const VIEWER_DEPENDS_ON_SETTINGS: (keyof AppState)[] = ['tracks', 'setlists', 'mix'];
