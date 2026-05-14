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

const knowledgeFiles = ["payso-knowledge.json", "payso-knowledge-v2.json", "payso-faq.json"];

function isKnowledgeItem(item) {
  return (
    item &&
    typeof item.id === "string" &&
    typeof item.product === "string" &&
    typeof item.category === "string" &&
    typeof item.title === "string" &&
    typeof item.content === "string" &&
    typeof item.sourceUrl === "string" &&
    Array.isArray(item.keywords) &&
    item.keywords.every((keyword) => typeof keyword === "string")
  );
}

const knowledgeItems = [];

for (const fileName of knowledgeFiles) {
  const knowledgePath = resolve(process.cwd(), "data", fileName);
  const knowledgeJson = await readFile(knowledgePath, "utf8");
  const parsedItems = JSON.parse(knowledgeJson);

  if (!Array.isArray(parsedItems)) {
    console.error(`${fileName} is not an array.`);
    process.exit(1);
  }

  const validItems = parsedItems.filter(isKnowledgeItem);
  const skippedItems = parsedItems.length - validItems.length;

  if (skippedItems > 0) {
    console.warn(`Skipped ${skippedItems} invalid items from ${fileName}.`);
  }

  knowledgeItems.push(...validItems);
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
    if (error.message.includes('no field "updated_at"')) {
      console.warn("Upsert failed because the remote updated_at trigger is out of sync. Inserting new chunks only.");

      const { error: insertError } = await supabase.from("knowledge_chunks").upsert(batch, {
        onConflict: "id",
        ignoreDuplicates: true,
      });

      if (!insertError) {
        continue;
      }

      console.error(`Failed to insert batch ${index / 100 + 1}:`, insertError.message);
      process.exit(1);
    }

    console.error(`Failed to sync batch ${index / 100 + 1}:`, error.message);
    process.exit(1);
  }
}

console.log(`Synced ${rows.length} knowledge chunks to Supabase.`);
