create table if not exists public.telegram_message_links (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  created_at timestamptz not null default now(),
  unique (telegram_chat_id, telegram_message_id)
);

create index if not exists telegram_message_links_conversation_idx
  on public.telegram_message_links (conversation_id, created_at desc);

alter table public.telegram_message_links enable row level security;
revoke all on public.telegram_message_links from anon, authenticated;
