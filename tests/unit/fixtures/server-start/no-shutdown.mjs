// Fixture: like ok.mjs, but without a shutdown handler, as a server whose graceful shutdown was removed. Outside a
// container SIGTERM still kills it at once; with the check's PID 1 preload it keeps listening, as it would in a
// container.
import { createServer } from 'node:http';
createServer((_req, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log(`Node Express server listening on http://127.0.0.1:${process.env.PORT}`);
});
// A cap for when the runner fails to stop it (a regression of the preload's parent watch, a killed test run): the
// runner is the test's child and this server its grandchild, which the signal guard does not let a test kill. Without
// the cap such a run left the fixture listening for hours. Every test that uses it ends within 15 s.
setTimeout(() => process.exit(0), 60_000).unref();
