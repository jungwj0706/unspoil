import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { loadEnv } from './env.ts';
import { ensureDefaults } from './settings.ts';

loadEnv();
ensureDefaults();

const port = Number(process.env.UNSPOIL_PORT || 47821);
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`Unspoil Hub http://127.0.0.1:${info.port}`);
});
