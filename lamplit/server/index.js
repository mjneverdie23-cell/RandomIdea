// Entry point: `npm start`. See README.md for the environment variables.

import { config } from './config.js';
import { startServer } from './app.js';

const app = startServer(config);
await app.ready;

// A short line every minute while anyone is around.
setInterval(() => {
  const s = app.manager.status();
  if (s.online > 0 || s.queue > 0) {
    console.log(`[${new Date().toISOString()}] online ${s.online}, focusing ${s.focusing}, rooms ${s.halls}, queue ${s.queue}`);
  }
}, 60_000).unref();

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('Closing the reading rooms…');
    await app.close('restart');
    process.exit(0);
  });
}
