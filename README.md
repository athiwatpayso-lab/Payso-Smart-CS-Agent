# Payso Smart CS Agent (Prototype Demo)

AI-driven Customer Success Agent สำหรับธุรกิจ Fintech
Prototype Demo สำหรับจำลองระบบ Customer Support อัตโนมัติของ Payso โดยอ้างอิงโจทย์จาก Payso Innovation Support Assessment 

---

# Project Overview

โปรเจคนี้ถูกพัฒนาขึ้นเพื่อจำลองแนวทางการสร้าง AI Customer Success Agent สำหรับ Payso ที่สามารถช่วยตอบคำถามลูกค้าเกี่ยวกับผลิตภัณฑ์และการเชื่อมต่อระบบได้ตลอด 24 ชั่วโมง

Prototype นี้เน้นการแสดง:

* AI Workflow Design
* RAG-based Knowledge Retrieval
* Human Handover
* Voice Interaction Prototype
* Fintech Accuracy Guardrails

โดยเน้น “Architecture และ Workflow” มากกว่าการเป็น Production System เต็มรูปแบบ

---

# Current Prototype Scope

Prototype ปัจจุบันรองรับ:

## Web Chat Interface

* AI Chat
* Suggested Questions
* Conversation History
* Voice Typing (STT)
* Voice Reply (TTS)

## Telegram Integration

* Telegram Notification
* Admin Takeover
* Human Handover
* Real-time Reply Sync

## AI Workflow

* Intent Classification
* RAG Retrieval
* AI Response Generation
* Accuracy Guardrails

---

# Core Products in Scope

Prototype รองรับคำถามเกี่ยวกับผลิตภัณฑ์หลักของ Payso อย่างน้อย 3 ส่วน ได้แก่:

* Payment Gateway
* E-Link
* Payment Integration / API

อ้างอิงข้อมูลจาก:

* payso.co/th
* FAQ
* Product Information
* Knowledge Chunks ภายในระบบ

---

# System Architecture

User
↓
Web Chat
↓
/api/chat
↓
Intent Classification
↓
RAG Retrieval
↓
LLM Processing
↓
Accuracy Guardrails
↓
AI Response
↓
Supabase Logging
↓
Optional Human Handover (Telegram)

---

# Tech Stack

## Frontend

* Next.js 14
* React
* Tailwind CSS
* TypeScript

## Backend

* Next.js API Routes
* Supabase
* PostgreSQL

## AI / LLM

* OpenRouter
* GPT-based Models

## Infrastructure

* Vercel
* Telegram Bot API

---

# Part 1 — Knowledge Engineering & Logic

## RAG Architecture

Prototype ใช้ Retrieval-Augmented Generation (RAG) เพื่อช่วยให้ AI ตอบจากข้อมูลจริงแทนการสร้างคำตอบขึ้นเอง

Workflow:

1. ดึงข้อมูลจาก payso.co/th
2. แบ่งข้อมูลเป็น Knowledge Chunks
3. สร้าง Embedding
4. จัดเก็บใน Supabase
5. ค้นหาด้วย Semantic Search
6. Inject Context เข้า Prompt ก่อนส่งเข้า LLM

แนวทางนี้ช่วย:

* ลด Hallucination
* เพิ่มความแม่นยำ
* ควบคุมข้อมูลในระดับธุรกิจ Fintech

---

## Accuracy Guardrails

Prototype มี Guardrails เพื่อป้องกัน AI ตอบผิดหรือสร้างข้อมูลธุรกิจขึ้นเอง

### Current Guardrails

* AI ตอบเฉพาะข้อมูลที่ค้นเจอจาก Context
* ไม่สร้าง Promotion หรือ Discount เอง
* ไม่สร้างข้อมูลค่าธรรมเนียมที่ไม่มีจริง
* จำกัด Scope ของคำตอบ

หาก AI ไม่มั่นใจ:

* ตอบแบบ Conservative
* หรือ Trigger Human Handover

---

## Intent Classification

ระบบใช้ AI เพื่อแยกประเภทคำถามก่อนเข้าสู่ Workflow

### Product Information

เช่น:

* “Payso มีบริการอะไรบ้าง”
* “E-Link คืออะไร”

→ ใช้ RAG Retrieval

### Technical Issue

เช่น:

* “Webhook ไม่ทำงาน”
* “เชื่อม API ไม่ได้”

→ Technical Support Flow

### Human Support

เช่น:

* “ขอคุยกับเจ้าหน้าที่”

→ Trigger Human Handover

---

# Part 2 — Workflow & System Design

## Omni-channel Journey

Conversation State ถูกจัดเก็บใน Supabase

ทำให้ระบบสามารถ:

* เริ่มจาก Web Chat
* ต่อไป Telegram
* และรองรับการต่อยอด Voice Workflow ในอนาคต

โดยยังคง Conversation Context เดิมไว้ได้

---

## Voice Integration (Current Demo)

### Web Interface (app/page.tsx)

Prototype รองรับ Voice Interaction ผ่าน Browser API

### Speech-to-Text (STT)

ใช้:

* `window.webkitSpeechRecognition`

สำหรับ:

* แปลงเสียงพูดเป็นข้อความ
* รองรับภาษาไทยและอังกฤษ

### Text-to-Speech (TTS)

ใช้:

* `window.speechSynthesis`

สำหรับ:

* อ่านข้อความตอบกลับจาก AI

---

## Current Limitations

### Browser Dependency

คุณภาพของ STT/TTS ขึ้นอยู่กับ Browser ของผู้ใช้

