import rawKnowledgeBase from "@/data/payso-knowledge.json";

export type KnowledgeItem = {
  id: string;
  product: string;
  category: string;
  title: string;
  content: string;
  sourceUrl: string;
  keywords: string[];
};

function isKnowledgeItem(value: unknown): value is KnowledgeItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.product === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.content === "string" &&
    typeof candidate.sourceUrl === "string" &&
    Array.isArray(candidate.keywords) &&
    candidate.keywords.every((keyword) => typeof keyword === "string")
  );
}

let cachedKnowledgeBase: KnowledgeItem[] | null = null;

export function getKnowledgeBase(): KnowledgeItem[] {
  if (cachedKnowledgeBase) {
    return cachedKnowledgeBase;
  }

  try {
    const parsed = Array.isArray(rawKnowledgeBase) ? rawKnowledgeBase : [];

    cachedKnowledgeBase = parsed.filter(isKnowledgeItem);
    return cachedKnowledgeBase;
  } catch {
    cachedKnowledgeBase = [];
    return cachedKnowledgeBase;
  }
}
