import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALL_SONGS_NAME, DEFAULT_SETTINGS, compareSetlists, normalizeViewerPermissions, type Settings, type Setlist } from '@setlist/core';

export function defaultDataDir(): string {
  if (process.env.SETLIST_DATA_DIR) return process.env.SETLIST_DATA_DIR;
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? os.homedir(), 'setlist');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'setlist');
  return path.join(os.homedir(), '.config', 'setlist');
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write (temp file + rename). Never throws: a failed save must not stop a show. */
function writeJson(file: string, value: unknown): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.error(`[storage] could not write ${file}:`, (err as Error).message);
    return false;
  }
}

export function newId(): string {
  return randomBytes(6).toString('hex');
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A setlist read from disk, or null if the file isn't one. */
function asSetlist(value: unknown): Omit<Setlist, 'id'> & { id?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<Setlist>;
  if (!Array.isArray(v.entries)) return null;
  const entries = v.entries.filter((e): e is Setlist['entries'][number] => !!e && typeof e === 'object' && typeof e.songId === 'string');
  return {
    id: typeof v.id === 'string' && ID_RE.test(v.id) ? v.id : undefined,
    name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'Untitled',
    entries,
    autoAdd: v.autoAdd === true,
    created: typeof v.created === 'number' && Number.isFinite(v.created) ? v.created : undefined,
  };
}

export interface AuthData {
  /** scrypt hash of the owner PIN; null = no PIN, every device is owner. */
  pin: { salt: string; hash: string } | null;
  /** Hashes of tokens handed to devices that entered the PIN. */
  tokens: string[];
}

interface ProjectMeta {
  songIds: string[];
  activeSetlistId?: string;
  /** Older versions stored a single "current" setlist here; migrated on load. */
  current?: Setlist | null;
}

export interface ProjectData {
  id: string;
  setlists: Setlist[];
  activeId: string | null;
}

/**
 * Live doesn't tell us which .als is open, so setlists are stored per "project",
 * identified by the overlap of song ids with what we've seen before.
 *
 *   projects/<project>/project.json        song ids + active setlist id
 *   projects/<project>/setlists/<id>.json  one file per setlist
 */
export class Storage {
  private projectId: string | null = null;
  private meta: ProjectMeta = { songIds: [] };

  constructor(readonly dataDir = defaultDataDir()) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  loadSettings(): Settings {
    const saved = readJson<Partial<Settings>>(path.join(this.dataDir, 'settings.json'), {});
    return { ...DEFAULT_SETTINGS, ...saved, viewer: normalizeViewerPermissions(saved.viewer) };
  }

  saveSettings(settings: Settings) {
    writeJson(path.join(this.dataDir, 'settings.json'), settings);
  }

  /** Owner PIN hash and remembered owner devices. Kept out of settings, which every client receives. */
  loadAuth(): AuthData {
    const saved = readJson<Partial<AuthData>>(path.join(this.dataDir, 'auth.json'), {});
    return { pin: saved.pin ?? null, tokens: Array.isArray(saved.tokens) ? saved.tokens : [] };
  }

  saveAuth(auth: AuthData) {
    writeJson(path.join(this.dataDir, 'auth.json'), auth);
  }

  private projectsDir() {
    return path.join(this.dataDir, 'projects');
  }

  private projectDir() {
    return path.join(this.projectsDir(), this.projectId ?? '_none');
  }

  private setlistsDir() {
    return path.join(this.projectDir(), 'setlists');
  }

  /** Pick (or create) the stored project that best matches the current song ids, with its setlists. */
  selectProject(songIds: string[]): ProjectData {
    const ids = new Set(songIds);
    let best: { id: string; score: number; meta: ProjectMeta } | undefined;
    if (fs.existsSync(this.projectsDir())) {
      for (const id of fs.readdirSync(this.projectsDir())) {
        const meta = readJson<ProjectMeta | null>(path.join(this.projectsDir(), id, 'project.json'), null);
        if (!meta || !Array.isArray(meta.songIds)) continue;
        const known = new Set(meta.songIds);
        const shared = songIds.filter((s) => known.has(s)).length;
        const score = shared / Math.max(1, new Set([...ids, ...known]).size);
        if (!best || score > best.score) best = { id, score, meta };
      }
    }
    if (best && best.score >= 0.5) {
      this.projectId = best.id;
      this.meta = { ...best.meta, songIds };
    } else {
      this.projectId = createHash('sha1').update(songIds.join('\n')).digest('hex').slice(0, 12);
      this.meta = { songIds };
    }
    const setlists = this.loadSetlists();
    // Migrate the single "current" setlist of older versions into "All songs".
    if (this.meta.current && Array.isArray(this.meta.current.entries)) {
      const legacy = this.meta.current;
      const migrated: Setlist = {
        id: newId(),
        name: legacy.name && legacy.name !== 'Untitled Setlist' ? legacy.name : ALL_SONGS_NAME,
        entries: legacy.entries,
        autoAdd: true,
      };
      this.saveSetlist(migrated);
      setlists.unshift(migrated);
      this.meta.activeSetlistId = migrated.id;
    }
    delete this.meta.current;
    this.writeMeta();
    return { id: this.projectId, setlists, activeId: this.meta.activeSetlistId ?? null };
  }

  private writeMeta() {
    writeJson(path.join(this.projectDir(), 'project.json'), this.meta);
  }

  private loadSetlists(): Setlist[] {
    const dir = this.setlistsDir();
    if (!fs.existsSync(dir)) return [];
    const out: Setlist[] = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const parsed = asSetlist(readJson<unknown>(path.join(dir, file), null));
      if (!parsed) continue;
      if (parsed.id && file === `${parsed.id}.json`) {
        out.push(parsed as Setlist);
        continue;
      }
      // Older name-keyed file (or a mismatched name): give it an id and store it under that id.
      const setlist: Setlist = { ...parsed, id: parsed.id && !out.some((s) => s.id === parsed.id) ? parsed.id : newId() };
      if (this.saveSetlist(setlist)) fs.rmSync(path.join(dir, file), { force: true });
      out.push(setlist);
    }
    return out.sort(compareSetlists);
  }

  saveSetlist(setlist: Setlist): boolean {
    if (!this.projectId || !ID_RE.test(setlist.id)) return false;
    return writeJson(path.join(this.setlistsDir(), `${setlist.id}.json`), setlist);
  }

  deleteSetlist(id: string) {
    if (!this.projectId || !ID_RE.test(id)) return;
    try {
      fs.rmSync(path.join(this.setlistsDir(), `${id}.json`), { force: true });
    } catch (err) {
      console.error('[storage] could not delete setlist:', (err as Error).message);
    }
  }

  setActiveSetlist(id: string) {
    if (!this.projectId || this.meta.activeSetlistId === id) return;
    this.meta.activeSetlistId = id;
    this.writeMeta();
  }
}
