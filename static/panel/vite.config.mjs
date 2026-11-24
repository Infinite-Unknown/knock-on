import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../..');

// `--mode harness` serves the panel locally with @forge/bridge swapped for a
// stand-in that calls the real handlers against an in-memory Jira (harness/).
function harnessApi() {
  return {
    name: 'knock-on-harness',
    async configureServer(server) {
      const { createHarness } = await import(resolve(repo, 'harness/server-api.js'));
      const harness = createHarness();
      server.middlewares.use('/__harness', async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          const data = body ? JSON.parse(body) : {};
          const out = await harness.handle(req.url, data);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(out));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const harness = mode === 'harness';
  return {
    root: here,
    base: './',
    publicDir: resolve(here, 'public'),
    build: { outDir: resolve(here, 'build'), emptyOutDir: true },
    resolve: harness ? { alias: { '@forge/bridge': resolve(repo, 'harness/bridge.js') } } : {},
    server: { port: 5178, strictPort: true, fs: { allow: [repo] } },
    plugins: harness ? [harnessApi()] : [],
  };
});
