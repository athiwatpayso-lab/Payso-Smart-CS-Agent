import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type KnowledgeChunk = {
  id: string;
  product: string;
  category: string;
  title: string;
  content: string;
  sourceUrl: string;
  keywords: string[];
};

type PageConfig = {
  slug: string;
  product: string;
  category: string;
  title: string;
  sourceUrl: string;
  keywords: string[];
};

const ROOT = process.cwd();
const RAW_DIR = resolve(ROOT, "data", "raw");
const PROCESSED_DIR = resolve(ROOT, "data", "processed");
const CHUNKS_DIR = resolve(ROOT, "data", "chunks");
const OUTPUT_PATH = resolve(CHUNKS_DIR, "payso-knowledge.json");

const PAGE_CONFIGS: Record<string, PageConfig> = {
  "tmp_home.txt": {
    slug: "home",
    product: "Payso",
    category: "Overview",
    title: "Payso Home",
    sourceUrl: "https://payso.co/th",
    keywords: ["payso", "payment gateway", "ระบบรับชำระเงิน", "ออนไลน์", "หน้าร้าน"],
  },
  "tmp_about-us.txt": {
    slug: "about-us",
    product: "Payso",
    category: "Company Info",
    title: "About Payso",
    sourceUrl: "https://payso.co/th/about-us",
    keywords: ["about", "company", "vision", "mission", "payso"],
  },
  "tmp_contact.txt": {
    slug: "contact",
    product: "Payso",
    category: "Support",
    title: "Payso Contact",
    sourceUrl: "https://payso.co/th/contact",
    keywords: ["contact", "support", "ติดต่อ", "ทีมงาน"],
  },
  "tmp_e-payment.txt": {
    slug: "e-payment",
    product: "e-Payment",
    category: "Product Info",
    title: "Payso e-Payment",
    sourceUrl: "https://payso.co/th/e-payment",
    keywords: ["e-payment", "payment gateway", "website", "application", "api"],
  },
  "tmp_epayment.txt": {
    slug: "e-payment-alt",
    product: "e-Payment",
    category: "Product Info",
    title: "Payso e-Payment",
    sourceUrl: "https://payso.co/th/e-payment",
    keywords: ["e-payment", "payment gateway", "website", "application", "api"],
  },
  "tmp_payment-link.txt": {
    slug: "payment-link",
    product: "Payment Link",
    category: "Product Info",
    title: "Payso Payment Link",
    sourceUrl: "https://payso.co/th/payment-link",
    keywords: ["payment link", "social commerce", "line", "facebook", "instagram"],
  },
  "tmp_edc.txt": {
    slug: "edc",
    product: "Swiping Machine (EDC)",
    category: "Product Info",
    title: "Payso EDC",
    sourceUrl: "https://payso.co/th/edc",
    keywords: ["edc", "swiping machine", "หน้าร้าน", "card machine"],
  },
  "tmp_help.txt": {
    slug: "help",
    product: "Payso",
    category: "FAQ",
    title: "Payso Help",
    sourceUrl: "https://payso.co/th/help",
    keywords: ["faq", "help", "support", "คำถามที่พบบ่อย"],
  },
  "tmp_how-to-register.txt": {
    slug: "how-to-register",
    product: "Payso",
    category: "Onboarding",
    title: "How to Register with Payso",
    sourceUrl: "https://payso.co/th/how-to-register",
    keywords: ["register", "สมัคร", "onboarding", "ยืนยันตัวตน"],
  },
  "tmp_payment-fee-calculator.txt": {
    slug: "payment-fee-calculator",
    product: "Payso",
    category: "Pricing Sensitive",
    title: "Payso Payment Fee Calculator",
    sourceUrl: "https://payso.co/th/payment-fee-calculator",
    keywords: ["fee", "pricing", "calculator", "ค่าธรรมเนียม"],
  },
  "tmp_api-overview.txt": {
    slug: "api-overview",
    product: "Payso",
    category: "Integration",
    title: "Payso API Overview",
    sourceUrl: "https://api-docs.payso.co/docs/api/overviews",
    keywords: ["api", "integration", "developer", "overview"],
  },
};

const NOISE_LINES = new Set([
  "-->",
  "ไทย",
  "English",
  "เข้าสู่ระบบ",
  "สมัครสมาชิก",
  "สมัครใช้บริการ",
  "ผลิตภัณฑ์",
  "ฟีเจอร์การใช้งาน",
  "นักพัฒนา",
  "ข่าวและบทความ",
  "แหล่งข้อมูล",
  "เกี่ยวกับเรา",
]);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").replace(/[ \t]+/g, " ").trim();
}

function shouldKeepLine(line: string): boolean {
  if (!line) {
    return false;
  }

  if (NOISE_LINES.has(line)) {
    return false;
  }

  if (/^(ดูรายละเอียด|เริ่มต้นใช้งานฟรี|pay\.sn|\/|mystore)$/i.test(line)) {
    return false;
  }

  return line.length > 1;
}

function cleanContent(rawText: string): string[] {
  const lines = rawText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(shouldKeepLine);

  const deduped: string[] = [];

  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }

  return deduped;
}

function splitIntoChunks(lines: string[]): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current} ${line}` : line;

    if (next.length > 650 && current.length >= 220) {
      chunks.push(current.trim());
      current = line;
      continue;
    }

    current = next;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter((chunk) => chunk.length >= 120);
}

function extractTitle(config: PageConfig, chunk: string, index: number): string {
  const sentences = chunk.split(/(?<=[.!?])\s+|(?<=।)\s+|(?<=\?)\s+|(?<=\u0E2F)\s+/u);
  const first = sentences[0]?.trim() || "";

  if (first && first.length <= 90) {
    return first;
  }

  return `${config.title} ${index + 1}`;
}

function extractKeywords(config: PageConfig, chunk: string): string[] {
  const haystack = chunk.toLowerCase();
  const matched = config.keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
  const all = [...new Set([...matched, ...config.keywords.slice(0, 4)])];
  return all.slice(0, 8);
}

async function ensureDirectories() {
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(PROCESSED_DIR, { recursive: true });
  await mkdir(CHUNKS_DIR, { recursive: true });
}

async function buildKnowledgeChunks() {
  await ensureDirectories();

  const fileNames = (await readdir(RAW_DIR))
    .filter((fileName) => fileName.endsWith(".txt"))
    .sort((left, right) => left.localeCompare(right));

  const allChunks: KnowledgeChunk[] = [];

  for (const fileName of fileNames) {
    const config = PAGE_CONFIGS[fileName];

    if (!config) {
      console.warn(`Skipping unmapped raw file: ${fileName}`);
      continue;
    }

    const filePath = resolve(RAW_DIR, fileName);
    const rawText = await readFile(filePath, "utf8");
    const cleanedLines = cleanContent(rawText);
    const processedText = cleanedLines.join("\n");

    await writeFile(resolve(PROCESSED_DIR, `${config.slug}.txt`), `${processedText}\n`, "utf8");

    const chunks = splitIntoChunks(cleanedLines);

    chunks.forEach((content, index) => {
      allChunks.push({
        id: `${config.slug}-${String(index + 1).padStart(3, "0")}`,
        product: config.product,
        category: config.category,
        title: extractTitle(config, content, index),
        content,
        sourceUrl: config.sourceUrl,
        keywords: extractKeywords(config, content),
      });
    });
  }

  await writeFile(OUTPUT_PATH, `${JSON.stringify(allChunks, null, 2)}\n`, "utf8");
  console.log(`Built ${allChunks.length} knowledge chunks at ${OUTPUT_PATH}`);
}

void buildKnowledgeChunks();
