create table if not exists public.question_enrichment_queue (
  id uuid primary key default gen_random_uuid(),
  normalized_question text not null unique,
  original_question text not null,
  language text not null default 'th',
  conversation_id uuid,
  retrieval_confidence text,
  payso_related boolean not null default false,
  times_seen integer not null default 1,
  enrichment_status text not null default 'pending',
  notebooklm_prompt text,
  notebooklm_answer text,
  notebooklm_suggested_questions text[] not null default '{}',
  notes text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_enrichment_queue_language_check check (language in ('th', 'en')),
  constraint question_enrichment_queue_confidence_check check (
    retrieval_confidence is null or retrieval_confidence in ('High', 'Medium', 'Low')
  ),
  constraint question_enrichment_queue_status_check check (
    enrichment_status in ('pending', 'manual_review', 'enriched', 'imported', 'ignored')
  )
);

create index if not exists question_enrichment_queue_status_idx
  on public.question_enrichment_queue (enrichment_status, last_seen_at desc);

create index if not exists question_enrichment_queue_payso_idx
  on public.question_enrichment_queue (payso_related, last_seen_at desc);

create index if not exists question_enrichment_queue_last_seen_idx
  on public.question_enrichment_queue (last_seen_at desc);

drop trigger if exists question_enrichment_queue_set_updated_at on public.question_enrichment_queue;
create trigger question_enrichment_queue_set_updated_at
before update on public.question_enrichment_queue
for each row
execute function public.set_updated_at();

alter table public.question_enrichment_queue enable row level security;
revoke all on public.question_enrichment_queue from anon, authenticated;
