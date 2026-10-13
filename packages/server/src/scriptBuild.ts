import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Fingerprint of the Remote Script's files: the same value remote-script/Setlist/build.py
 * computes inside Live. A mismatch means Live runs an old copy of the script.
 */
export function scriptBuild(dir: string): string | null {
  try {
    const digest = createHash('sha1');
    const names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.py'))
      .sort();
    for (const name of names) {
      const data = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n');
      digest.update(`${name}\n${data}\n`, 'utf8');
    }
    return names.length ? digest.digest('hex').slice(0, 12) : null;
  } catch {
    return null;
  }
}
