import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { Bonjour } from 'bonjour-service';
import Fastify from 'fastify';
import { setlistToText, type ClientToServer, type ServerToClient } from '@setlist/core';
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
  await fastify.register(fastifyWebsocket);

  const clients = new Set<{ send: (data: string) => void; meters: boolean }>();
  const broadcast = (msg: ServerToClient) => {
    const data = JSON.stringify(msg);
    for (const c of clients) c.send(data);
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
        oscService.publish(app.state, app.time, app.playing);
      });
    }
    Object.assign(pending, partial);
  });
  app.on('time', (time, playing) => {
    broadcast({ type: 'time', time, playing });
    oscService.publish(app.state, time, playing);
  });
  app.on('meters', (levels) => {
    const data = JSON.stringify({ type: 'meters', levels } satisfies ServerToClient);
    for (const c of clients) if (c.meters) c.send(data);
  });

  fastify.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket) => {
      const client = { send: (d: string) => socket.readyState === 1 && socket.send(d), meters: false };
      clients.add(client);
      client.send(JSON.stringify({ type: 'state', state: app.state } satisfies ServerToClient));
      client.send(JSON.stringify({ type: 'time', time: app.time, playing: app.playing } satisfies ServerToClient));
      socket.on('message', (raw: Buffer) => {
        let msg: ClientToServer;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === 'action') app.dispatch(msg.action, msg.args ?? [], 'ui');
        else if (msg.type === 'meters' && msg.enabled !== client.meters) {
          client.meters = msg.enabled;
          app.setMetersWanted(msg.enabled ? 1 : -1);
        }
      });
      socket.on('close', () => {
        clients.delete(client);
        if (client.meters) app.setMetersWanted(-1);
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
    if (!file.startsWith(base) || !fs.existsSync(file)) return reply.code(404).send();
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
  const pluginHub = new PluginHub();
  try {
    await pluginHub.start();
    app.attachPlugins(pluginHub);
  } catch (err) {
    console.warn(`[plugins] Setlist Sync support disabled: ${(err as Error).message}`);
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
      bonjour.publish({ name: 'Setlist', type: 'http', port, txt: { path: '/' } });
    } catch (err) {
      console.warn('[mdns] failed', err);
    }
  }

  return {
    app,
    port,
    urls,
    async close() {
      midi.stop();
      oscService.stop();
      pluginHub.stop();
      bridge.stop();
      bonjour?.unpublishAll();
      bonjour?.destroy();
      await fastify.close();
    },
  };
}
