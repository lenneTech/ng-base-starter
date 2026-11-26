// Fixture: every start finds its port taken (Node's own uncaught EADDRINUSE, as in the Angular SSR server).
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';

const port = Number(process.env.PORT);
createNetServer().listen(port, '127.0.0.1', () => {
  createServer().listen(port, '127.0.0.1');
});
