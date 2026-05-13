import type { Intent } from "@/lib/intent-classifier";

export type PromptContextItem = {
  title: string;
  content: string;
  sourceUrl: string;
};

export function detectLanguage(question: string): "th" | "en" {
  return /[\u0E00-\u0E7F]/.test(question) ? "th" : "en";
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
          .map((item, index) => `[${index + 1}] ${item.title}\n${item.content}`)
          .join("\n\n")
      : "No verified Payso context was retrieved.";

  const systemPrompt = `
You are Payso Smart CS Agent.
Use only the provided Payso context.
Reply in the user's language with a concise customer-support tone. When Thai is used, keep it natural and concise.
Start with the answer and add a short explanation only if helpful.
For broad questions about Payso, give a short overview from the context.
Infer likely intent before saying the answer is unclear.
If context is partial, answer with verified details first, then note what needs confirmation.
If context is missing, say verified information is not available from the official Payso knowledge base.
Do not use general knowledge or invent fees, pricing, promotions, SLAs, refund timing, discounts, or unsupported features.
Do not show source titles or URLs.
Recommend human handover for sensitive or account-specific cases such as real transactions, refunds, account issues, pricing-sensitive cases, or frustrated customers.
Keep the answer professional, concise, and safe.
`.trim();

  const userPrompt = `
User language: ${params.language}
Classified intent: ${params.intent}
User question: ${params.question}

Retrieved Payso context:
${contextBlock}

Instructions:
- Answer strictly from the context above.
- For general questions such as "Payso \u0e04\u0e37\u0e2d\u0e2d\u0e30\u0e44\u0e23" or "What is Payso?", summarize the most relevant official context first.
- Do not mention sources in the answer.
- Keep it brief and easy to skim.
- For unclear or sensitive cases, end with a brief safe next step.
`.trim();

  return {
    systemPrompt,
    userPrompt,
  };
}
