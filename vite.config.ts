import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { getRequestListener } from '@hono/node-server';

// Serves /api/* from server/app.ts inside the Vite dev server (one process, hot-reloaded).
// On Vercel the same app is served by api/index.ts.
const api = (): Plugin => ({
  name: 'jarvis-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next();
      const { app } = await server.ssrLoadModule('/server/app.ts');
      getRequestListener(app.fetch)(req, res);
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
  return {
    plugins: [react(), tailwind(), api()],
    // Only these two public values reach the browser. Never add service-role or provider keys here.
    define: {
      'import.meta.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL ?? ''),
      'import.meta.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY ?? ''),
      'import.meta.env.JARVIS_LOCAL_AGENT_URL': JSON.stringify(env.JARVIS_LOCAL_AGENT_URL || 'http://localhost:3847'),
    },
  };
});
