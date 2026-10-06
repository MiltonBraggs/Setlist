/**
 * Parser for AbleSet-style locator / clip / track name notation.
 *
 *   Song Title {description} [3:20] [blue] [.class] #tag [nosong]
 *   . Song Title              -> stop playback before this song
 *   > Section  /  >> Section  -> section / quick-access section
 *   > Intro >>> Verse 1       -> auto-jump to "Verse 1" when Intro ends
 *   > Chorus +LOOP:4 [c:1.2:nl]
 *   SONG END  /  STOP +JUMP  /  * ignored
 */

export const COLOR_NAMES = [
  'gray', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const COLOR_HEX: Record<ColorName, string> = {
  gray: '#6b7280', red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4',
  sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7',
  fuchsia: '#d946ef', pink: '#ec4899', rose: '#f43f5e',
};

export function resolveColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (color.startsWith('#')) return color;
  return COLOR_HEX[color as ColorName];
}

export interface CountInOptions {
  /** 0 disables the count-in for this section. */
  bars?: number;
  /** Beat on which the section name is announced (`[c:2.3]`). */
  announceBeat?: number;
  beats?: boolean;
  loop?: boolean;
  halftime?: boolean;
  halfspeed?: boolean;
  backwards?: boolean;
  finish?: boolean;
}

export type LocatorKind = 'ignore' | 'song' | 'section' | 'songEnd' | 'stop' | 'jump';

export interface StopFlag {
  /** +JUMP / +STAY override of the "autojump to next song" setting. */
  then: 'jump' | 'stay' | 'default';
}

export interface LoopFlag {
  full: boolean;
  /** `+LOOP:4` -> loop 4 times then continue. */
  count: number | null;
}

export interface LocatorFlags {
  stop?: StopFlag;
  pause?: boolean;
  skip?: boolean;
  loop?: LoopFlag;
  end?: boolean;
}

export interface ParsedLocator {
  raw: string;
  kind: LocatorKind;
  title: string;
  /** `>>` sections */
  quickAccess: boolean;
  /** `.` prefix on a song: stop before it. */
  stopBefore: boolean;
  /** `>>> Target` */
  jumpTarget?: string;
  description?: string;
  /** seconds */
  duration?: number;
  color?: string;
  classes: string[];
  tags: string[];
  noSong: boolean;
  flags: LocatorFlags;
  countIn?: CountInOptions;
  /** `[+2]` / `[-1]` / `[+2b]` */
  transpose?: { semitones: number; flats: boolean };
  /** Bracket attributes we didn't interpret (lyrics options etc.). */
  attrs: string[];
  /** Flags we didn't interpret (kept for track flags etc.). */
  extraFlags: string[];
}

const DURATION_RE = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/;
const TRANSPOSE_RE = /^([+-]\d{1,2})(b?)$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function parseDuration(text: string): number | undefined {
  const m = DURATION_RE.exec(text.trim());
  if (!m) return undefined;
  const parts = [m[1], m[2], m[3]].filter((p) => p !== undefined).map(Number);
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

const COUNT_IN_ALIASES: Record<string, [keyof CountInOptions, boolean]> = {
  beats: ['beats', true], b: ['beats', true],
  nobeats: ['beats', false], nb: ['beats', false],
  loop: ['loop', true], l: ['loop', true],
  noloop: ['loop', false], nl: ['loop', false],
  halftime: ['halftime', true], ht: ['halftime', true],
  halfspeed: ['halfspeed', true], hs: ['halfspeed', true],
  backwards: ['backwards', true], bw: ['backwards', true],
  forwards: ['backwards', false], fw: ['backwards', false],
  finish: ['finish', true], f: ['finish', true],
  nofinish: ['finish', false], nf: ['finish', false],
};

export function parseCountIn(spec: string): CountInOptions {
  const out: CountInOptions = {};
  for (const token of spec.split(':').map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    const num = /^(\d+)(?:\.(\d+))?$/.exec(token);
    if (num) {
      out.bars = Number(num[1]);
      if (num[2]) out.announceBeat = Number(num[2]);
      continue;
    }
    const alias = COUNT_IN_ALIASES[token];
    if (alias) (out as Record<string, unknown>)[alias[0]] = alias[1];
  }
  return out;
}

interface Extracted {
  rest: string;
  brackets: string[];
  description?: string;
  flags: string[];
  tags: string[];
}

/** Pull `{...}`, `[...]`, `+FLAG` and `#tag` tokens out of a name. */
export function extractTokens(name: string): Extracted {
  const brackets: string[] = [];
  let description: string | undefined;
  let rest = name.replace(/\[([^\]]*)\]/g, (_, inner: string) => {
    brackets.push(inner.trim());
    return ' ';
  });
  rest = rest.replace(/\{([^}]*)\}/g, (_, inner: string) => {
    description = description ? `${description} ${inner.trim()}` : inner.trim();
    return ' ';
  });
  const flags: string[] = [];
  rest = rest.replace(/(^|\s)\+([A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z0-9_.-]+)?)(?=\s|$)/g, (_, pre: string, flag: string) => {
    flags.push(flag);
    return pre;
  });
  const tags: string[] = [];
  rest = rest.replace(/(^|\s)#([\p{L}\p{N}_-]+)(?=\s|$)/gu, (_, pre: string, tag: string) => {
    tags.push(tag);
    return pre;
  });
  return { rest: rest.replace(/\s+/g, ' ').trim(), brackets, description, flags, tags };
}

