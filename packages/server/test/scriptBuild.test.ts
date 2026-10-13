import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scriptBuild } from '../src/scriptBuild.ts';

const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../remote-script/Setlist');

function pythonBuild(): string | null {
  // Loads build.py on its own: importing the Setlist package would need Live.
  const code = [
    'import importlib.util, sys',
    `spec = importlib.util.spec_from_file_location("b", sys.argv[1] + "/build.py")`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(m.script_build(sys.argv[1]))',
  ].join('\n');
  for (const python of ['python', 'python3']) {
    try {
      return execFileSync(python, ['-c', code, scriptDir], { encoding: 'utf8' }).trim();
    } catch {
      // try the next name
    }
  }
  return null;
}

describe('Remote Script fingerprint', () => {
  it('matches what the script computes inside Live', () => {
    const node = scriptBuild(scriptDir);
    expect(node).toMatch(/^[0-9a-f]{12}$/);
    const python = pythonBuild();
    if (python === null) return; // no Python on this machine
    expect(python).toBe(node);
  });

  it('is null for a folder without the script', () => {
    expect(scriptBuild(path.join(scriptDir, 'does-not-exist'))).toBeNull();
  });
});
