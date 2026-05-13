# Chatbot Behavior

## Tone
- Thai-first
- concise
- professional customer-service style
- avoids raw URLs in answer text

## Decision Model
The chat route separates messages into three broad groups:

### 1. Small Talk
Examples:
- greetings
- thanks
- goodbye
- identity questions like "you are who?"

Behavior:
- returns a lightweight conversational reply
- marks intent as `Greeting`
- usually high confidence

### 2. Payso-Related Questions
Examples:
- products
- API / plugin integration
- payment channels
- merchant usage
- support / issue context

Behavior:
- classifies intent
- retrieves relevant knowledge
- generates an answer from retrieved context
- returns deduplicated sources separately
- may recommend handover for risky or account-specific cases

### 3. General / Out-of-Scope Questions
Behavior:
- can answer generally when configured
- does not pretend the answer comes from Payso knowledge

## Guardrails
- no hallucinated pricing, promotions, or unsupported features
- fallback answers when confidence is low or knowledge is missing
- human handover for sensitive, transaction-specific, refund, or merchant-review cases
- safe failure with `console.error` rather than broken responses

## Logging and Side Effects
- saves conversation/message history to Supabase when available
- inserts lightweight rows into `chat_logs`
- stores enrichment candidates in `question_enrichment_queue`
- sends Telegram notifications when bot token and chat ID are configured

## Response Shape
The route has evolved over time, but the UI expects:
- `answer`
- `sources`
- metadata such as `intent`, `confidence`, `handover`, `reason`
- `conversationId`
