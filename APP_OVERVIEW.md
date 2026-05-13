# Payso Smart CS Agent Overview

## Purpose
Payso Smart CS Agent is a Next.js 14 prototype for answering Payso customer questions with a Thai-first support experience. It combines:

- a marketing-style landing page
- a chat UI
- a server-side chat API
- Supabase-backed retrieval and storage

## Main Flow
1. User sends a message from the chat section on `app/page.tsx`.
2. `app/api/chat/route.ts` classifies intent, retrieves Payso knowledge, and decides whether the question is:
   - small talk
   - Payso-related
   - general / out of scope
3. The route generates an answer using guarded logic and, when configured, OpenRouter.
4. The response includes:
   - `answer`
   - intent/confidence/handover metadata
   - deduplicated source links
   - conversation metadata
5. The UI renders the answer bubble and optional clickable sources below it.

## Key Files
- `app/page.tsx`: single-page UI and chat client
- `app/api/chat/route.ts`: main chatbot orchestration
- `lib/retrieval.ts`: keyword + Supabase RPC retrieval
- `lib/chat-store.ts`: conversation, message, handover, and enrichment storage
- `lib/supabase/admin.ts`: server-only Supabase admin client
- `lib/llm.ts`: OpenRouter answer generation
- `lib/guardrails.ts`: safe fallback and handover checks
- `lib/telegram.ts`: optional Telegram notifications

## External Dependencies
- Next.js 14
- React 18
- Supabase JS
- OpenRouter API
- Telegram Bot API

## Runtime Notes
- Service role credentials stay server-side only.
- The app can still run with limited functionality if Supabase or OpenRouter env vars are missing.
- Retrieval prefers Supabase via `search_knowledge_chunks`, with local fallback logic available in the repo.
