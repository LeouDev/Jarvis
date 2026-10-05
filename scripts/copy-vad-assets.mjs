// Silero VAD runs in the browser: its model, audio worklet and ONNX runtime are served from /vad/
// on our own origin (the CSP allows nothing else). Copied into public/ for production builds;
// the dev server serves the same files straight from node_modules (see vite.config.ts).
import { cpSync, mkdirSync, readFileSync } from 'node:fs';

const assets = JSON.parse(readFileSync(new URL('./vad-assets.json', import.meta.url), 'utf8'));
mkdirSync('public/vad', { recursive: true });
for (const [name, source] of Object.entries(assets)) cpSync(source, `public/vad/${name}`);
