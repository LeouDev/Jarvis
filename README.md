# JARVIS — Personal AI Agent

JARVIS is a voice-first personal assistant that talks, remembers what you ask it to, searches the web, manages tasks, reads your GitHub, drafts social posts, and controls your Mac through a locked-down local agent. Every risky action goes through an approval dialog first.

It runs on **free tiers**: Gemini is the primary model, Groq and OpenRouter are fallbacks, and Claude is optional. Voice uses the browser's built-in speech. No paid API is needed.

```
Browser (React)                       Server (Hono, /api)                     Supabase
┌──────────────────────┐   NDJSON     ┌───────────────────────────┐   RLS    ┌──────────────┐
│ Orb · voice · chat   │ ──────────▶  │ context: window + summary │ ───────▶ │ conversations│
│ ApprovalDialog       │ ◀──────────  │ + relevant memories       │          │ messages     │
│                      │   events     │ intent → only needed tools│          │ memories+vec │
│ agent tools ─────┐   │              │ AIManager → Gemini/Groq/… │          │ tasks · logs │
└──────────────────┼───┘              └───────────────────────────┘          └──────────────┘
                   │ fetch + token
                   ▼
        Local Mac agent (127.0.0.1:3847)
        allowlisted apps · validated commands (no shell) · allowed directories only
```

