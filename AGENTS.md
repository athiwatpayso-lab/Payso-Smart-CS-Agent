# AGENTS.md
# Payso Smart CS Agent

## Project Overview
AI Customer Success Agent สำหรับตอบคำถามลูกค้า Payso
รองรับ:
- Web Chat
- RAG Retrieval
- Telegram Admin Handover
- Supabase Knowledge Base
- OpenRouter LLM
- Human Escalation

ระบบถูกออกแบบให้:
- ตอบเร็ว
- ควบคุมคำตอบได้
- ลด Hallucination
- รองรับ Fintech Workflow

---

# Core Stack

## Frontend
- Next.js 14
- React
- TypeScript
- TailwindCSS

## Backend
- Next.js API Routes
- Supabase
- PostgreSQL
- pgvector

## AI Layer
- OpenRouter
- GPT / Claude / Gemini Models
- RAG Retrieval
- Intent Classification

## Integration
- Telegram Bot API
- Webhook API

---

# Critical Rules

## NEVER
- ห้าม Hardcode คำตอบ
- ห้ามตอบมั่วเรื่องค่าธรรมเนียม
- ห้ามลบ Retrieval Layer
- ห้ามลบ Telegram Handover
- ห้ามเปิดเผย API Keys
- ห้าม Auto Deploy Production
- ห้ามแก้ Database Schema โดยไม่จำเป็น

## ALWAYS
- Retrieval ก่อน Generate คำตอบ
- ใช้ข้อมูลจาก Supabase Knowledge Base
- ถ้า Confidence ต่ำ → Handover
- ใช้ภาษาไทย Professional Tone
- UX ต้องลื่นเหมือน ChatGPT

---

# AI Workflow

User Question
→ Detect Language
→ Intent Classification
→ Query Optimization
→ Supabase Retrieval
→ Vector Search
→ Rerank Context
→ LLM Generation
→ Confidence Validation
→ Response
→ Save Conversation

---

# Intent Categories

- Product Information
- API Integration
- Technical Issue
- Pricing Sensitive
- Refund Issue
- Human Handover
- Out of Scope

---

# Handover Rules

If:
- refund issue
- legal issue
- payment failure
- angry customer
- confidence low
- sensitive pricing

Then:
→ Send Telegram Notification
→ Switch Conversation To Admin Mode

---

# UI Rules

## Chat UX
- Streaming Response Preferred
- Typing Animation Smooth
- Mobile Friendly
- Keep Conversation Context

## Do Not
- Show Internal Errors
- Show Raw JSON
- Show Sources In Visible Chat
- Break Chat Layout

---

# Database Rules

## Main Tables
- conversations
- messages
- knowledge_chunks
- telegram_message_links

## knowledge_chunks
Store:
- FAQ
- Product Info
- API Docs
- Technical Issues
- Refund Policy

---

# Retrieval Rules

## Priority
1. Exact Match
2. Semantic Match
3. FAQ Match

## Guardrails
- If retrieval empty → fallback carefully
- Never invent unsupported features
- Never hallucinate pricing

---

# Telegram Rules

## Admin Takeover
- Admin reply overrides AI
- AI must stop responding during takeover
- Telegram replies sync back to web chat

## Notification
Send:
- User message
- Conversation ID
- Takeover button

---

# Voice Workflow

Voice Input
→ STT
→ LLM
→ TTS
→ Audio Response

Supported:
- Thai
- English

---

# Environment Variables

Required:

OPENROUTER_API_KEY=
OPENROUTER_MODEL=

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

---

# Commands

## Development
npm run dev

## Production Build
npm run build

## Start
npm run start

## Supabase
npx supabase db push

## Deploy
vercel deploy

---

# Coding Style

## Frontend
- Clean UI
- Minimal Design
- Reusable Components

## Backend
- Keep API Routes Small
- Separate Logic From UI
- Avoid Large Files

## AI Prompting
- Thai First
- Professional Tone
- No Marketing Fluff
- No Fake Confidence

---

# Testing Checklist

Before Deploy:
- Chat Response Works
- Retrieval Works
- Telegram Handover Works
- Supabase Connected
- No Console Error
- Mobile Responsive
- Build Success

---

# Deployment Rules

Before Push:
- Run npm run build
- Check Environment Variables
- Verify Telegram Webhook
- Verify Supabase Connection

---

# Mission

AI ต้อง:
- ตอบเร็วพอสำหรับลูกค้า
- แม่นพอสำหรับ Fintech
- และควบคุมได้พอสำหรับธุรกิจ