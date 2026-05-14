create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.knowledge_chunks (
  id text primary key,
  product text not null,
  category text not null,
  title text not null,
  content text not null,
  source_url text not null,
  keywords text[] not null default '{}',
  embedding vector(1536),
  search_tsv tsvector generated always as (
    to_tsvector(
      'simple',
      concat_ws(' ', product, category, title, content, array_to_string(keywords, ' '))
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  language text not null default 'th',
  status text not null default 'open',
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_language_check check (language in ('th', 'en')),
  constraint conversations_status_check check (status in ('open', 'handover', 'closed'))
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null,
  content text not null,
  intent text,
  confidence text,
  handover boolean not null default false,
  sources jsonb not null default '[]'::jsonb,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_messages_role_check check (role in ('user', 'assistant', 'admin')),
  constraint chat_messages_confidence_check check (
    confidence is null or confidence in ('High', 'Medium', 'Low')
  )
);

create table if not exists public.handover_cases (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  latest_message_id uuid references public.chat_messages(id) on delete set null,
  status text not null default 'pending',
  priority text not null default 'normal',
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint handover_cases_status_check check (status in ('pending', 'in_progress', 'resolved')),
  constraint handover_cases_priority_check check (priority in ('normal', 'high', 'urgent'))
);

alter table public.knowledge_chunks
add column if not exists search_tsv tsvector
generated always as (
  to_tsvector('simple', coalesce(content, ''))
) stored;

create index if not exists knowledge_chunks_search_tsv_idx
  on public.knowledge_chunks
  using gin (search_tsv);

create index if not exists knowledge_chunks_keywords_idx
  on public.knowledge_chunks
  using gin (keywords);

create index if not exists knowledge_chunks_product_idx
  on public.knowledge_chunks (product);

create index if not exists knowledge_chunks_category_idx
  on public.knowledge_chunks (category);

create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at desc);

create index if not exists handover_cases_status_idx
  on public.handover_cases (status, priority, created_at desc);

drop trigger if exists knowledge_chunks_set_updated_at on public.knowledge_chunks;
create trigger knowledge_chunks_set_updated_at
before update on public.knowledge_chunks
for each row
execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row
execute function public.set_updated_at();

drop trigger if exists chat_messages_set_updated_at on public.chat_messages;
create trigger chat_messages_set_updated_at
before update on public.chat_messages
for each row
execute function public.set_updated_at();

drop trigger if exists handover_cases_set_updated_at on public.handover_cases;
create trigger handover_cases_set_updated_at
before update on public.handover_cases
for each row
execute function public.set_updated_at();

alter table public.knowledge_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.handover_cases enable row level security;

revoke all on public.knowledge_chunks from anon, authenticated;
revoke all on public.conversations from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
revoke all on public.handover_cases from anon, authenticated;

create or replace function public.search_knowledge_chunks(query_text text, match_count int default 12)
returns table (
  id text,
  product text,
  category text,
  title text,
  content text,
  source_url text,
  keywords text[],
  base_score double precision
)
language sql
stable
as $$
  with normalized as (
    select trim(lower(query_text)) as q
  ),
  candidates as (
    select
      kc.*,
      ts_rank_cd(kc.search_tsv, websearch_to_tsquery('simple', query_text)) as text_rank,
      greatest(
        extensions.similarity(lower(kc.product), n.q),
        extensions.similarity(lower(kc.title), n.q),
        extensions.similarity(lower(kc.category), n.q)
      ) as trigram_rank,
      exists (
        select 1
        from unnest(kc.keywords) as keyword
        where lower(keyword) = n.q
           or lower(keyword) like '%' || n.q || '%'
      ) as keyword_match
    from public.knowledge_chunks kc
    cross join normalized n
    where kc.search_tsv @@ websearch_to_tsquery('simple', query_text)
       or lower(kc.product) like '%' || n.q || '%'
       or lower(kc.title) like '%' || n.q || '%'
       or lower(kc.category) like '%' || n.q || '%'
       or lower(kc.content) like '%' || n.q || '%'
       or exists (
         select 1
         from unnest(kc.keywords) as keyword
         where lower(keyword) like '%' || n.q || '%'
       )
       or extensions.similarity(lower(kc.product), n.q) > 0.12
       or extensions.similarity(lower(kc.title), n.q) > 0.12
  )
  select
    id,
    product,
    category,
    title,
    content,
    source_url,
    keywords,
    ((text_rank * 100.0) + (trigram_rank * 20.0) + (case when keyword_match then 10.0 else 0.0 end))::double precision as base_score
  from candidates
  order by base_score desc
  limit greatest(match_count, 1);
$$;

create or replace function public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_count int default 12,
  match_threshold float default 0.2
)
returns table (
  id text,
  product text,
  category text,
  title text,
  content text,
  source_url text,
  keywords text[],
  similarity double precision
)
language sql
stable
as $$
  select
    id,
    product,
    category,
    title,
    content,
    source_url,
    keywords,
    (1 - (embedding <=> query_embedding))::double precision as similarity
  from public.knowledge_chunks
  where embedding is not null
    and (1 - (embedding <=> query_embedding)) >= match_threshold
  order by embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
