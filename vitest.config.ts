import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so tests never load the developer's .env.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