## Contents
- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Supabase setup](#supabase-setup)
- [Gemini / Groq / OpenRouter / Claude](#ai-providers)
- [Environment variables](#environment-variables)
- [Local Mac agent](#local-mac-agent)
- [Security model](#security-model)
- [Extending JARVIS](#extending-jarvis)
- [Deployment](#deployment-vercel)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Quick start

Requires Node 22+ and a Supabase project.

```bash
npm install
cp .env.example .env          # then fill GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
npm run dev                   # web app + API on http://localhost:5173
npm run agent                 # second terminal: Mac agent on http://localhost:3847
```

1. Open http://localhost:5173 and create an account.
2. Go to **Accounts → Mac agent** and paste the token that `npm run agent` printed.
3. Try these:
   - "Hello JARVIS."
   - "Remember that I am building a project called JARVIS." Then ask: "What projects am I working on?"
   - "Open VS Code."
   - "Run a safe command to show my current directory." An approval dialog appears, the command runs, and the result shows in **Activity**.
   - "Create a Facebook post for my 13C project." A **Post preview** appears, and nothing is published unless you click **Publish**.

## Voice

- **Push to talk:** click **Speak** or the orb. Press `Esc` or click the orb while JARVIS is talking to interrupt it.
- **Follow-up** (on by default): after answering something you *said*, JARVIS keeps listening for a few seconds, so a conversation flows without clicking.
- **Wake word** (off by default): click the ear icon or go to **Settings → Voice**, then say "Jarvis…" while the tab is open, e.g. "Jarvis, open VS Code". If you only say "Jarvis", you hear a chime and it waits for the command.
  - This uses the browser's built-in speech recognition (Chrome, Safari), so the microphone stays on, and in Chrome the audio is processed by Google's speech service.
  - The Claude desktop app's browser pane blocks microphones, so use a regular browser.

## Architecture

| Path | What it does |
|---|---|
| `src/` | React 19 + Vite + Tailwind v4 + Motion UI. Components live in `src/components/jarvis/`. |
| `src/hooks/useJarvis.ts` | Runs the conversation state machine: idle, listening, processing, thinking, executing (with approvals), speaking. |
| `src/lib/voice.ts` | `VoiceProvider` interface and `BrowserVoiceProvider` (Web Speech API). |
| `src/lib/agent.ts` | Browser-to-agent client. The browser calls the agent because it can reach `localhost` even when the app is hosted on Vercel. |
| `server/app.ts` | Hono API, served by Vite in dev and by `api/index.ts` on Vercel. |
| `server/ai/` | `AIProvider` interface, the providers (all use OpenAI-compatible endpoints), and `AIManager` (provider selection and fallback). |
| `server/routes/chat.ts` | The agent loop: context, then model, then tools, then approvals, then resume. |
| `server/memory/` | Memory save/search (Gemini embeddings plus Postgres full-text), context window, and summarization. |
| `server/tools/` | Tool registry, intent-based tool loading, and the approval planner. |
| `server/web`, `server/github`, `server/social` | Web search providers, read-only GitHub, and `SocialProvider` (Facebook Pages). |
| `shared/policy.ts` | Command classifier, secret detection, and redaction. Used by both the server and the agent. |
| `local-agent/` | The macOS companion service: `config/`, `security/`, `tools/`, `app.ts`, `server.ts`. |
| `supabase/migrations/` | Schema, Row Level Security, pgvector, and the memory search function. |

**Request flow.** The browser POSTs `/api/chat`. The server:
1. Loads the last 16 messages plus a rolling summary of older turns.
2. Retrieves the top 5 relevant memories.
3. Picks tool groups by intent. A plain greeting sends only the memory tools.
4. Calls the model.

When the model calls tools:
- **Server tools that need no approval** (time, memory, tasks, web, GitHub) run right away, and the loop continues.
- **Tools that need approval, or that run on the Mac,** are saved in `tool_executions` as `pending` and streamed to the browser. The browser shows the approval dialog, runs agent tools against the local agent, then calls `/api/chat` again with `resolutions`. The server records the results, runs any approved server action (for example publishing), and resumes the model.

## Supabase setup

1. Create a project at https://supabase.com/dashboard (the free tier works).
2. Apply the schema, using one of these:
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```
   or paste `supabase/migrations/20261005000000_jarvis_init.sql` into **SQL Editor** and run it.
3. **Project Settings → API**: copy the Project URL into `SUPABASE_URL` and the `anon`/publishable key into `SUPABASE_ANON_KEY`.
4. **Authentication → URL Configuration**: add `http://localhost:5173` (and your Vercel URL) to the Redirect URLs.
5. Optional Google login: **Authentication → Providers → Google**. Enable it, add OAuth client credentials from Google Cloud, and use `https://<ref>.supabase.co/auth/v1/callback` as the authorized redirect URI.
6. Optional: turn off "Confirm email" while developing so sign-up logs you in immediately.

The server never uses the service-role key. Every query runs as the signed-in user, so RLS applies.

## AI providers

| Provider | Free key | Default model | Env |
|---|---|---|---|
| Gemini (primary) | https://aistudio.google.com/apikey | `gemini-3.5-flash-lite` | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| Groq (fallback) | https://console.groq.com/keys | `openai/gpt-oss-120b` | `GROQ_API_KEY`, `GROQ_MODEL` |
| OpenRouter (fallback) | https://openrouter.ai/keys | `meta-llama/llama-3.3-70b-instruct:free` | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| Claude (optional) | https://console.anthropic.com | `claude-sonnet-5-5` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |

- **Switching providers:** `AI_PROVIDER=gemini|groq|openrouter|claude`. Signed-in users can also pick any configured provider in **Settings → AI provider**.
- **Fallback:** `AI_FALLBACK=groq,openrouter` (the default) is tried in order when the primary fails, and JARVIS tells you it switched. Fallback only happens before any text has streamed.
- **Semantic memory:** `GEMINI_API_KEY` also powers memory embeddings (`gemini-embedding-001`, 768 dimensions). Without it, memory search uses Postgres full-text search.

## Environment variables

Everything lives in `.env` (git-ignored). See `.env.example` for the full annotated list.

| Variable | Required | Notes |
|---|---|---|
| `AI_PROVIDER`, `AI_FALLBACK` | – | Default `gemini` and `groq,openrouter`. |
| `GEMINI_API_KEY` | ✓ (or another provider) | Server only. |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` | – | Fallbacks or alternatives. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | ✓ | These two are the only values exposed to the browser (see `vite.config.ts`). |
| `SUPABASE_SERVICE_ROLE_KEY` | – | Not used. Never expose it. |
| `JARVIS_LOCAL_AGENT_URL` | – | Default agent URL shown in the UI (`http://localhost:3847`). |
| `TAVILY_API_KEY` | – | Real web search (free tier). Falls back to Wikipedia search. |
| `GITHUB_USERNAME`, `GITHUB_TOKEN` | – | Read-only GitHub tool. |
| `TOKEN_ENCRYPTION_KEY` | for Facebook | 32-byte base64. Encrypts connected-account tokens with AES-256-GCM. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |

Restart `npm run dev` after editing `.env`.

## Local Mac agent

```bash
npm run agent
```

The agent:
- **Network:** listens on `127.0.0.1` only, rejects any `Host` header other than localhost (DNS-rebinding protection), and only accepts the browser origins listed in `allowedOrigins`.
- **Token:** created on first run, stored in `local-agent/.agent-token` (mode 600, git-ignored), and printed on start. Paste it in **Accounts → Mac agent**. To use your own token, set `JARVIS_AGENT_TOKEN`.
- **Config:** created on first run at `local-agent/config/agent.config.json` (git-ignored). Edit it, then restart the agent:
  ```json
  {
    "allowedDirectories": ["~/Development", "~/Documents", "~/Desktop", "/Volumes/Mac Storage/Development"],
    "allowedApps": ["Visual Studio Code", "Safari", "Terminal", "…"],
    "allowedOrigins": ["http://localhost:5173", "https://your-app.vercel.app"]
  }
  ```
  Missing directories are detected and shown as crossed out in the UI.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness check, plus whether the supplied token is valid. |
| `GET /config` | Allowed directories (with an exists flag) and allowed apps. |
| `POST /open-app` | `open -a <app>`, only for apps on the allowlist. Aliases like "vs code" work. |
| `POST /open-url` | Opens http(s) URLs only. |
| `POST /terminal` | Runs one validated command via `execFile` (no shell). |
| `POST /file/read` | Reads a text file (256 KB max) or lists a directory. |
| `POST /file/write` | Creates a file. Never overwrites unless `overwrite: true`. |
| `POST /file/search` | Spotlight (`mdfind`) search, limited to allowed directories. |
| `POST /system/status` | CPU, memory, disk, and network latency. |

To start the agent at login, run `npm run agent` from a Login Item, or wrap it in a `launchd` plist.

### App skills and macOS permissions

| Say | Skill | macOS permission (granted once, to the app running the agent, e.g. Terminal) |
|---|---|---|
| "Open Dicta in VS Code" | `openProject` (folder must be in allowed directories) | none |
| "Pause the music", "What's playing?" | `mediaControl` (Spotify / Music) | Automation → Spotify / Music (prompt) |
| "Volume to 30", "Mute" | `setVolume` | none |
| "Remind me at 5 to call Mark" | `createReminder` | Automation + Reminders access (prompts) |
| "Make a note…" | `createNote` | Automation → Notes (prompt) |
| "Add a meeting tomorrow at 2" | `createCalendarEvent` | Automation + Calendar access (prompts) |
| "What's on my screen?" | `lookAtScreen` (always asks first; analysed by Gemini, never stored) | **Screen Recording** → Terminal (System Settings, manual) |
| "What's on my clipboard?" | `clipboard` (refuses secret-looking text) | none |

All AppleScript is fixed in `local-agent/tools/mac-apps.ts`, and your words are passed only as arguments, so a spoken phrase can't inject commands. Tip: tell JARVIS where projects live ("Remember that Dicta is in /Volumes/Mac Storage/Development/dicta") so "open Dicta" works instantly.

### Speech recognition

**Settings → Voice → Speech engine.**
- **Whisper (default):** records in the browser, detects when you stop talking, and transcribes on the server with Groq's free `whisper-large-v3-turbo`. Your saved memories are sent along as a vocabulary hint, so names like "13C" or "Kassix" are spelled right. Needs `GROQ_API_KEY`.
- **Browser built-in:** Chrome or Safari recognition, which streams interim text.

The wake word is always spotted by the browser recognizer. In Whisper mode, the command after it is then re-transcribed from the recorded audio.

## Security model

- **Keys:** AI, GitHub, and encryption keys exist only on the server. The browser bundle gets `SUPABASE_URL` and the anon key, nothing else.
- **Database:** RLS is on every table, each user sees only their own rows, and the `anon` role has no grants. Connected-account tokens are encrypted before they reach the database.
- **Permission levels:**
  - `read`: runs immediately.
  - `write`: runs immediately unless Settings requires approval (files are on by default).
  - `dangerous`: always asks. Publishing social posts can never skip approval.
- **Untrusted tool calls:** every model tool call is schema-validated (zod) before anything runs. Unknown tools and bad parameters are rejected.
- **Terminal pipeline:** model → tool call → `classifyCommand` → permission check → approval dialog → agent re-validates → `execFile`. The agent never trusts the server's classification.
  - **Blocked always:** `rm`, `sudo`, `mkfs`, `diskutil`, `shutdown`/`reboot`, `security` (keychain), `osascript`, shells, `env`/`xargs`, inline interpreter code (`python -c`, `node -e`), `find -delete/-exec`, destructive git, anything touching credential paths (`.ssh`, `.env`, keychains, `*.pem`), and any `; | & $ \` > <`.
  - **Safe** (can skip approval if you allow it): read-only commands such as `pwd`, `ls`, `git status`, `git log`.
  - **Everything else:** needs approval, and the agent refuses it without `confirmed: true`.
- **Files:** paths are resolved through `realpath` (symlinks can't escape) and must sit inside the allowed directories. Credential files are refused even inside them. Existence is only revealed for allowed paths.
- **Memory:** saved only when you ask. Credentials are refused twice, by the TypeScript filter and by a Postgres trigger.
- **Logging:** inputs are redacted (secret-looking keys and values) and results truncated.
- **Known limit:** the agent token lives in browser `localStorage`, so an XSS on the JARVIS origin could reach the agent. The UI renders no raw HTML. Keep `allowedOrigins` tight.

## Extending JARVIS

### Add a tool
Create it next to the others (for example in `server/tools/services.ts`) and add it to `TOOLS` in `server/tools/index.ts`:

```ts
export const weather: JarvisTool<{ city: string }> = {
  name: 'weather', group: 'web', permission: 'read', runOn: 'server',
  description: 'Current weather for a city.',
  schema: z.object({ city: z.string().min(1).max(80) }),
  summary: (i) => `Checked weather in ${i.city}`,
  execute: async ({ city }) => ok(await fetchWeather(city)),
};
```
- `permission: 'dangerous'` makes it always ask for approval. A custom `approval()` can block, ask, or auto-run per input.
- `runOn: 'agent'` tools run on the Mac. Add the endpoint in `local-agent/app.ts` and map it in `src/lib/agent.ts` (`ENDPOINTS`).
- Add keywords to `INTENTS` in `server/tools/index.ts` if the tool belongs to a new group.

### Add an AI provider
Any OpenAI-compatible API is a single file:

```ts
// server/ai/MistralProvider.ts
export const MistralProvider = new OpenAICompatibleProvider({
  id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1',
  apiKeyEnv: 'MISTRAL_API_KEY', modelEnv: 'MISTRAL_MODEL', defaultModel: 'mistral-small-latest',
});
```
Register it in `PROVIDERS` in `server/ai/AIManager.ts`. For a non-compatible API, implement the `AIProvider` interface directly.

### Add a social platform
Implement `SocialProvider` (`createDraft`, `getAccount`, `publishPost`, optionally `uploadMedia`) in `server/social/index.ts` using the platform's official API, then add it to `SOCIAL_PROVIDERS`. The `social_publish` tool, its platform enum, and the approval preview pick it up automatically. Add a connect form in `ConnectionManager.tsx`.

### Add a voice provider
Implement `VoiceProvider` in `src/lib/voice.ts` (ElevenLabs, OpenAI, Google) and export it as `voice`.

## Deployment (Vercel)

```bash
vercel link
vercel env add GEMINI_API_KEY        # repeat for SUPABASE_URL, SUPABASE_ANON_KEY, TOKEN_ENCRYPTION_KEY, …
vercel deploy --prod
```
- The Vite build serves the SPA, and `api/index.ts` serves `/api/*` (see `vercel.json`) as a Node.js function on Fluid Compute. Streaming works on the default runtime.
- Add the Vercel URL to Supabase's Redirect URLs and to `allowedOrigins` in the agent config. The deployed app still controls your Mac, because the browser calls `localhost:3847` directly. Chrome may ask for permission to access local network devices.

## Testing

```bash
npm test            # vitest: policy, permissions, tools, AI providers + fallback, memory safety, agent security, API auth
npm run typecheck
npm run build
```
Tests mock all network calls and use no secrets.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Gemini isn't configured" | Add `GEMINI_API_KEY` to `.env` and restart `npm run dev`. |
| "Gemini is currently unavailable…" | Free-tier rate limit or outage. Add `GROQ_API_KEY` for automatic fallback. |
| "I can't control your Mac because the JARVIS local agent isn't running." | Run `npm run agent` and check the token in **Accounts**. |
| Agent says **Wrong token** | Paste the token from `local-agent/.agent-token`. |
| Agent says `Origin … is not allowed` | Add your web origin to `allowedOrigins` in `local-agent/config/agent.config.json`. |
| "That path is outside the allowed directories" | Add the folder to `allowedDirectories`, then restart the agent. |
| "Facebook isn't connected yet" | Settings → **Accounts → Facebook Page**. Needs `TOKEN_ENCRYPTION_KEY` on the server. |
| Voice input button disabled | Use Chrome or Safari. Firefox has no speech recognition. Allow microphone access. |
| Login shows a setup message | `SUPABASE_URL` / `SUPABASE_ANON_KEY` are missing from `.env`. |
| Every API call returns 401 | Session expired. Sign out and back in. |
| Memories not found semantically | Without `GEMINI_API_KEY`, search is keyword-based. Memories saved before the key was added have no embedding. |
