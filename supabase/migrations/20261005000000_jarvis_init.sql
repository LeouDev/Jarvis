-- JARVIS schema. Every table is per-user and protected by Row Level Security.
create extension if not exists vector with schema extensions;

-- ── users (profile mirror of auth.users) ──
create table public.users (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ── conversations & messages ──
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default 'New conversation',
  summary text,
  summarized_seq bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on public.conversations (user_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  conversation_id uuid not null references public.conversations on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  tool_calls jsonb,
  tool_call_id text,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, seq);
create index messages_user_idx on public.messages (user_id);

-- ── memories ──
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  category text not null default 'other'
    check (category in ('personal', 'projects', 'preferences', 'work', 'goals', 'routines', 'technical', 'other')),
  importance smallint not null default 3 check (importance between 1 and 5),
  embedding extensions.vector(768),
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_user_idx on public.memories (user_id);
create index memories_fts_idx on public.memories using gin (fts);
-- ponytail: no vector index; a personal memory set is small enough for exact scans. Add HNSW past ~10k rows.

-- Defense in depth: credentials can never be stored as memories, whichever client writes them.
create function public.reject_secret_memories() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.content ~* '\m(password|passwd|passcode|api[ _-]?key|secret|access[ _-]?token|auth[ _-]?token|private[ _-]?key|pin code|credit card)\M\s*(is|:|=)'
     or new.content ~ '(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY)' then
    raise exception 'Memories cannot contain passwords, keys or other credentials';
  end if;
  return new;
end $$;

create trigger memories_reject_secrets before insert or update of content on public.memories
for each row execute function public.reject_secret_memories();

-- Hybrid retrieval: cosine similarity when embeddings exist, otherwise/also full-text.
create function public.match_memories(query_text text, query_embedding extensions.vector(768) default null, match_count int default 5)
returns table (id uuid, content text, category text, importance smallint, created_at timestamptz, score real)
language sql stable security invoker set search_path = '' as $$
  with q as (select websearch_to_tsquery('english', query_text) as tsq)
  select m.id, m.content, m.category, m.importance, m.created_at,
         greatest(
           case when query_embedding is not null and m.embedding is not null
                then (1 - (m.embedding operator(extensions.<=>) query_embedding))::real else 0 end,
           ts_rank(m.fts, q.tsq)
         ) as score
  from public.memories m, q
  where m.user_id = (select auth.uid())
    and ((query_embedding is not null and m.embedding is not null
          and 1 - (m.embedding operator(extensions.<=>) query_embedding) > 0.6)
         or m.fts @@ q.tsq)
  order by score desc, m.importance desc
  limit least(match_count, 20);
$$;

-- ── preferences, tasks ──
create table public.preferences (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  notes text,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_user_idx on public.tasks (user_id, status);

-- ── tool executions (approval state machine) ──
create table public.tool_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  conversation_id uuid references public.conversations on delete cascade,
  tool_call_id text not null,
  tool text not null,
  summary text not null,
  input jsonb not null default '{}',
  permission text not null check (permission in ('read', 'write', 'dangerous')),
  run_on text not null check (run_on in ('server', 'agent')),
  needs_approval boolean not null default false,
  approved boolean,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'rejected', 'blocked')),
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tool_executions_user_idx on public.tool_executions (user_id, created_at desc);
create index tool_executions_conversation_idx on public.tool_executions (conversation_id, status);

-- ── connected accounts (tokens are AES-256-GCM encrypted by the server; the key never reaches the DB) ──
create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  provider text not null,
  external_id text not null,
  account_name text,
  token_encrypted text not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- ── activity log ──
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  actor text not null check (actor in ('jarvis', 'user')),
  action text not null,
  tool text,
  status text not null,
  approved boolean,
  input jsonb,
  result_summary text,
  created_at timestamptz not null default now()
);
create index activity_logs_user_idx on public.activity_logs (user_id, created_at desc);

-- ── Row Level Security: each user sees only their own rows ──
alter table public.users enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.preferences enable row level security;
alter table public.tasks enable row level security;
alter table public.tool_executions enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.activity_logs enable row level security;

create policy "own profile" on public.users for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own conversations" on public.conversations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own messages" on public.messages for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));

create policy "own memories" on public.memories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own preferences" on public.preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own tasks" on public.tasks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own tool executions" on public.tool_executions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own connected accounts" on public.connected_accounts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own activity" on public.activity_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The anonymous role gets nothing.
revoke all on public.users, public.conversations, public.messages, public.memories, public.preferences,
  public.tasks, public.tool_executions, public.connected_accounts, public.activity_logs from anon;
revoke execute on function public.match_memories(text, extensions.vector, int) from anon, public;
grant execute on function public.match_memories(text, extensions.vector, int) to authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
