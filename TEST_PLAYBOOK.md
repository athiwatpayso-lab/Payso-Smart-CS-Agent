# Test Playbook

## Local Start
Run:

```powershell
.\start-dev.ps1
```

If that is blocked by execution policy, run with process-local bypass:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

## Basic App Checks
1. Open the home page.
2. Confirm the landing page renders correctly.
3. Scroll to the chat section.
4. Confirm suggested questions are visible.

## Chat Scenarios

### Greeting
Ask:
- `สวัสดี`

Expected:
- short greeting answer
- no crash
- no raw URLs in answer text

### Product Info
Ask:
- `Payment Link คืออะไร`
- `Payso มีบริการอะไรบ้าง`

Expected:
- concise Payso-related answer
- source links appear separately under the answer

### Integration
Ask:
- `Payso เชื่อมต่อผ่าน API ได้ไหม`

Expected:
- answer references integration capability
- source links are clickable and open in a new tab

### Sensitive / Handover
Ask:
- `ลูกค้าจ่ายเงินแล้วแต่ร้านหาไม่เจอ ต้องทำยังไง`

Expected:
- cautious answer
- handover recommendation when applicable
- handover case stored if Supabase is configured

### Unknown / Missing Knowledge
Ask:
- a question not covered by Payso knowledge

Expected:
- safe fallback answer
- no fabricated details

## Data Checks
If Supabase is configured, verify:
- `conversations` gets a row
- `chat_messages` gets user and assistant rows
- `chat_logs` gets a lightweight log row
- `handover_cases` appears only for handover-worthy cases
- `question_enrichment_queue` captures repeated / useful unknown questions

## Build Check
Run:

```powershell
npm run build
```

Note:
- build may fail in restricted environments if external fonts cannot be fetched.
