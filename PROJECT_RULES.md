# Payso Smart CS Agent - Project Rules

## Core Rules
- Minimal changes only
- Token efficient
- One task at a time
- Do not refactor unrelated code
- Do not change unrelated UI
- Do not install packages unless necessary
- Do not commit
- Do not push
- Do not deploy

## Backend Rules
- Keep API response format stable
- Do not expose service role keys to client
- Use existing Supabase helpers if available
- Fail safely with console.error

## UI Rules
- Keep current design language
- Minimal clean UI
- Preserve responsiveness
- Avoid unnecessary animations

## Chatbot Rules
- Thai language only
- Professional concise customer-service tone
- Answer only from knowledge base
- No hallucinations
- No raw URLs in answer text
- No source numbers/citations
- Show sources separately as clickable links

## Codex Output
Always report:
- changed files
- what was modified
- how to test