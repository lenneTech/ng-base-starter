// Fixture: listens on PORT, announces it like the Angular SSR server, renders 200. On SIGTERM it does what
// src/server.ts does: close the server, then exit with code 0.
import { createServer } from 'node:http';
const server = createServer((_req, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log(`Node Express server listening on http://127.0.0.1:${process.env.PORT}`);
  console.log(`api=${process.env.NG_API_URL}`);
});
process.once('SIGTERM', () => server.close(() => process.exit(0)));