export function parseLocator(raw: string): ParsedLocator {
  const result: ParsedLocator = {
    raw,
    kind: 'song',
    title: '',
    quickAccess: false,
    stopBefore: false,
    classes: [],
    tags: [],
    noSong: false,
    flags: {},
    attrs: [],
    extraFlags: [],
  };

  let text = raw.trim();
  if (text.startsWith('*')) {
    result.kind = 'ignore';
    result.title = text.slice(1).trim();
    return result;
  }

  if (text.startsWith('>>>')) {
    result.kind = 'jump';
    text = text.slice(3).trim();
  } else if (text.startsWith('>>')) {
    result.kind = 'section';
    result.quickAccess = true;
    text = text.slice(2).trim();
  } else if (text.startsWith('>')) {
    result.kind = 'section';
    text = text.slice(1).trim();
  } else if (text.startsWith('.')) {
    result.stopBefore = true;
    text = text.slice(1).trim();
  }

  const { rest, brackets, description, flags, tags } = extractTokens(text);
  result.description = description;
  result.tags = tags;

  for (const b of brackets) {
    const lower = b.toLowerCase();
    const duration = parseDuration(b);
    const transpose = TRANSPOSE_RE.exec(b);
    if (duration !== undefined) result.duration = duration;
    else if (lower === 'nosong') result.noSong = true;
    else if (b.startsWith('.')) result.classes.push(b.slice(1));
    else if (lower.startsWith('c:')) result.countIn = parseCountIn(b.slice(2));
    else if ((COLOR_NAMES as readonly string[]).includes(lower) || HEX_RE.test(b)) result.color = lower;
    else if (transpose) result.transpose = { semitones: Number(transpose[1]), flats: transpose[2] === 'b' };
    else result.attrs.push(b);
  }

  let stopThen: StopFlag['then'] = 'default';
  for (const flag of flags) {
    const [nameRaw, value] = flag.split(':');
    const name = nameRaw.toUpperCase();
    switch (name) {
      case 'STOP':
      case 'AUTOSTOP':
        result.flags.stop = { then: 'default' };
        break;
      case 'JUMP':
      case 'STAY':
        stopThen = name === 'JUMP' ? 'jump' : 'stay';
        break;
      case 'PAUSE':
        result.flags.pause = true;
        break;
      case 'SKIP':
        result.flags.skip = true;
        break;
      case 'END':
        result.flags.end = true;
        break;
      case 'LOOP':
      case 'LOOPFULL': {
        const count = value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
        result.flags.loop = { full: name === 'LOOPFULL', count };
        break;
      }
      default:
        result.extraFlags.push(flag);
    }
  }
  let title = rest;
  if (result.kind !== 'jump') {
    const jumpIdx = title.indexOf('>>>');
    if (jumpIdx >= 0) {
      result.jumpTarget = title.slice(jumpIdx + 3).trim();
      title = title.slice(0, jumpIdx).trim();
    }
  } else {
    result.jumpTarget = title;
  }
  result.title = title;

  if (result.kind === 'song') {
    const upper = title.toUpperCase();
    if (upper === 'SONG END') result.kind = 'songEnd';
    else if (upper === 'STOP' || upper === 'AUTOSTOP') {
      result.kind = 'stop';
      result.flags.stop = { then: 'default' };
    }
  }
  if (result.flags.stop) result.flags.stop.then = stopThen;
  return result;
}

// ---------------------------------------------------------------------------
// Track names

export interface ParsedTrack {
  title: string;
  isSections: boolean;
  isLyrics: boolean;
  isMeasures: boolean;
  isClick: boolean;
  guide: boolean;
  loopGuide: boolean;
  jumpGuide: boolean;
  neverMute: boolean;
  groups: string[];
  /** Bracket attributes (lyrics display options, colors, transpose...). */
  attrs: string[];
  color?: string;
  transpose?: { semitones: number; flats: boolean };
}

const GROUP_NAME_RE = /^[A-Z0-9_-]+$/;

export function parseTrackName(raw: string): ParsedTrack {
  const { rest, brackets, flags } = extractTokens(raw);
  const upperFlags = flags.map((f) => f.toUpperCase());
  const groups: string[] = [];
  for (const f of flags) {
    const m = /^(?:G|GROUP):(.+)$/i.exec(f);
    if (m && GROUP_NAME_RE.test(m[1])) groups.push(m[1]);
  }
  const attrs: string[] = [];
  let color: string | undefined;
  let transpose: ParsedTrack['transpose'];
  for (const b of brackets) {
    const lower = b.toLowerCase();
    const t = TRANSPOSE_RE.exec(b);
    if ((COLOR_NAMES as readonly string[]).includes(lower) || HEX_RE.test(b)) color = lower;
    else if (t) transpose = { semitones: Number(t[1]), flats: t[2] === 'b' };
    else attrs.push(b);
  }
  const lowerTitle = rest.toLowerCase();
  return {
    title: rest,
    isSections: upperFlags.includes('SECTIONS') || lowerTitle === 'sections',
    isLyrics: upperFlags.includes('LYRICS'),
    isMeasures: lowerTitle === 'measures' || upperFlags.includes('MEASURES'),
    isClick: upperFlags.includes('CLICK') || lowerTitle === 'click',
    guide: upperFlags.includes('GUIDE'),
    loopGuide: upperFlags.includes('LOOPGUIDE'),
    jumpGuide: upperFlags.includes('JUMPGUIDE'),
    neverMute: upperFlags.includes('NEVERMUTE') || upperFlags.includes('NM'),
    groups,
    attrs,
    color,
    transpose,
  };
}

/** `GIT_1` -> `Git 1` */
export function groupDisplayName(group: string): string {
  return group
    .split('_')
    .map((w) => (w ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ');
}
