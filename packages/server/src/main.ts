import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './index.ts';

// During a show the server must keep running: log unexpected errors instead of exiting.
process.on('uncaughtException', (err) => console.error('[setlist] unexpected error (still running):', err));
process.on('unhandledRejection', (err) => console.error('[setlist] unhandled rejection (still running):', err));

const here = path.dirname(fileURLToPath(import.meta.url));
const portArg = process.argv.indexOf('--port');
const portValue = portArg >= 0 ? process.argv[portArg + 1] : process.env.PORT;
const port = portValue ? [Number(portValue)] : undefined;

const server = await startServer({
  ports: port,
  webDist: path.resolve(here, '../../web/dist'),
  remoteScriptDir: path.resolve(here, '../../../remote-script/Setlist'),
});
console.log(`Setlist server running:\n  ${server.urls.join('\n  ')}`);
console.log('Waiting for Ableton Live (Setlist control surface)...');
server.app.on('patch', (p) => {
  if ('liveConnected' in p) console.log(p.liveConnected ? 'Live connected' : 'Live disconnected');
  if (p.scriptOutdated) {
    console.warn(
      'WARNING: Live is running an old copy of the Setlist Remote Script. Run `npm run install-script`\n' +
        "(or copy remote-script/Setlist into Live's User Library → Remote Scripts), then restart Live.",
    );
  }
});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  try {
    await server.close(); // writes pending setlist / settings changes first
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
