-- Projects: where each project lives (folder, website, repo) so "open 13C's site" or "pull Kassix"
-- resolve without guessing. Per-user, protected by Row Level Security.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  aliases text[] not null default '{}',
  path text check (char_length(path) <= 1000),
  website text check (char_length(website) <= 500),
  repo text check (char_length(repo) <= 200),
  description text check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index projects_user_name_idx on public.projects (user_id, lower(name));

alter table public.projects enable row level security;
create policy "own projects" on public.projects for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.projects from anon;
