import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createAgentApp } from './app.js';
import { CONFIG_FILE, loadConfig } from './config/index.js';

// The browser skill's model key comes from the JARVIS .env on this Mac (it never leaves the machine).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* no .env: browser tasks will explain that GEMINI_API_KEY is missing */
}

const cfg = loadConfig();

// Loopback only: the agent is never reachable from the network.
serve({ fetch: createAgentApp(cfg).fetch, hostname: '127.0.0.1', port: cfg.port }, ({ port }) => {
  console.log(`\n  JARVIS local agent → http://localhost:${port}`);
  console.log(`  Token (paste into JARVIS → Accounts → Mac agent): ${cfg.token}\n`);
  console.log('  Allowed directories:');
  for (const d of cfg.allowedDirectories) console.log(`    ${existsSync(d) ? '✓' : '✗ (missing)'} ${d}`);
  console.log(`  Allowed origins: ${cfg.allowedOrigins.join(', ')}`);
  console.log(`  Edit ${CONFIG_FILE} to change them.\n`);
});
