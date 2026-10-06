import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, clipboard, dialog, Menu, nativeImage, shell, Tray } from 'electron';
import { defaultDataDir, startServer, type RunningServer } from '@setlist/server';

let tray: Tray | null = null;
let server: RunningServer | null = null;

/** Bundled resources live next to the app when packaged, in the repo during development. */
function resource(...parts: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../..');
  return path.join(base, ...parts);
}

function remoteScriptsDir(): string {
  const home = os.homedir();
  return process.platform === 'darwin'
    ? path.join(home, 'Music', 'Ableton', 'User Library', 'Remote Scripts')
    : path.join(home, 'Documents', 'Ableton', 'User Library', 'Remote Scripts');
}

function copyDir(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

async function installRemoteScript() {
  const source = resource(app.isPackaged ? 'remote-script' : path.join('remote-script', 'Setlist'));
  let target = path.join(remoteScriptsDir(), 'Setlist');
  if (!fs.existsSync(path.dirname(target))) {
    const res = await dialog.showOpenDialog({
      title: 'Select your Ableton "User Library/Remote Scripts" folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return;
    target = path.join(res.filePaths[0], 'Setlist');
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
    copyDir(source, target);
    await dialog.showMessageBox({
      type: 'info',
      message: 'Setlist Remote Script installed',
      detail: `Installed to:\n${target}\n\nRestart Live, then open Preferences → Link, Tempo & MIDI and choose "Setlist" as a Control Surface (Input/Output: None).`,
    });
  } catch (err) {
    dialog.showErrorBox('Install failed', String(err));
  }
}

function refreshMenu() {
  if (!tray || !server) return;
  const state = server.app.state;
  const lanUrl = server.urls.find((u) => !u.includes('localhost')) ?? server.urls[0];
  tray.setToolTip(`Setlist — ${state.liveConnected ? 'connected to Live' : 'waiting for Live'}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: state.liveConnected ? '● Connected to Ableton Live' : '○ Waiting for Ableton Live…', enabled: false },
      { label: `${state.songs.length} songs · ${state.setlist.name}`, enabled: false },
      { type: 'separator' },
      { label: 'Open Setlist', click: () => shell.openExternal(server!.urls[0]) },
      {
        label: 'Network addresses',
        submenu: server.urls.map((u) => ({ label: `Copy ${u}`, click: () => clipboard.writeText(u) })),
      },
      { label: `Copy ${lanUrl}`, click: () => clipboard.writeText(lanUrl) },
      { type: 'separator' },
      { label: 'Install Remote Script into Live…', click: () => void installRemoteScript() },
      { label: 'Open Data Folder', click: () => shell.openPath(defaultDataDir()) },
      { type: 'separator' },
      { label: 'Quit Setlist', click: () => app.quit() },
    ]),
  );
}

app.on('window-all-closed', () => {
  /* tray app: keep running */
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => server && shell.openExternal(server.urls[0]));
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide();
    try {
      server = await startServer({ webDist: resource(app.isPackaged ? 'web' : path.join('packages', 'web', 'dist')) });
    } catch (err) {
      dialog.showErrorBox('Setlist could not start', String(err));
      app.quit();
      return;
    }
    tray = new Tray(nativeImage.createFromPath(resource(app.isPackaged ? 'icon.png' : path.join('apps', 'desktop', 'icon.png'))));
    refreshMenu();
    server.app.on('patch', (p) => {
      if ('liveConnected' in p || 'songs' in p || 'setlist' in p) refreshMenu();
    });
  });
  app.on('before-quit', () => void server?.close());
}
