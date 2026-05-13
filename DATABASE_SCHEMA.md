# Database Schema

## Core Tables

### `knowledge_chunks`
Primary knowledge base used by retrieval.

Expected fields used by the app:
- `id`
- `product`
- `category`
- `title`
- `content`
- `source_url`
- `keywords`

Related behavior:
- Queried through the Supabase RPC `search_knowledge_chunks`
- Used to build grounded answers and source links

### `conversations`
Stores one row per chat session.

Fields used by the app:
- `id`
- `language`
- `status`
- `last_message_at`

### `chat_messages`
Stores message history for each conversation.

Fields used by the app:
- `id`
- `conversation_id`
- `role`
- `content`
- `intent`
- `confidence`
- `handover`
- `sources`
- `reason`

### `handover_cases`
Stores cases that should be reviewed by staff.

Fields used by the app:
- `id`
- `conversation_id`
- `latest_message_id`
- `status`
- `priority`
- `reason`

### `chat_logs`
Stores lightweight chatbot output logs.

Current required fields:
- `user_message`
- `assistant_message`

Optional fields may exist in some environments:
- `conversation_id`
- `intent`
- `user_name`
- `user_phone`
- `user_email`
- `user_company`

Note:
- The current route checks available columns dynamically before inserting optional values.

### `question_enrichment_queue`
Stores repeated or unclear questions for future knowledge-base expansion.

Fields used by the app:
- `id`
- `original_question`
- `normalized_question`
- `language`
- `conversation_id`
- `retrieval_confidence`
- `payso_related`
- `notebooklm_prompt`
- `times_seen`
- `last_seen_at`

## RPC

### `search_knowledge_chunks`
Used by `lib/retrieval.ts` to fetch candidate knowledge rows from Supabase.

Input used by the app:
- `query_text`
- `match_count`

Expected output shape:
- knowledge chunk fields above
- `base_score`
