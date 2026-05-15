import type { Intent } from "@/lib/intent-classifier";

export type PromptContextItem = {
  title: string;
  content: string;
  sourceUrl: string;
};

const NOISY_CONTEXT_PATTERNS = [
  /skip to main content/gi,
  /powered by react/gi,
  /plugins?\s*&\s*modules?/gi,
  /main menu/gi,
  /navigation/gi,
  /footer/gi,
  /copyright/gi,
];

const NOISY_CONTEXT_LINES = new Set([
  "skip to main content",
  "powered by react",
  "home",
  "about",
  "products",
  "contact",
  "help",
  "menu",
  "navigation",
]);

export function detectLanguage(question: string): "th" | "en" {
  return /[\u0E00-\u0E7F]/.test(question) ? "th" : "en";
}

function cleanContextText(title: string, content: string): string {
  let cleaned = content;

  for (const pattern of NOISY_CONTEXT_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  const normalizedTitle = title.replace(/\s+/g, " ").trim().toLowerCase();
  const lines = cleaned
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => {
      const normalizedLine = line.toLowerCase();

      if (NOISY_CONTEXT_LINES.has(normalizedLine)) {
        return false;
      }

      return normalizedLine !== normalizedTitle;
    });

  const dedupedLines = lines.filter((line, index) => {
    const normalizedLine = line.toLowerCase();
    return lines.findIndex((candidate) => candidate.toLowerCase() === normalizedLine) === index;
  });

  return dedupedLines.join(" ").replace(/\s+/g, " ").trim();
}

export function sanitizeRetrievedContext(context: PromptContextItem[]): PromptContextItem[] {
  const seen = new Set<string>();

  return context
    .map((item) => ({
      ...item,
      title: item.title.replace(/\s+/g, " ").trim(),
      content: cleanContextText(item.title, item.content),
    }))
    .filter((item) => item.content.length >= 40)
    .filter((item) => {
      const signature = `${item.sourceUrl}::${item.content.toLowerCase()}`;

      if (seen.has(signature)) {
        return false;
      }

      seen.add(signature);
      return true;
    });
}

export function buildPaysoPrompt(params: {
  question: string;
  context: PromptContextItem[];
  intent: Intent;
  language: "th" | "en";
}) {
  const contextBlock =
    params.context.length > 0
      ? params.context
          .slice(0, 3)
          .map((item) => `${item.title}\n${item.content.slice(0, 500)}`)
          .join("\n\n")
      : "No verified Payso context was retrieved.";

  const systemPrompt = `
You are a professional Payso customer support agent.
Your job is to help merchants and customers solve payment, signup, API, dashboard, and service issues quickly and politely.
Use only the provided Payso context.
Answer Thai first unless the user clearly writes in English.
Sound like a real senior CS agent: concise, calm, helpful, polite, and service-minded.
Focus on solving the issue. Do not explain internal system logic or internal workflow.
Never quote or paste raw website text, navigation labels, footer text, duplicated headings, or scraped page chrome.
Never expose retrieved chunks directly.
If information is missing, ask only for the minimum details needed to continue.
If the issue cannot be solved safely by chat, recommend staff handover naturally.
For payment or technical issues, start with a brief apology, do not guess the exact cause, and ask only the necessary troubleshooting questions.
When relevant for payment or technical issues, ask for payment channel, error message or screenshot, transaction time, and reference number or slip if available.
For payment or technical issues, prefer a natural support format with one short apology line, 3 to 4 short bullet questions, and one short closing line that says you will help check or coordinate further.
For broad questions about Payso, give a short practical answer from the context.
If context is partial, answer with verified details first, then ask for what is still needed.
If context is missing, say that you need a little more information or recommend contacting staff.
Do not use general knowledge or invent fees, pricing, promotions, SLAs, refund timing, discounts, or unsupported features.
Do not show source titles, raw URLs, citation numbers, bracket references, or mention classification labels.
Avoid corporate/documentation style, long explanations, marketing tone, internal workflow wording, or phrases like "ระบบ AI จะจำแนก", "กรณีนี้เป็น Technical Issue", or "ผมตอบคำถามทั่วไปได้ครับ".
`.trim();

  const userPrompt = `
User language: ${params.language}
Classified intent: ${params.intent}
User question: ${params.question}

Retrieved Payso context:
${contextBlock}

Instructions:
- Answer strictly from the context above.
- Keep the answer brief and easy to skim.
- Write a short Thai support answer followed by 2 to 4 bullet points when the user writes in Thai.
- Do not mention sources in the answer.
- Do not paste raw URLs in the answer.
- Do not repeat page titles, menus, footer blocks, or scraped website text.
- If the user asks about API, clearly say that Payso supports API connection, explain suitable use cases briefly, and mention documentation or developer guidance when present in context.
- If official information is weak, answer with the useful verified details that are available, then ask one short follow-up question or suggest Payso staff support.
- For general questions such as "Payso คืออะไร" or "What is Payso?", summarize the most relevant official context first.
- For payment or technical issues, apologize briefly, ask only necessary troubleshooting questions, and offer staff follow-up when needed.
- For unclear or sensitive cases, end with a brief safe next step.
`.trim();

  return {
    systemPrompt,
    userPrompt,
  };
}
