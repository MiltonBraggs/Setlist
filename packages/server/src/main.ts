import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const portArg = process.argv.indexOf('--port');
const portValue = portArg >= 0 ? process.argv[portArg + 1] : process.env.PORT;
const port = portValue ? [Number(portValue)] : undefined;

const server = await startServer({
  ports: port,
  webDist: path.resolve(here, '../../web/dist'),
});
console.log(`Setlist server running:\n  ${server.urls.join('\n  ')}`);
console.log('Waiting for Ableton Live (Setlist control surface)...');
server.app.on('patch', (p) => {
  if ('liveConnected' in p) console.log(p.liveConnected ? 'Live connected' : 'Live disconnected');
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
