import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const knowledgePath = resolve(process.cwd(), "data", "payso-knowledge.json");
const knowledgeJson = await readFile(knowledgePath, "utf8");
const knowledgeItems = JSON.parse(knowledgeJson);

if (!Array.isArray(knowledgeItems)) {
  console.error("Knowledge base file is not an array.");
  process.exit(1);
}

const rows = knowledgeItems.map((item) => ({
  id: item.id,
  product: item.product,
  category: item.category,
  title: item.title,
  content: item.content,
  source_url: item.sourceUrl,
  keywords: Array.isArray(item.keywords) ? item.keywords : [],
}));

for (let index = 0; index < rows.length; index += 100) {
  const batch = rows.slice(index, index + 100);
  const { error } = await supabase.from("knowledge_chunks").upsert(batch, {
    onConflict: "id",
  });

  if (error) {
    console.error(`Failed to sync batch ${index / 100 + 1}:`, error.message);
    process.exit(1);
  }
}

console.log(`Synced ${rows.length} knowledge chunks to Supabase.`);
