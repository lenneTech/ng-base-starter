// Fixture: listens on PORT, announces it like the Angular SSR server, renders 200.
import { createServer } from 'node:http';
createServer((_req, res) => res.end('ok')).listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log(`Node Express server listening on http://127.0.0.1:${process.env.PORT}`);
  console.log(`api=${process.env.NG_API_URL}`);
});