เช่น:

* Chrome รองรับดีที่สุด
* Browser บางตัวอาจไม่รองรับเต็มรูปแบบ

### Thai Voice Quality

เสียงภาษาไทยจาก Browser TTS อาจยังไม่เป็นธรรมชาติเท่า Production-grade Voice AI

### Telegram Voice Support

ปัจจุบัน Telegram Bot (`app/api/telegram/route.ts`) รองรับเฉพาะ:

* Text Message
* Admin Reply
* Human Handover

ยังไม่รองรับ:

* Voice Message
* Real-time Voice Processing

---

## Human Handover

ระบบส่งต่อ Human Agent เมื่อ:

* AI Confidence ต่ำ
* พบคำถามนอก Scope
* Technical Escalation
* Sensitive Business Questions
* User ต้องการคุยกับเจ้าหน้าที่

Workflow:

1. ส่ง Notification เข้า Telegram
2. Admin กดรับแชท
3. AI หยุดตอบ
4. Admin ตอบผ่าน Telegram
5. Sync กลับ Web Chat แบบ Real-time

---

# Part 3 — Brand Experience

Prototype ถูกออกแบบให้สอดคล้องกับแนวทางของ Payso ตามโจทย์ Assessment 

## Current UI Direction

* Minimal UI
* Clean Fintech Layout
* Thai-first UX
* Professional Tone

## Typography

ปัจจุบันใช้:

* Noto Sans Thai

และอ้างอิงแนวทาง:

* Aktiv Grotesk Thai

## Design Direction

Prototype เริ่มออกแบบโดยอ้างอิง:

* Glassmorphism Style
* Modern Fintech UI

แต่ยังไม่ใช่ Final Brand Production Design

---

# Part 4 — Functional Prototype

## Live Demo

(ใส่ URL ของ Vercel Deployment)

---

## Test Playbook

### Test 1

“Payso มีบริการอะไรบ้าง”

### Test 2

“E-Link เหมาะกับธุรกิจแบบไหน”

### Test 3

“Payso เชื่อมต่อ API ได้ไหม”

### Test 4

“Webhook ไม่ทำงานต้องทำยังไง”

### Test 5

“ขอคุยกับเจ้าหน้าที่”

---

# Part 5 — Strategic Judgment Scenario

## กรณี AI เสนอส่วนลด 5% ที่ไม่มีจริง

Failure หลักเกิดจาก:

* Prompt Control
* Missing Business Validation
* Insufficient Guardrails

AI พยายามช่วยลูกค้ามากเกินไปจนสร้างข้อมูลที่ไม่มีจริง

---

## วิธีแก้ไข

### Restrict Financial Claims

AI ห้ามสร้าง:

* Promotion
* Discount
* Pricing Policy

หากไม่มีข้อมูลใน Knowledge Base

### Add Business Validation Layer

เพิ่ม Validation ก่อนส่งข้อความออก

### Human Escalation

เรื่อง:

* ราคา
* ค่าธรรมเนียม
* Refund
* Sensitive Financial Topics

ควรให้ Human Review ได้

---

## Balancing AI Autonomy vs Business Control

แนวคิดหลักของระบบคือ:

AI มีอิสระในการ “อธิบาย”
แต่ไม่มีอิสระในการ “สร้างนโยบายธุรกิจ”

AI ควรช่วย:

* Speed
* Clarity
* Customer Experience

แต่ Business Rules ต้องถูกควบคุมโดยระบบเสมอ

---

# Part 6 — AI Usage & Tool Reflection

## Tools Used

* ChatGPT
* Gemini
* OpenRouter
* NotebookLM
* Codex CLI

---

## AI ช่วยเร่งงานด้านใด

AI ช่วย:

* Generate Prompt
* Refactor Code
* ออกแบบ Workflow
* สรุป Knowledge Structure
* เร่งการทำ Prototype

---

## จุดที่ต้อง Manual Review

ต้องตรวจสอบด้วยตัวเองในเรื่อง:

* Fintech Accuracy
* Prompt Safety
* Hallucination
* Human Handover Logic
* Business Constraints

เพราะ AI ยังมีโอกาส:

* เดาข้อมูล
* ตอบเกิน Scope
* สร้าง Business Logic ที่ผิดพลาด

---

# Future Roadmap

Prototype นี้ถูกออกแบบให้สามารถต่อยอดเป็น Production AI Support Platform ได้ในอนาคต

## Planned Improvements

### Production-grade Voice AI

วางแผนต่อยอดไปใช้:

* OpenAI Realtime API
* Deepgram
* ElevenLabs

เพื่อ:

* ลด Latency
* เพิ่มความแม่นยำภาษาไทย
* ทำให้เสียงเป็นธรรมชาติมากขึ้น

---

### Advanced RAG Pipeline

วางแผนเพิ่ม:

* Better Chunking
* Knowledge Versioning
* Semantic Re-ranking
* Cached Retrieval

---

### Multi-channel Support

รองรับ:

* LINE OA
* Telegram Voice
* CRM Integration
* Voice Call Workflow

---

### AI Governance

เพิ่มระบบ:

* Financial Validation
* Policy Enforcement
* Confidence Scoring
* AI Audit Logging

เพื่อรองรับมาตรฐานระดับ Production Fintech

---

# Core Philosophy

> AI ต้องเร็วพอสำหรับลูกค้า
> แม่นพอสำหรับ Fintech
> และควบคุมได้พอสำหรับธุรกิจ
