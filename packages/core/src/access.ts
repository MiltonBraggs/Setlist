/**
 * Owner / viewer access. The owner (host computer, or any device that entered the owner PIN)
 * can do everything. Viewers (bandmates) get one shared profile the owner configures.
 * Shared by server (enforcement) and UI (what to show).
 */

export type Role = 'owner' | 'viewer';

export type ViewerPage = 'performance' | 'setlist' | 'lyrics' | 'mixer';
export type PageId = ViewerPage | 'settings';

export interface ViewerPermissions {
  /** Pages viewers can open. Settings is always owner-only. */
  pages: Record<ViewerPage, boolean>;
  /** Play, pause, stop, GO, record. */
  transport: boolean;
  /** Jump to songs / sections / bars, queue and cancel jumps, loop. */
  navigate: boolean;
  /** Reorder, add, remove, save and load setlists. */
  editSetlist: boolean;
  /** Change mixer group mute / solo / volume. */
  mixer: boolean;
  /** Lyrics track titles viewers may open; null = all. */
  lyricsTracks: string[] | null;
}

export const DEFAULT_VIEWER_PERMISSIONS: ViewerPermissions = {
  pages: { performance: true, setlist: true, lyrics: true, mixer: false },
  transport: false,
  navigate: false,
  editSetlist: false,
  mixer: false,
  lyricsTracks: null,
};

/** Fill in missing keys of a stored profile (older settings files). */
export function normalizeViewerPermissions(p: Partial<ViewerPermissions> | undefined): ViewerPermissions {
  return {
    ...DEFAULT_VIEWER_PERMISSIONS,
    ...p,
    pages: { ...DEFAULT_VIEWER_PERMISSIONS.pages, ...p?.pages },
    lyricsTracks: Array.isArray(p?.lyricsTracks) ? p.lyricsTracks : null,
  };
}

export type Capability = 'any' | 'transport' | 'navigate' | 'editSetlist' | 'mixer' | 'owner';

/** What each action needs. Actions not listed are owner-only. */
export const ACTION_CAPABILITY: Record<string, Capability> = {
  clearNotification: 'any',

  play: 'transport',
  pause: 'transport',
  stop: 'transport',
  playPause: 'transport',
  playStop: 'transport',
  go: 'transport',
  toggleRecord: 'transport',

  jumpBySongs: 'navigate',
  nextSong: 'navigate',
  prevSong: 'navigate',
  jumpBySections: 'navigate',
  nextSection: 'navigate',
  prevSection: 'navigate',
  jumpToSong: 'navigate',
  jumpToSection: 'navigate',
  jumpByMeasures: 'navigate',
  jumpToTime: 'navigate',
  jumpQueued: 'navigate',
  jumpQueuedNow: 'navigate',
  cancelQueue: 'navigate',
  toggleLoop: 'navigate',
  escapeLoop: 'navigate',
  enableLoop: 'navigate',

  setSetlist: 'editSetlist',
  renameSetlist: 'editSetlist',
  saveSetlist: 'editSetlist',
  loadSetlist: 'editSetlist',
  deleteSetlist: 'editSetlist',
  importSetlistText: 'editSetlist',
  resetSetlist: 'editSetlist',

  mixerGroup: 'mixer',
};

export function can(role: Role, perms: ViewerPermissions, capability: Capability): boolean {
  if (role === 'owner' || capability === 'any') return true;
  if (capability === 'owner') return false;
  return perms[capability];
}

export function canDispatch(role: Role, perms: ViewerPermissions, action: string): boolean {
  return can(role, perms, ACTION_CAPABILITY[action] ?? 'owner');
}

export function canSeePage(role: Role, perms: ViewerPermissions, page: PageId): boolean {
  if (role === 'owner') return true;
  if (page === 'settings') return false;
  return perms.pages[page];
}

export function canSeeLyricsTrack(role: Role, perms: ViewerPermissions, trackTitle: string): boolean {
  if (role === 'owner' || perms.lyricsTracks === null) return true;
  return perms.lyricsTracks.includes(trackTitle);
}
