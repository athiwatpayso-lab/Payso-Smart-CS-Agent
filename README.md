# Payso Smart CS Agent (PoC)

AI-driven Customer Success Agent สำหรับธุรกิจ Fintech
Prototype สำหรับระบบ Customer Support อัตโนมัติของ Payso

---

# Project Objective

โปรเจคนี้ถูกพัฒนาขึ้นเพื่อจำลองระบบ AI Customer Success Agent สำหรับ Payso
โดยมีเป้าหมายหลักคือ:

* ลดภาระงาน Customer Support ที่เป็นคำถามซ้ำ ๆ
* ให้บริการลูกค้าได้ตลอด 24 ชั่วโมง
* เพิ่มความเร็วในการตอบคำถามเกี่ยวกับผลิตภัณฑ์และการเชื่อมต่อระบบ
* ควบคุมความถูกต้องของข้อมูลในระดับธุรกิจ Fintech
* รองรับ Human Handover เมื่อ AI ไม่ควรตอบเอง

Prototype นี้ออกแบบตามโจทย์ในเอกสาร Payso Innovation Support Assessment 

---

# Scope ของ Prototype

ระบบสามารถตอบคำถามเกี่ยวกับผลิตภัณฑ์หลักของ Payso อย่างน้อย 3 ส่วน ได้แก่:

* Payment Gateway
* E-Link
* Payment Integration / API

รองรับ:

* Web Chat
* Telegram Human Handover
* RAG-based Knowledge Retrieval
* AI Intent Classification
* Voice Workflow Simulation (STT → LLM → TTS)

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

# Part 1 — Knowledge Engineering & Logic

## RAG Architecture

ระบบใช้ Retrieval-Augmented Generation (RAG) เพื่อให้ AI ตอบจากข้อมูลจริงบนเว็บไซต์ Payso แทนการ “คิดเอง”

## Workflow

1. ดึงข้อมูลจาก payso.co/th
2. แปลงข้อมูลเป็น Knowledge Chunks
3. สร้าง Embeddings
4. เก็บลง Supabase Vector Database
5. ค้นหาข้อมูลด้วย Semantic Search
6. Inject Context เข้า Prompt ก่อนส่งเข้า LLM

## จุดประสงค์

* ลด Hallucination
* เพิ่มความแม่นยำ
* ควบคุมคำตอบในระดับ Fintech
* รองรับการอัปเดตข้อมูลในอนาคต

---

## Accuracy Guardrails

ระบบป้องกัน AI Hallucination ผ่านหลายชั้น:

### 1. Grounded Context Only

AI ตอบได้เฉพาะข้อมูลที่ค้นเจอจาก Knowledge Base

### 2. No Unsupported Claims

ห้าม AI สร้าง:

* โปรโมชั่น
* ส่วนลด
* ค่าธรรมเนียม
* Feature
  ที่ไม่มีในเอกสารจริง

### 3. Confidence Threshold

หากคะแนนความมั่นใจต่ำ:

* ไม่ตอบแบบมั่ว
* Trigger Human Handover

### 4. Prompt Constraints

System Prompt บังคับว่า:

* ห้ามเดาข้อมูล
* ห้ามสร้าง Business Policy ใหม่
* Prioritize Accuracy > Creativity

---

## Intent Classification

ระบบแบ่งประเภทคำถามก่อนส่งเข้า Workflow

### Product Information

เช่น:

* Payso มีบริการอะไร
* E-Link คืออะไร

→ ใช้ RAG Retrieval

### Technical Issue

เช่น:

* เชื่อม API ไม่ได้
* Webhook ไม่ทำงาน

→ Trigger Technical Support Flow

### Human Support

เช่น:

* ขอคุยกับเจ้าหน้าที่
* ลูกค้าไม่พอใจ

→ ส่งต่อ Human Handover

---

# Part 2 — Workflow & System Design

## Omni-channel Journey

Conversation State ถูกเก็บใน Supabase

ทำให้สามารถ:

* เริ่มจาก Web Chat
* ต่อไป Telegram
* หรือ Voice Call
  โดยยังคง Context เดิมได้

---

## Voice Integration

Voice Workflow:

Speech-to-Text (STT)
↓
Intent Detection
↓
RAG Retrieval
↓
LLM Response
↓
Text-to-Speech (TTS)

### Latency Optimization

* Streaming Response
* Lightweight Prompt
* Cached Retrieval
* Fast TTS Model

เพื่อให้เสียงตอบกลับดูเป็นธรรมชาติและไม่ Delay

---

## Human Handover

ระบบส่งต่อ Human Agent เมื่อ:

* Confidence ต่ำ
* พบคำถามนอก Scope
* User Frustration สูง
* Technical Escalation
* Payment-sensitive Request

Telegram ใช้เป็น Admin Console สำหรับรับช่วงการสนทนา

เมื่อ Admin Takeover:

* AI จะหยุดตอบ
* Admin ตอบกลับผ่าน Telegram
* Sync กลับ Web Chat แบบ Real-time

---

# Part 3 — Brand Experience

Prototype ถูกออกแบบให้สอดคล้องกับแนวทางของ Payso:

* Minimal UI
* Glassmorphism Style
* Clean Fintech Layout
* Thai-first UX
* Professional Tone

Typography:

* Noto Sans Thai
* Aktiv Grotesk Thai (Reference)

AI Persona:

* Professional
* Helpful
* Clear
* Non-salesy

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

### ส่วนที่ผิดพลาด

Failure เกิดที่:

* Prompt Control
* Business Rule Validation
* Missing Guardrails

AI พยายาม “ช่วยลูกค้า” มากเกินไป จนสร้างข้อมูลที่ไม่มีจริง

---

## วิธีแก้ไข

### 1. Restrict Financial Claims

AI ห้ามสร้าง:

* Promotion
* Discount
* Pricing Policy

หากไม่มีข้อมูลใน Knowledge Base

### 2. Add Business Validation Layer

ตรวจสอบข้อความก่อนส่งออก

### 3. Escalate Sensitive Topics

เรื่อง:

* ราคา
* ค่าธรรมเนียม
* การเงิน
* Refund
  ให้ Human Review ได้

---

## Balancing AI Autonomy vs Business Control

แนวคิดหลักคือ:

AI มีอิสระในการ “อธิบาย”
แต่ไม่มีอิสระในการ “สร้างนโยบายธุรกิจ”

AI ควรช่วยเรื่อง:

* Speed
* Clarity
* Conversation Flow

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

* สร้าง Workflow
* Refactor Code
* Generate Prompt
* สรุป Knowledge Structure
* Prototype Faster

---

## จุดที่ต้องแก้ไขด้วยตัวเอง

ต้อง Manual Review ในเรื่อง:

* Fintech Accuracy
* Prompt Safety
* Hallucination
* Human Handover Logic
* Business Constraints

เพราะ AI ยังมีโอกาส:

* เดาข้อมูล
* ตอบเกิน Scope
* สร้าง Logic ทางธุรกิจผิดพลาด

---

# Core Philosophy

> AI ต้องเร็วพอสำหรับลูกค้า
> แม่นพอสำหรับ Fintech
> และควบคุมได้พอสำหรับธุรกิจ
