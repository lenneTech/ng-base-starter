// Fixture: the first start finds its port taken, as when another process binds it between the runner's allocation and
// the server's own bind; every later start behaves like ok.mjs. The first start really binds the port twice, so the
// error is Node's own EADDRINUSE, uncaught, as in the Angular SSR server.
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';

const port = Number(process.env.PORT);
const marker = process.env.FIXTURE_MARKER;
if (marker && !existsSync(marker)) {
  writeFileSync(marker, String(port));
  createNetServer().listen(port, '127.0.0.1', () => {
    createServer().listen(port, '127.0.0.1');
  });
} else {
  const server = createServer((_req, res) => res.end('ok')).listen(port, '127.0.0.1', () => {
    console.log(`Node Express server listening on http://127.0.0.1:${port}`);
  });
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
}
