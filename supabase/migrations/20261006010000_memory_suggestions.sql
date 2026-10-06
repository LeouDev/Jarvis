-- Memories JARVIS suggests from conversation (status 'suggested') wait for the user's Keep/Dismiss.
-- `replaces` points at the memory a suggestion would update. Only active memories are recalled.
alter table public.memories add column status text not null default 'active' check (status in ('active', 'suggested'));
alter table public.memories add column replaces uuid references public.memories on delete cascade;

create or replace function public.match_memories(query_text text, query_embedding extensions.vector(768) default null, match_count int default 5)
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
    and m.status = 'active'
    and ((query_embedding is not null and m.embedding is not null
          and 1 - (m.embedding operator(extensions.<=>) query_embedding) > 0.6)
         or m.fts @@ q.tsq)
  order by score desc, m.importance desc
  limit least(match_count, 20);
$$;
