import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { Bonjour } from 'bonjour-service';
import Fastify from 'fastify';
import { canDispatch, setlistToText, type ClientToServer, type Role, type ServerToClient, type Session } from '@setlist/core';
import { AccessControl, isLocalAddress } from './access.ts';
import { SetlistApp } from './app.ts';
import { LiveBridge } from './bridge.ts';
import { MidiService } from './midi.ts';
import { OscService } from './osc.ts';
import { PluginHub } from './plugins.ts';
import { Storage } from './storage.ts';

export { SetlistApp } from './app.ts';
export { LiveBridge } from './bridge.ts';
export { Storage, defaultDataDir } from './storage.ts';

export interface ServerOptions {
  /** Ports to try in order (default: 80, then 3000-3010). */
  ports?: number[];
  dataDir?: string;
  /** Built web UI to serve (packages/web/dist). */
  webDist?: string | null;
  mdns?: boolean;
}

export interface RunningServer {
  app: SetlistApp;
  port: number;
  urls: string[];
  close(): Promise<void>;
}

function lanUrls(port: number): string[] {
  const suffix = port === 80 ? '' : `:${port}`;
  const urls: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}${suffix}`);
    }
  }
  return [`http://localhost${suffix}`, ...urls];
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const storage = new Storage(options.dataDir);
  const bridge = new LiveBridge();
  const app = new SetlistApp(bridge, storage);
  const oscService = new OscService(app, app.state.settings.oscPort);
  app.oscExec = (text) => void oscService.exec(text);
  const midi = new MidiService(
    (ev) => app.handleMidi(ev),
    (names) => app.setMidiInputs(names),
  );

  const fastify = Fastify({ logger: false });
  // Client messages are small; refuse anything big.
  await fastify.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });

  const access = new AccessControl(storage);

  interface Client {
    send: (data: string) => void;
    /** For playhead frames: skipped while the device is behind (slow Wi-Fi), the next one supersedes it. */
    sendDroppable: (data: string) => void;
    meters: boolean;
    /** The host computer is always owner, so you can't lock yourself out. */
    local: boolean;
    address: string;
    token?: string;
    role: Role;
  }
  const clients = new Set<Client>();

  const roleOf = (c: Client): Role => (c.local || !access.pinSet || access.isOwnerToken(c.token) ? 'owner' : 'viewer');
  const sendSession = (c: Client, extra: Omit<Session, 'role'> = {}) => {
    c.role = roleOf(c);
    c.send(JSON.stringify({ type: 'session', session: { role: c.role, ...extra } } satisfies ServerToClient));
  };
  const refreshAccess = () => {
    let owners = 0;
    for (const c of clients) if (c.role === 'owner') owners++;
    app.setAccess({ pinSet: access.pinSet, owners, viewers: clients.size - owners });
  };
  refreshAccess();

  const broadcast = (msg: ServerToClient) => {
    const data = JSON.stringify(msg);
    for (const c of clients) c.send(data);
  };

  // OSC subscribers get playhead-driven values (progress, remaining) at most ~15 times a second.
  let lastOscPublish = 0;
  const publishOsc = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastOscPublish < 66) return;
    lastOscPublish = now;
    try {
      oscService.publish(app.state, app.time, app.playing);
    } catch (err) {
      console.error('[osc] publish failed', err);
    }
  };

  // Coalesce state patches per event-loop turn.
  let pending: Record<string, unknown> | null = null;
  app.on('patch', (partial) => {
    if (!pending) {
      pending = {};
      setImmediate(() => {
        const state = pending!;
        pending = null;
        broadcast({ type: 'patch', state });
        publishOsc(true);
      });
    }
    Object.assign(pending, partial);
  });
  app.on('time', (time, playing) => {
    const data = JSON.stringify({ type: 'time', time, playing } satisfies ServerToClient);
    for (const c of clients) c.sendDroppable(data);
    publishOsc(false);
  });
  app.on('mixer', (tracks) => broadcast({ type: 'mixer', tracks }));
  app.on('meters', (levels) => {
    const data = JSON.stringify({ type: 'meters', levels } satisfies ServerToClient);
    for (const c of clients) if (c.meters) c.send(data);
  });

  fastify.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket, req) => {
      const address = req.socket.remoteAddress ?? '';
      const client: Client = {
        send: (d: string) => socket.readyState === 1 && socket.send(d),
        sendDroppable: (d: string) => socket.readyState === 1 && socket.bufferedAmount < 64 * 1024 && socket.send(d),
        meters: false,
        local: isLocalAddress(address),
        address,
        role: 'viewer',
      };
      clients.add(client);
      // The device's role is sent in reply to its 'hello', which carries its saved owner token.
      client.role = roleOf(client);
      refreshAccess();
      client.send(JSON.stringify({ type: 'state', state: app.state } satisfies ServerToClient));
      client.send(JSON.stringify({ type: 'time', time: app.time, playing: app.playing } satisfies ServerToClient));
      socket.on('message', (raw: Buffer) => {
        try {
          handleMessage(raw);
        } catch (err) {
          // One malformed message must never take the server down.
          console.error('[ws] message failed', err);
        }
      });
      const handleMessage = (raw: Buffer) => {
        let msg: ClientToServer;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        switch (msg.type) {
          case 'hello':
            client.token = typeof msg.token === 'string' ? msg.token : undefined;
            sendSession(client);
            refreshAccess();
            break;
          case 'action':
            if (typeof msg.action !== 'string') return;
            // Enforced here, not just hidden in the UI.
            if (!canDispatch(client.role, app.state.settings.viewer, msg.action)) return;
            app.dispatch(msg.action, Array.isArray(msg.args) ? msg.args : [], 'ui');
            break;
          case 'meters':
            if (msg.enabled !== client.meters) {
              client.meters = !!msg.enabled;
              app.setMetersWanted(client.meters ? 1 : -1);
            }
            break;
          case 'signIn': {
            const result = access.signIn(String(msg.pin ?? ''), address);
            if ('token' in result) client.token = result.token;
            sendSession(client, result);
            refreshAccess();
            break;
          }
          case 'signOut':
            access.signOut(client.token);
            client.token = undefined;
            sendSession(client, { token: '' });
            refreshAccess();
            break;
          case 'setPin': {
            if (client.role !== 'owner') return;
            const result = access.setPin(msg.pin === null ? null : String(msg.pin));
            if ('error' in result) {
              sendSession(client, result);
              break;
            }
            // Every other remembered owner device is signed out by a PIN change.
            for (const c of clients) {
              if (c === client) continue;
              c.token = undefined;
              sendSession(c, { token: '' });
            }
            client.token = result.token;
            sendSession(client, { token: result.token ?? '' });
            refreshAccess();
            break;
          }
        }
      };
      socket.on('error', (err: Error) => console.warn('[ws] socket error', err.message));
      socket.on('close', () => {
        clients.delete(client);
        if (client.meters) app.setMetersWanted(-1);
        refreshAccess();
      });
    });
  });

  fastify.get('/api/state', async () => app.snapshot());
  fastify.get('/api/setlist.json', async (_req, reply) => {
    reply.header('Content-Disposition', `attachment; filename="${app.state.setlist.name}.json"`);
    return app.state.setlist;
  });
  fastify.get('/api/setlist.txt', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8');
    return setlistToText(app.state.setlist, app.state.songs);
  });

  // Lyrics images: [img:path] relative to <projectFolder>/Lyrics
  fastify.get('/lyrics-images/*', async (req, reply) => {
    const folder = app.state.settings.projectFolder;
    if (!folder) return reply.code(404).send();
    const base = path.resolve(folder, 'Lyrics');
    const file = path.resolve(base, (req.params as { '*': string })['*']);
    // `base + sep` so a sibling folder like "Lyrics2" can't be reached.
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return reply.code(404).send();
    return reply.send(fs.createReadStream(file));
  });

  if (options.webDist && fs.existsSync(options.webDist)) {
    await fastify.register(fastifyStatic, { root: options.webDist });
    // SPA fallback
    fastify.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html');
      reply.code(404).send();
    });
  }

  const ports = options.ports ?? [80, ...Array.from({ length: 11 }, (_, i) => 3000 + i)];
  let port = 0;
  for (const p of ports) {
    try {
      await fastify.listen({ port: p, host: '0.0.0.0' });
      port = p;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw err;
    }
  }
  if (!port) throw new Error(`No free port among ${ports.join(', ')}`);

  try {
    await bridge.start();
  } catch (err) {
    await fastify.close();
    throw err;
  }
  // The "Setlist Sync" VST3 plugin is on hold; its hub only starts when explicitly enabled.
  const pluginHub = process.env.SETLIST_PLUGINS === '1' ? new PluginHub() : null;
  if (pluginHub) {
    try {
      await pluginHub.start();
      app.attachPlugins(pluginHub);
    } catch (err) {
      console.warn(`[plugins] Setlist Sync support disabled: ${(err as Error).message}`);
    }
  }
  try {
    await oscService.start();
  } catch (err) {
    console.warn(`[osc] OSC disabled: ${(err as Error).message}`);
  }
  midi.start();

  const urls = lanUrls(port);
  app.setUrls(urls);

  let bonjour: Bonjour | null = null;
  if (options.mdns !== false) {
    try {
      bonjour = new Bonjour();
      // Unique per computer: two Setlist hosts on one network would otherwise clash and stop advertising.
      bonjour.publish({ name: `Setlist (${os.hostname()})`, type: 'http', port, txt: { path: '/' } });
    } catch (err) {
      console.warn('[mdns] failed', err);
    }
  }

  return {
    app,
    port,
    urls,
    async close() {
      app.flush();
      midi.stop();
      oscService.stop();
      pluginHub?.stop();
      bridge.stop();
      bonjour?.unpublishAll();
      bonjour?.destroy();
      await fastify.close();
    },
  };
}
