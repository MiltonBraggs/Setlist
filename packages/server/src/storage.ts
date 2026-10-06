import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, type Settings, type Setlist } from '@setlist/core';

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

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Untitled';
}

interface ProjectMeta {
  songIds: string[];
  current: Setlist | null;
}

/**
 * Live doesn't tell us which .als is open, so setlists are stored per "project",
 * identified by the overlap of song ids with what we've seen before.
 */
export class Storage {
  private projectId: string | null = null;

  constructor(readonly dataDir = defaultDataDir()) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  loadSettings(): Settings {
    return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(path.join(this.dataDir, 'settings.json'), {}) };
  }

  saveSettings(settings: Settings) {
    writeJson(path.join(this.dataDir, 'settings.json'), settings);
  }

  private projectsDir() {
    return path.join(this.dataDir, 'projects');
  }

  private projectDir() {
    return path.join(this.projectsDir(), this.projectId ?? '_none');
  }

  /** Pick (or create) the stored project that best matches the current song ids. */
  selectProject(songIds: string[]): { id: string; current: Setlist | null } {
    const ids = new Set(songIds);
    let best: { id: string; score: number; meta: ProjectMeta } | undefined;
    if (fs.existsSync(this.projectsDir())) {
      for (const id of fs.readdirSync(this.projectsDir())) {
        const meta = readJson<ProjectMeta | null>(path.join(this.projectsDir(), id, 'project.json'), null);
        if (!meta) continue;
        const known = new Set(meta.songIds);
        const shared = songIds.filter((s) => known.has(s)).length;
        const score = shared / new Set([...ids, ...known]).size;
        if (!best || score > best.score) best = { id, score, meta };
      }
    }
    if (best && best.score >= 0.5) {
      this.projectId = best.id;
      this.writeMeta({ ...best.meta, songIds });
      return { id: best.id, current: best.meta.current };
    }
    this.projectId = createHash('sha1').update(songIds.join('\n')).digest('hex').slice(0, 12);
    this.writeMeta({ songIds, current: null });
    return { id: this.projectId, current: null };
  }

  private writeMeta(meta: ProjectMeta) {
    writeJson(path.join(this.projectDir(), 'project.json'), meta);
  }

  saveCurrent(setlist: Setlist, songIds: string[]) {
    if (!this.projectId) return;
    this.writeMeta({ songIds, current: setlist });
  }

  listSetlists(): string[] {
    const dir = path.join(this.projectDir(), 'setlists');
    if (!this.projectId || !fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort((a, b) => a.localeCompare(b));
  }

  saveSetlist(setlist: Setlist) {
    writeJson(path.join(this.projectDir(), 'setlists', `${safeName(setlist.name)}.json`), setlist);
  }

  loadSetlist(name: string): Setlist | null {
    return readJson<Setlist | null>(path.join(this.projectDir(), 'setlists', `${safeName(name)}.json`), null);
  }

  deleteSetlist(name: string) {
    fs.rmSync(path.join(this.projectDir(), 'setlists', `${safeName(name)}.json`), { force: true });
  }
}
