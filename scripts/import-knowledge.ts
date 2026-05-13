import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getSupabaseAdmin } from "../lib/supabase/admin";

type KnowledgeRecord = {
  id: string;
  product: string;
  category: string;
  title: string;
  content: string;
  sourceUrl: string;
  keywords: string[];
};

function isKnowledgeRecord(value: unknown): value is KnowledgeRecord {
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

async function main() {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), "data", "chunks", "payso-knowledge.json");
  const fileContent = await readFile(filePath, "utf8");
  const parsed = JSON.parse(fileContent);

  if (!Array.isArray(parsed)) {
    console.error("data/chunks/payso-knowledge.json is not an array.");
    process.exit(1);
  }

  const rows = parsed.filter(isKnowledgeRecord).map((item) => ({
    id: item.id,
    product: item.product,
    category: item.category,
    title: item.title,
    content: item.content,
    source_url: item.sourceUrl,
    keywords: item.keywords,
  }));

  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    const { error } = await supabase.from("knowledge_chunks").upsert(batch, {
      onConflict: "id",
    });

    if (error) {
      console.error(`Failed to import batch ${index / 100 + 1}:`, error.message);
      process.exit(1);
    }
  }

  console.log(`Imported ${rows.length} records into knowledge_chunks.`);
}

void main();
