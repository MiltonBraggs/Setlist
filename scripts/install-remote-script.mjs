// Copies remote-script/Setlist into Ableton Live's User Library → Remote Scripts.
//
//   npm run install-script                              finds the User Library
//   npm run install-script -- "D:\Music\User Library"   or give it yourself
//
// Restart Live afterwards: it only loads Remote Scripts at startup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repo, 'remote-script', 'Setlist');
const home = os.homedir();

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** User Library paths from Live's own preferences (covers a library moved to another drive). */
function fromLivePreferences() {
  const prefRoots =
    process.platform === 'win32'
      ? [path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Ableton')]
      : [path.join(home, 'Library', 'Preferences', 'Ableton')];
  const found = [];
  for (const root of prefRoots) {
    if (!isDir(root)) continue;
    for (const live of fs.readdirSync(root).filter((n) => n.startsWith('Live '))) {
      for (const cfg of [path.join(root, live, 'Preferences', 'Library.cfg'), path.join(root, live, 'Library.cfg')]) {
        let xml;
        try {
          xml = fs.readFileSync(cfg, 'utf8');
        } catch {
          continue;
        }
        const block = /<UserLibrary>([\s\S]*?)<\/UserLibrary>/.exec(xml)?.[1] ?? '';
        const dir = /<ProjectPath Value="([^"]*)"/.exec(block)?.[1];
        const name = /<ProjectName Value="([^"]*)"/.exec(block)?.[1] ?? 'User Library';
        if (!dir) continue;
        found.push(path.basename(dir.replace(/[\\/]+$/, '')) === name ? dir : path.join(dir, name));
      }
    }
  }
  return found;
}

function defaultLibraries() {
  if (process.platform === 'darwin') return [path.join(home, 'Music', 'Ableton', 'User Library')];
  // Windows: Documents, or Documents redirected into OneDrive ("OneDrive", "OneDrive - Company").
  const docs = [path.join(home, 'Documents')];
  for (const n of fs.readdirSync(home)) if (n.startsWith('OneDrive')) docs.push(path.join(home, n, 'Documents'));
  return docs.map((d) => path.join(d, 'Ableton', 'User Library'));
}

const given = process.argv[2];
const candidates = given ? [given] : [...fromLivePreferences(), ...defaultLibraries()];
const libraries = [...new Set(candidates.map((p) => path.resolve(p)))].filter(isDir);

if (libraries.length === 0) {
  console.error(given ? `Not a folder: ${given}` : 'Could not find Ableton Live\'s User Library.');
  console.error('Find it in Live under Preferences → Library, then run:');
  console.error('  npm run install-script -- "<path to your User Library>"');
  process.exit(1);
}

for (const library of libraries) {
  const target = path.join(library, 'Remote Scripts', 'Setlist');
  fs.rmSync(target, { recursive: true, force: true }); // drop old files and stale __pycache__
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source).filter((n) => n.endsWith('.py'))) {
    fs.copyFileSync(path.join(source, name), path.join(target, name));
  }
  console.log(`Installed the Setlist Remote Script to ${target}`);
}
console.log('Now restart Ableton Live (Remote Scripts load at startup).');
