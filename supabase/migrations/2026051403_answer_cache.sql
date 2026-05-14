create table if not exists public.answer_cache (
  id uuid primary key default gen_random_uuid(),
  normalized_question text not null,
  question_hash text unique not null,
  answer text not null,
  confidence numeric not null default 1,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists answer_cache_question_hash_idx
  on public.answer_cache (question_hash);

create index if not exists answer_cache_normalized_question_idx
  on public.answer_cache (normalized_question);

drop trigger if exists answer_cache_set_updated_at on public.answer_cache;
create trigger answer_cache_set_updated_at
before update on public.answer_cache
for each row
execute function public.set_updated_at();

alter table public.answer_cache enable row level security;
revoke all on public.answer_cache from anon, authenticated;
