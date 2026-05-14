"use client";

import Image from "next/image";
import {
  ChangeEvent,
  Fragment,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  UIEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type Language = "th" | "en";
type Confidence = "High" | "Medium" | "Low";
type UserProfile = {
  name: string;
  phone: string;
  email: string;
  company: string;
};

type SourceReference = {
  title: string;
  url: string;
};

type AssistantMeta = {
  intent: string;
  confidence: Confidence;
  handover: boolean;
  sources: SourceReference[];
  reason: string;
  suggestions?: string[];
};

type Message = {
  id: string;
  role: "user" | "assistant" | "admin";
  content: string;
  meta?: AssistantMeta;
};

type ChatApiResponse = {
  answer: string;
  intent: string;
  confidence: Confidence;
  handover: boolean;
  sources: SourceReference[];
  reason: string;
  suggestions?: string[];
  conversationId?: string | null;
  messageId?: string | null;
};

type ChatHistoryResponse = {
  messages: Message[];
};

type ParsedMessageLink = {
  label: string;
  url: string;
};

type MarkdownBlock =
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; items: string[] }
  | { type: "code"; code: string; language?: string };

function parseAssistantMessageContent(content: string): {
  body: string;
  links: ParsedMessageLink[];
  relatedQuestions: string[];
} {
  const links: ParsedMessageLink[] = [];
  const relatedQuestions: string[] = [];
  const lines = content.split(/\r?\n/);
  const bodyLines: string[] = [];
  let section: "body" | "links" | "related" = "body";

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (section === "body") {
        bodyLines.push("");
      }
      continue;
    }

    if (/^ดูเพิ่มเติม:/i.test(line)) {
      section = "links";
      continue;
    }

    if (/^คำถามที่เกี่ยวข้อง:/i.test(line)) {
      section = "related";
      continue;
    }

    if (section === "links") {
      const match = line.match(/^-?\s*(.+?):\s*(https?:\/\/\S+)$/i);

      if (match) {
        links.push({
          label: match[1].trim(),
          url: match[2].trim(),
        });
      }

      continue;
    }

    if (section === "related") {
      const match = line.match(/^\d+\.\s*(.+)$/);

      if (match) {
        relatedQuestions.push(match[1].trim());
      }

      continue;
    }

    bodyLines.push(rawLine);
  }

  return {
    body: bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    links,
    relatedQuestions,
  };
}

function normalizeMessageContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function dedupeConsecutiveAssistantMessages(messages: Message[]): Message[] {
  return messages.reduce<Message[]>((deduped, message) => {
    const previous = deduped[deduped.length - 1];
    const isAssistant = message.role === "assistant" || message.role === "admin";
    const previousIsAssistant = previous?.role === "assistant" || previous?.role === "admin";

    if (
      previous &&
      isAssistant &&
      previousIsAssistant &&
      normalizeMessageContent(previous.content) === normalizeMessageContent(message.content)
    ) {
      const previousSuggestions = previous.meta?.suggestions ?? [];
      const nextSuggestions = message.meta?.suggestions ?? [];

      deduped[deduped.length - 1] = {
        ...message,
        meta: message.meta
          ? {
              ...message.meta,
              suggestions: nextSuggestions.length ? nextSuggestions : previousSuggestions,
            }
          : message.meta,
      };

      return deduped;
    }

    deduped.push(message);
    return deduped;
  }, []);
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)|`([^`]+)`|\*\*([^*]+)\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a
          key={`${match.index}-${match[3]}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer noopener"
          className="chat-link"
        >
          {match[2]}
        </a>,
      );
    } else if (match[4]) {
      const url = match[4].replace(/[.,!?;:]+$/u, "");
      const trailing = match[4].slice(url.length);
      nodes.push(
        <Fragment key={`${match.index}-${url}`}>
          <a href={url} target="_blank" rel="noreferrer noopener" className="chat-link">
            {url}
          </a>
          {trailing}
        </Fragment>,
      );
    } else if (match[5]) {
      nodes.push(
        <code key={`${match.index}-${match[5]}`} className="chat-inline-code">
          {match[5]}
        </code>,
      );
    } else if (match[6]) {
      nodes.push(
        <strong key={`${match.index}-${match[6]}`} className="font-semibold">
          {match[6]}
        </strong>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let codeLanguage = "";
  let inCode = false;

  function flushParagraph() {
    if (paragraphLines.length) {
      blocks.push({ type: "paragraph", lines: paragraphLines });
      paragraphLines = [];
    }
  }

  function flushList() {
    if (listItems.length) {
      blocks.push({ type: "list", items: listItems });
      listItems = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const codeFence = line.match(/^```(\w+)?/);

    if (codeFence) {
      if (inCode) {
        blocks.push({ type: "code", code: codeLines.join("\n"), language: codeLanguage || undefined });
        codeLines = [];
        codeLanguage = "";
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLanguage = codeFence[1] ?? "";
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const listMatch = line.match(/^[-•]\s+(.+)$/) ?? line.match(/^\d+\.\s+(.+)$/);

    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  if (inCode) {
    blocks.push({ type: "code", code: codeLines.join("\n"), language: codeLanguage || undefined });
  }

  flushParagraph();
  flushList();

  return blocks;
}

function ChatMarkdown({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  if (!blocks.length) {
    return null;
  }

  return (
    <div className="chat-markdown">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre key={`code-${index}`} className="chat-code-block">
              {block.language ? <span className="chat-code-label">{block.language}</span> : null}
              <code>{block.code}</code>
            </pre>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={`list-${index}`} className="chat-list">
              {block.items.map((item, itemIndex) => (
                <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`paragraph-${index}`}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={`${index}-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderInlineMarkdown(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function PaysoAssistantAvatar() {
  return (
    <div className="chat-avatar chat-avatar-assistant" aria-hidden="true">
      <Image
        src="/brand/payso-primary-logo.png"
        alt=""
        width={52}
        height={52}
        className="chat-avatar-logo"
      />
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="chat-message-row chat-message-row-assistant" aria-live="polite">
      <PaysoAssistantAvatar />
      <div className="chat-bubble chat-bubble-assistant chat-typing-bubble">
        <div className="chat-typing-skeleton">
          <span />
          <span />
        </div>
        <div className="chat-typing-dots" aria-label="Assistant is typing">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: null | (() => void);
  onerror: null | ((event: { error?: string }) => void);
  onresult: null | ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void);
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

const USER_PROFILE_STORAGE_KEY = "payso-chat-user-profile";
const CONVERSATION_STORAGE_KEY = "payso-chat-conversation-id";

const copy = {
  th: {
    langToggle: "ไทย / EN",
    navAbout: "เกี่ยวกับ Payso",
    navProducts: "ผลิตภัณฑ์",
    navChat: "สอบถามข้อมูล",
    heroKicker: "Payso Smart CS Agent",
    heroTitleLine1: "ผู้ช่วยตอบคำถาม",
    heroTitleLine2: "ด้วยข้อมูลและองค์ความรู้อย่างเป็นทางการจาก Payso",
    heroSubtitleTitle: "ต้นแบบฝ่ายบริการลูกค้าที่ตอบจากเว็บไซต์จริง",
    heroBody:
      "ระบบนี้ออกแบบให้ตอบคำถามสินค้า การเชื่อมต่อ การใช้งาน และการสนับสนุนของ Payso โดยอ้างอิงจากข้อมูลสาธารณะบนเว็บไซต์ทางการเท่านั้น และจะแนะนำการส่งต่อเจ้าหน้าที่เมื่อเป็นเคสที่ต้องตรวจสอบจริง",
    heroPrimary: "เริ่มทดสอบระบบ",
    heroSecondary: "ดูข้อมูลแบรนด์",
    aboutTitle: "Payso ผู้บุกเบิก Payment Gateway ของไทยที่ตอบโจทย์ธุรกิจทุกขนาด",
    aboutBody:
      "ยกระดับ AI Chat สำหรับธุรกิจ ด้วย Knowledge Base, Retrieval และ Source Reference ที่ตรวจสอบได้ เพื่อการเข้าถึงข้อมูลที่แม่นยำ โปร่งใส และน่าเชื่อถือสำหรับลูกค้าและทีมงาน",
    storyTitle: "จาก Pay Solutions สู่ Payso",
    storyCards: [
      {
        title: "Built on a strong foundation",
        text: "Payso เติบโตจากประสบการณ์ของผู้ให้บริการระบบชำระเงินที่อยู่กับธุรกิจไทยมาอย่างยาวนาน และสื่อสารตัวตนใหม่ให้ชัดขึ้นในฐานะพาร์ทเนอร์ที่ทันสมัยและใช้งานได้จริง",
      },
      {
        title: "Beyond Payment",
        text: "Payso ไม่ได้วางตัวเองเป็นเพียง payment gateway แต่เป็นระบบที่เชื่อมต่อการขาย การจัดการ และข้อมูลทางธุรกิจทั้งออนไลน์และหน้าร้านเข้าด้วยกัน",
      },
      {
        title: "Growing together",
        text: "แบรนด์สื่อสารเรื่องการเติบโตไปพร้อมกับร้านค้า ตั้งแต่ธุรกิจขนาดเล็กไปจนถึงองค์กรที่ต้องการระบบรับชำระเงินที่เสถียรและปรับใช้ได้ตามบริบทจริง",
      },
    ],
    visionCards: [
      {
        title: "วิสัยทัศน์",
        lead: "\"Growing Together\"",
        text: "มุ่งสู่การเป็นผู้นำด้านระบบชำระเงินที่ช่วยให้ลูกค้า ทีมงาน และธุรกิจเติบโตไปด้วยกันอย่างยั่งยืน",
      },
      {
        title: "พันธกิจ",
        lead: "\"Beyond Payment\"",
        text: "พัฒนาโซลูชันที่เชื่อมการรับเงิน การจัดการ และข้อมูลธุรกิจให้ทำงานร่วมกันได้ทั้งออนไลน์และออฟไลน์",
      },
    ],
    whyChooseTitle: "ทำไมต้องเลือกเรา",
    whyChooseCards: [
      {
        title: "ความปลอดภัยระดับสากล",
        text: "มั่นใจด้วยมาตรฐาน PCI DSS การเข้ารหัสข้อมูล และการดำเนินงานภายใต้กรอบกำกับดูแลที่เหมาะสม",
      },
      {
        title: "รวดเร็วและแม่นยำ",
        text: "ช่วยให้การรับชำระเงินและการจัดการข้อมูลลื่นไหล ลดขั้นตอนซ้ำซ้อน และรองรับการเติบโตของธุรกิจ",
      },
      {
        title: "ครอบคลุมทุกช่องทาง",
        text: "รองรับทั้งออนไลน์และหน้าร้าน พร้อมทางเลือกการชำระเงินที่หลากหลายให้เหมาะกับลูกค้าของคุณ",
      },
      {
        title: "เข้าใจธุรกิจไทย",
        text: "ออกแบบโซลูชันให้ใช้งานได้จริงกับบริบทธุรกิจไทย ทั้งร้านค้าเกิดใหม่และองค์กรที่ต้องการระบบที่เสถียร",
      },
      {
        title: "ประสบการณ์ยาวนาน",
        text: "ต่อยอดจากความเชี่ยวชาญด้านระบบรับชำระเงินและการเชื่อมต่อธุรกิจที่สะสมมาอย่างต่อเนื่อง",
      },
      {
        title: "ใช้ง่าย ติดตั้งไว",
        text: "เริ่มต้นได้ง่ายด้วยตัวเลือกการเชื่อมต่อที่ยืดหยุ่น พร้อมทีมสนับสนุนช่วยให้ใช้งานได้เร็วขึ้น",
      },
    ],
    productsTitle: "ครอบคลุมคำถามหลักของ Payso",
    productsBody:
      "ระบบถูกเตรียมข้อมูลไว้สำหรับคำถามด้านผลิตภัณฑ์ การเชื่อมต่อ ช่องทางชำระเงิน การใช้งาน merchant back office และกรณีสนับสนุนที่มักเกิดขึ้นจริง",
    productCards: [
      {
        title: "e-Payment",
        text: "ตอบเรื่องระบบรับชำระเงินสำหรับเว็บไซต์และแอปพลิเคชัน รวมทั้งรูปแบบการเชื่อมต่อและช่องทางชำระเงินที่รองรับ",
      },
      {
        title: "Payment Link",
        text: "รองรับคำถามเรื่องการขายผ่านแชต โซเชียลมีเดีย การสร้างลิงก์ และรูปแบบการใช้งานสำหรับร้านค้าที่ไม่มีเว็บไซต์",
      },
      {
        title: "Support & Handover",
        text: "คัดกรองคำถามธุรกรรมจริง ปัญหาสถานะการชำระเงิน Refund และเคสที่ต้องให้ทีมงาน Payso ตรวจสอบต่อ",
      },
    ],
    businessTitle: "ออกแบบให้ทดสอบได้เหมือนใช้งานจริง",
    businessBody:
      "ผู้ทดสอบสามารถถามได้ทั้งภาษาไทยและอังกฤษ ระบบจะประเมิน intent, ค้นข้อมูลจาก source ที่เกี่ยวข้อง, แสดงความมั่นใจของคำตอบ และเตือนทันทีถ้าคำถามมีความเสี่ยงหรือข้อมูลไม่พอ",
    businessSegments: [
      "SME",
      "Startup",
      "SaaS",
      "Enterprise",
      "Education",
      "Clinic",
      "Beauty",
      "Travel",
      "Restaurant",
    ],
    chatTitle: "สอบถามผู้ช่วยของ Payso",
    chatBody:
      "เลือกคำถามตัวอย่างด้านล่าง พร้อมแสดงข้อมูลอ้างอิงในทุกคำตอบ",
    preChatTitle: "เริ่มต้นก่อนคุยกับผู้ช่วย",
    preChatBody: "กรอกข้อมูลสั้น ๆ เพื่อเริ่มต้นการสนทนากับ Payso Assistant",
    fieldName: "ชื่อ",
    fieldPhone: "เบอร์โทรศัพท์",
    fieldEmail: "อีเมล",
    fieldCompany: "บริษัท",
    requiredLabel: "จำเป็น",
    optionalLabel: "ไม่บังคับ",
    startChat: "เริ่มแชต",
    suggestedTitle: "คำถามแนะนำ",
    suggestedQuestions: [
      "Payso มีบริการอะไรบ้าง",
      "Payso เชื่อมต่อผ่าน API ได้ไหม",
      "Payment Link เหมาะกับธุรกิจแบบไหน",
      "เริ่มสมัครใช้งาน Payso อย่างไร",
    ],
    welcome:
      "สวัสดีครับ ยินดีต้อนรับสู่ Payso ครับ\nผมคือ AI Customer Success Agent ที่พร้อมให้บริการข้อมูลและสนับสนุนการใช้งานระบบรับชำระเงินของเราตลอด 24 ชั่วโมง เพื่อช่วยให้ธุรกิจของคุณเติบโตได้อย่างมั่นคง",
    assistant: "Payso Assistant",
    admin: "Payso Admin",
    user: "คุณ",
    inputPlaceholder:
      "พิมพ์คำถามเกี่ยวกับสินค้า Payso เช่น e-Payment, Payment Link, API, หรือปัญหาสถานะการชำระเงิน",
    send: "ส่งคำถาม",
    sending: "กำลังค้นข้อมูลจากแหล่งทางการ...",
    voiceThai: "TH",
    voiceEnglish: "EN",
    voiceTyping: "พิมพ์ด้วยเสียง",
    voiceReply: "อ่านคำตอบ",
    listening: "กำลังฟัง...",
    voiceUnsupported: "เบราว์เซอร์นี้ยังไม่รองรับการพิมพ์ด้วยเสียง แนะนำใช้ Chrome",
    addFile: "แนบไฟล์",
    clearChat: "เคลียร์ข้อความในแชท",
    filesReady: "ไฟล์ที่เลือก",
    intentLabel: "เจตนาของคำถาม",
    confidenceLabel: "ระดับความมั่นใจ",
    sourceLabel: "แหล่งอ้างอิง",
    handoverLabel: "การส่งต่อเจ้าหน้าที่",
    handoverTitle: "แนะนำให้ส่งต่อเจ้าหน้าที่ Payso",
    handoverBody:
      "เคสนี้เกี่ยวข้องกับธุรกรรมจริง การคืนเงิน หรือข้อมูลเฉพาะร้านค้า จึงควรให้ทีมงาน Payso ตรวจสอบต่อเพื่อความถูกต้อง",
    noSources: "ไม่มีแหล่งอ้างอิงที่เพียงพอ",
    yes: "ควรส่งต่อ",
    no: "ไม่จำเป็น",
    footer: "Prototype system for demonstration purposes, designed to integrate with Supabase for knowledge base management, chat history, and controlled AI response handling.",
    error:
      "ขออภัยครับ ตอนนี้ผมตอบได้ไม่สมบูรณ์นัก ลองพิมพ์รายละเอียดอีกนิด หรือเลือกคำถามแนะนำด้านล่างได้เลยครับ",
  },
  en: {
    langToggle: "TH / EN",
    navAbout: "About Payso",
    navProducts: "Products",
    navChat: "Try the Chat",
    heroKicker: "Payso Smart CS Agent",
    heroTitleLine1: "An AI support assistant",
    heroTitleLine2: "grounded in official Payso knowledge",
    heroSubtitleTitle: "A working prototype for product and support questions",
    heroBody:
      "This experience answers Payso product, integration, usage, and support questions using public content from the official Payso website only. It also recommends human handover when a real case needs staff review.",
    heroPrimary: "Start Testing",
    heroSecondary: "View Brand Story",
    aboutTitle: "Payso for businesses that need trusted payment infrastructure",
    aboutBody:
      "The page keeps the Payso visual language, while the chatbot now runs on a real local intelligence layer with knowledge retrieval, guardrails, and source-backed answers.",
    storyTitle: "From Pay Solutions to Payso",
    storyCards: [
      {
        title: "Built on a strong foundation",
        text: "Payso grows from a long-standing payment provider in Thailand and presents itself as a clearer, more modern business partner.",
      },
      {
        title: "Beyond Payment",
        text: "The brand positions itself as more than a payment processor by connecting selling, management, and business data across channels.",
      },
      {
        title: "Growing together",
        text: "Payso communicates long-term partnership for merchants, from SMEs to larger organizations that need reliable payment operations.",
      },
    ],
    visionCards: [
      {
        title: "Vision",
        lead: "\"Growing Together\"",
        text: "To become a leader in integrated payment solutions that help customers, teams, and businesses grow together sustainably.",
      },
      {
        title: "Mission",
        lead: "\"Beyond Payment\"",
        text: "To build solutions that connect payment acceptance, operations, and business data across online and offline journeys.",
      },
    ],
    whyChooseTitle: "Why choose us",
    whyChooseCards: [
      {
        title: "Enterprise-grade security",
        text: "Built with strong payment-security practices, data protection, and operational standards suited for modern businesses.",
      },
      {
        title: "Fast and reliable",
        text: "Keep payment operations moving smoothly with less friction, clearer visibility, and more dependable workflows.",
      },
      {
        title: "All channels covered",
        text: "Support online and in-store experiences with flexible payment options that fit how your customers buy.",
      },
      {
        title: "Built for Thai businesses",
        text: "Designed around real local business needs, from growing merchants to larger organizations that need stability.",
      },
      {
        title: "Backed by deep experience",
        text: "Extends long-standing expertise in payment infrastructure, integrations, and merchant operations.",
      },
      {
        title: "Easy to start",
        text: "Flexible setup paths and practical support help teams go live faster without unnecessary complexity.",
      },
    ],
    productsTitle: "Covers the main Payso question categories",
    productsBody:
      "The knowledge base includes product information, integration guidance, payment channels, merchant back-office usage, and official support-related content from Payso pages.",
    productCards: [
      {
        title: "e-Payment",
        text: "Answers about online payment acceptance for websites and applications, including integration patterns and supported channels.",
      },
      {
        title: "Payment Link",
        text: "Covers chat-commerce use cases, social selling, link creation, and business scenarios where no website is required.",
      },
      {
        title: "Support & Handover",
        text: "Flags real transaction issues, refund cases, and merchant-specific questions that should be reviewed by Payso staff.",
      },
    ],
    businessTitle: "Designed to be tested like a real support flow",
    businessBody:
      "Testers can ask in Thai or English. The assistant classifies intent, retrieves official Payso content, reports confidence, and clearly warns when information is unsupported or needs staff follow-up.",
    businessSegments: [
      "SME",
      "Startup",
      "SaaS",
      "Enterprise",
      "Education",
      "Clinic",
      "Beauty",
      "Travel",
      "Restaurant",
    ],
    chatTitle: "Try the Payso Smart CS Agent",
    chatBody:
      "Start with the suggested questions below. The chat calls the real `/api/chat` endpoint, retrieves Payso knowledge, and shows metadata after every answer.",
    preChatTitle: "Before you start",
    preChatBody: "Share a few details so we can start the conversation with Payso Assistant.",
    fieldName: "Name",
    fieldPhone: "Phone",
    fieldEmail: "Email",
    fieldCompany: "Company",
    requiredLabel: "Required",
    optionalLabel: "Optional",
    startChat: "Start Chat",
    suggestedTitle: "Suggested Questions",
    suggestedQuestions: [
      "What services does Payso offer?",
      "Can Payso integrate with an API?",
      "Who is Payment Link suitable for?",
      "How do I get started with Payso?",
    ],
    welcome:
      "Hello and welcome to Payso. I am your AI Customer Success Agent, ready to help with product information and payment-system usage guidance.",
    assistant: "Payso Assistant",
    admin: "Payso Admin",
    user: "You",
    inputPlaceholder:
      "Type a question about Payso products such as e-Payment, Payment Link, API, or payment-status issues",
    send: "Send Question",
    sending: "Searching official Payso knowledge...",
    voiceThai: "TH",
    voiceEnglish: "EN",
    voiceTyping: "Voice typing",
    voiceReply: "Voice reply",
    listening: "Listening...",
    voiceUnsupported: "This browser does not support voice typing. Chrome is recommended.",
    addFile: "Add file",
    clearChat: "Clear chat messages",
    filesReady: "Selected files",
    intentLabel: "Intent",
    confidenceLabel: "Confidence",
    sourceLabel: "Source",
    handoverLabel: "Handover",
    handoverTitle: "Human handover recommended",
    handoverBody:
      "This case involves a real transaction, refund, or merchant-specific review, so it should be handled by Payso staff for accuracy.",
    noSources: "No sufficient source references",
    yes: "Recommended",
    no: "Not required",
    footer: "Prototype only. Ready for Supabase-backed knowledge, chat storage, and guarded AI responses.",
    error:
      "Sorry, I could not complete that response just now. Please add a little more detail or choose one of the suggested questions below.",
  },
} as const;

export default function HomePage() {
  const [language, setLanguage] = useState<Language>("th");
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState<Language>("th");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceUnsupportedMessage, setVoiceUnsupportedMessage] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [preChatForm, setPreChatForm] = useState<UserProfile>({
    name: "",
    phone: "",
    email: "",
    company: "",
  });
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isNearBottomRef = useRef(true);
  const shouldAutoScrollRef = useRef(true);

  const t = copy[language];

  function getRecognitionLanguage(nextLanguage: Language): string {
    return nextLanguage === "th" ? "th-TH" : "en-US";
  }

  function isNearBottom(element: HTMLDivElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight < 180;
  }

  useEffect(() => {
    try {
      const savedProfile = sessionStorage.getItem(USER_PROFILE_STORAGE_KEY);
      const savedConversationId = sessionStorage.getItem(CONVERSATION_STORAGE_KEY);

      if (savedProfile) {
        const parsedProfile = JSON.parse(savedProfile) as UserProfile;
        setUserProfile(parsedProfile);
        setPreChatForm(parsedProfile);
        setMessages([]);
      }

      if (savedConversationId) {
        setConversationId(savedConversationId);
      }
    } catch {
      sessionStorage.removeItem(USER_PROFILE_STORAGE_KEY);
      sessionStorage.removeItem(CONVERSATION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    setVoiceLanguage(language);
  }, [language]);

  useEffect(() => {
    const container = scrollRef.current;

    if (!container) {
      return;
    }

    if (shouldAutoScrollRef.current || isNearBottomRef.current) {
      window.requestAnimationFrame(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "smooth",
        });
      });
      shouldAutoScrollRef.current = false;
      isNearBottomRef.current = true;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 156)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (!conversationId || !userProfile) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as ChatHistoryResponse;

        if (!Array.isArray(data.messages) || data.messages.length === 0) {
          return;
        }

        setMessages((current) => {
          const currentById = new Map(current.map((message) => [message.id, message]));
          const nextMessages = data.messages.map((message) => {
            const previous = currentById.get(message.id);

            if (
              !previous?.meta?.suggestions?.length ||
              message.meta?.suggestions?.length ||
              !message.meta
            ) {
              return message;
            }

            return {
              ...message,
              meta: {
                ...message.meta,
                suggestions: previous.meta.suggestions,
              } satisfies AssistantMeta,
            };
          });

          return dedupeConsecutiveAssistantMessages(nextMessages);
        });
      } catch {
        // Keep chat usable even if polling fails.
      }
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [conversationId, userProfile]);

  async function sendQuestion(question: string) {
    const trimmed = question.trim();

    if (!trimmed || isLoading || !userProfile || !conversationId) {
      return;
    }

    const chatContainer = scrollRef.current;
    shouldAutoScrollRef.current = !chatContainer || isNearBottom(chatContainer);

    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-user`,
        role: "user",
        content: trimmed,
      },
    ]);

    setInput("");
    setSelectedFiles([]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          conversationId,
          userInfo: userProfile,
        }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = (await response.json()) as ChatApiResponse;

      if (data.conversationId) {
        setConversationId(data.conversationId);
        sessionStorage.setItem(CONVERSATION_STORAGE_KEY, data.conversationId);
      }

      setMessages((current) =>
        dedupeConsecutiveAssistantMessages([
          ...current,
          {
            id: data.messageId ?? `${Date.now()}-assistant`,
            role: "assistant",
            content: data.answer,
            meta: {
              intent: data.intent,
              confidence: data.confidence,
              handover: data.handover,
              sources: data.sources,
              reason: data.reason,
              suggestions: data.suggestions,
            },
          },
        ]),
      );
    } catch {
      setMessages((current) =>
        dedupeConsecutiveAssistantMessages([
          ...current,
          {
            id: `${Date.now()}-assistant-error`,
            role: "assistant",
            content: t.error,
            meta: {
              intent: "Out of Scope",
              confidence: "Low",
              handover: true,
              sources: [],
              reason: "Request failed.",
              suggestions: copy[language].suggestedQuestions.slice(0, 4),
            },
          },
        ]),
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion(input);
  }

  function handlePreChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextProfile = {
      name: preChatForm.name.trim(),
      phone: preChatForm.phone.trim(),
      email: preChatForm.email.trim(),
      company: preChatForm.company.trim(),
    };

    if (!nextProfile.name || !nextProfile.phone) {
      return;
    }

    const nextConversationId = crypto.randomUUID();

    setUserProfile(nextProfile);
    setConversationId(nextConversationId);
    setMessages([]);
    sessionStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
    sessionStorage.setItem(CONVERSATION_STORAGE_KEY, nextConversationId);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();

    if (!input.trim() || isLoading) {
      return;
    }

    void sendQuestion(input);
  }

  function handleChatScroll(event: UIEvent<HTMLDivElement>) {
    isNearBottomRef.current = isNearBottom(event.currentTarget);
  }

  function handleMicToggle() {
    if (typeof window === "undefined") {
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const RecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!RecognitionConstructor) {
      setVoiceUnsupportedMessage(t.voiceUnsupported);
      return;
    }

    setVoiceUnsupportedMessage(null);

    const recognition = new RecognitionConstructor();
    recognition.lang = getRecognitionLanguage(voiceLanguage);
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result?.[0]?.transcript || "")
        .join(" ")
        .trim();

      if (transcript) {
        setInput(transcript);
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  function handleVoiceReplyToggle() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const latestAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant" || message.role === "admin");

    if (!latestAssistantMessage) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(latestAssistantMessage.content);
    const preferredPrefix = voiceLanguage === "th" ? "th" : "en";
    const voices = window.speechSynthesis.getVoices();
    const matchingVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith(preferredPrefix));

    utterance.lang = matchingVoice?.lang || getRecognitionLanguage(voiceLanguage);

    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
    };
    utterance.onend = () => {
      setIsSpeaking(false);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? []);

    if (nextFiles.length === 0) {
      return;
    }

    setSelectedFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}-${file.size}-${file.lastModified}`));
      const merged = [...current];

      nextFiles.forEach((file) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(file);
        }
      });

      return merged;
    });

    event.target.value = "";
  }

  function removeSelectedFile(targetFile: File) {
    setSelectedFiles((current) =>
      current.filter(
        (file) =>
          !(
            file.name === targetFile.name &&
            file.size === targetFile.size &&
            file.lastModified === targetFile.lastModified
          ),
      ),
    );
  }

  function handleClearChat() {
    const nextConversationId = crypto.randomUUID();

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setMessages([]);
    setInput("");
    setSelectedFiles([]);
    setIsSpeaking(false);
    setVoiceUnsupportedMessage(null);
    setConversationId(nextConversationId);
    sessionStorage.setItem(CONVERSATION_STORAGE_KEY, nextConversationId);
    shouldAutoScrollRef.current = true;
  }

  function scrollToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="payso-shell relative overflow-hidden">
      <div className="payso-orb one" />
      <div className="payso-orb two" />
      <div className="payso-orb three" />
      <div className="payso-grid pointer-events-none absolute inset-0 opacity-50" />

      <div className="mx-auto max-w-7xl px-4 pb-16 pt-5 sm:px-6 lg:px-8">
        <header className="glass-card sticky top-3 z-20 flex items-center justify-between rounded-full px-4 py-3 sm:px-6">
          <Image
            src="/brand/payso-primary-logo.png"
            alt="Payso"
            width={126}
            height={36}
            priority
            className="h-auto w-[110px] sm:w-[126px]"
          />

          <nav className="hidden items-center gap-6 text-sm font-medium text-payso-muted lg:flex">
            <button type="button" onClick={() => scrollToSection("about")} className="transition hover:text-payso-blue">
              {t.navAbout}
            </button>
            <button type="button" onClick={() => scrollToSection("products")} className="transition hover:text-payso-blue">
              {t.navProducts}
            </button>
            <button type="button" onClick={() => scrollToSection("chat")} className="transition hover:text-payso-blue">
              {t.navChat}
            </button>
          </nav>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsLanguageMenuOpen((current) => !current)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-payso-blue text-white transition hover:bg-payso-dark"
              aria-label="Select language"
              aria-expanded={isLanguageMenuOpen}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <path
                  d="M12 3a9 9 0 1 0 0 18m0-18c2.5 2.4 4 5.7 4 9s-1.5 6.6-4 9m0-18C9.5 5.4 8 8.7 8 12s1.5 6.6 4 9m-8-9h16M4.8 8h14.4M4.8 16h14.4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {isLanguageMenuOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.75rem)] min-w-[160px] overflow-hidden rounded-[22px] border border-payso-blue/12 bg-white p-2 shadow-[0_18px_40px_rgba(16,43,177,0.12)]">
                <button
                  type="button"
                  onClick={() => {
                    setLanguage("th");
                    setIsLanguageMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-[16px] px-4 py-3 text-left text-sm font-medium transition ${
                    language === "th"
                      ? "bg-payso-soft text-payso-blue"
                      : "text-payso-dark hover:bg-payso-soft"
                  }`}
                >
                  <span>ไทย</span>
                  {language === "th" ? <span className="text-xs font-semibold">Active</span> : null}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLanguage("en");
                    setIsLanguageMenuOpen(false);
                  }}
                  className={`mt-1 flex w-full items-center justify-between rounded-[16px] px-4 py-3 text-left text-sm font-medium transition ${
                    language === "en"
                      ? "bg-payso-soft text-payso-blue"
                      : "text-payso-dark hover:bg-payso-soft"
                  }`}
                >
                  <span>English</span>
                  {language === "en" ? <span className="text-xs font-semibold">Active</span> : null}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <section className="grid gap-8 pb-14 pt-10 lg:grid-cols-[1.12fr_0.88fr] lg:items-center">
          <div>
            <div className="inline-flex items-center rounded-full bg-payso-blue/8 px-4 py-2 text-sm font-semibold text-payso-blue">
              {t.heroKicker}
            </div>
            <h1 className="mt-6 text-5xl font-semibold leading-none tracking-[-0.04em] text-payso-ink sm:text-6xl">
              <span className="block">{t.heroTitleLine1}</span>
              <span className="mt-2 block">{t.heroTitleLine2}</span>
            </h1>
            <h2 className="mt-8 text-xl font-semibold text-payso-dark sm:text-2xl">
              {t.heroSubtitleTitle}
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-payso-muted sm:text-lg">
              {t.heroBody}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => scrollToSection("chat")}
                className="rounded-full bg-payso-blue px-6 py-3 text-sm font-semibold text-white transition hover:bg-payso-dark"
              >
                {t.heroPrimary}
              </button>
              <button
                type="button"
                onClick={() => scrollToSection("about")}
                className="rounded-full border border-payso-blue/16 bg-white px-6 py-3 text-sm font-semibold text-payso-dark transition hover:bg-payso-soft"
              >
                {t.heroSecondary}
              </button>
            </div>
          </div>

          <div className="glass-card rounded-[34px] p-6 sm:p-8">
            <div className="rounded-[30px] bg-gradient-to-br from-payso-dark via-payso-blue to-[#3971ff] px-6 py-8 text-white">
              <Image
                src="/brand/payso-primary-white-logo.png"
                alt="Payso"
                width={140}
                height={40}
                className="h-auto w-[130px]"
              />
              <h3 className="mt-6 text-2xl font-semibold leading-tight sm:text-3xl">
                {t.aboutTitle}
              </h3>
              <p className="mt-4 text-sm leading-7 text-white/84 sm:text-base">
                {t.aboutBody}
              </p>
            </div>
          </div>
        </section>

        <section id="about" className="pb-14">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] text-payso-ink sm:text-4xl">
              {t.storyTitle}
            </h2>
          </div>

          <div className="mt-8 overflow-hidden rounded-[32px] border border-payso-blue/10 bg-white shadow-[0_18px_50px_rgba(16,43,177,0.08)]">
            <Image
              src="/about-payso/about_payso_8.BCnBpSxA.png"
              alt="Payso brand evolution"
              width={1600}
              height={900}
              className="h-auto w-full object-cover"
            />
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {t.storyCards.map((card) => (
              <article key={card.title} className="glass-card rounded-[28px] p-6">
                <div className="mb-5 h-1.5 w-14 rounded-full bg-payso-blue" />
                <h3 className="text-xl font-semibold text-payso-ink">{card.title}</h3>
                <p className="mt-3 text-sm leading-7 text-payso-muted">{card.text}</p>
              </article>
            ))}
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {t.visionCards.map((card, index) => (
              <article
                key={card.title}
                className="glass-card flex h-full flex-col overflow-hidden rounded-[30px] p-0"
              >
                <div className="aspect-[4/5] max-h-[420px] overflow-hidden">
                  <Image
                    src={
                      index === 0
                        ? "/about-payso/about_payso_5.DJh9OO0R.png"
                        : "/about-payso/about_payso_4.6RIo2P_x.png"
                    }
                    alt={card.title}
                    width={1200}
                    height={1500}
                    className={`h-full w-full object-cover ${
                      index === 0 ? "object-left-top" : "object-top"
                    }`}
                  />
                </div>
                <div className="flex flex-1 flex-col p-7">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-payso-blue">
                    {card.title}
                  </p>
                  <h3 className="mt-4 text-2xl font-semibold text-payso-ink">{card.lead}</h3>
                  <p className="mt-4 text-sm leading-7 text-payso-muted">{card.text}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-10">
            <div className="text-center">
              <h3 className="text-3xl font-semibold tracking-[-0.03em] text-payso-ink sm:text-4xl">
                {t.whyChooseTitle}
              </h3>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {t.whyChooseCards.map((card, index) => (
                <article
                  key={card.title}
                  className="rounded-[30px] border border-white/70 bg-[#eef3ff] p-6 shadow-[0_16px_40px_rgba(16,43,177,0.06)]"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-payso-blue text-white shadow-[0_10px_24px_rgba(37,84,234,0.24)]">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
                      {index === 0 ? <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3Zm0 5.5v5m0 0 3-3m-3 3-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
                      {index === 1 ? <path d="M13 2 6 13h5l-1 9 8-12h-5l0-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
                      {index === 2 ? <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Zm2 1.5h12m-8 6h4m2-4 2 2-2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
                      {index === 3 ? <path d="M8 11a4 4 0 1 1 8 0a4 4 0 0 1-8 0Zm-3 8a7 7 0 0 1 14 0M5 7h.01M19 7h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
                      {index === 4 ? <path d="M12 4 14.5 9 20 9.5l-4 3.8 1 5.7L12 16.5 7 19l1-5.7-4-3.8L9.5 9 12 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
                      {index === 5 ? <path d="M10 10V6a2 2 0 1 1 4 0v4m-7 2h10a2 2 0 0 1 2 2v2a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-2a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
                    </svg>
                  </div>

                  <h4 className="mt-7 text-[1.9rem] font-semibold leading-tight tracking-[-0.03em] text-payso-ink">
                    {card.title}
                  </h4>
                  <p className="mt-5 max-w-[34ch] text-base leading-8 text-payso-muted">
                    {card.text}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="products" className="pb-14">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] text-payso-ink sm:text-4xl">
              {t.productsTitle}
            </h2>
            <p className="mt-4 text-base leading-8 text-payso-muted sm:text-lg">
              {t.productsBody}
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {t.productCards.map((card) => (
              <article key={card.title} className="glass-card rounded-[28px] p-6">
                <div className="mb-5 h-1.5 w-14 rounded-full bg-payso-blue" />
                <h3 className="text-xl font-semibold text-payso-ink">{card.title}</h3>
                <p className="mt-3 text-sm leading-7 text-payso-muted">{card.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="chat" className="pb-14">
          <div className="glass-card rounded-[36px] p-6 sm:p-8 lg:p-10">
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-payso-ink sm:text-4xl">
                {t.chatTitle}
              </h2>
              <p className="mt-4 text-base leading-8 text-payso-muted sm:text-lg">
                {t.chatBody}
              </p>
            </div>

            {!userProfile ? (
              <div className="mt-8 rounded-[30px] border border-payso-blue/10 bg-[#f9fbff] p-5 sm:p-6">
                <div className="mx-auto max-w-3xl">
                  <h3 className="text-2xl font-semibold text-payso-ink">{t.preChatTitle}</h3>
                  <p className="mt-3 text-sm leading-7 text-payso-muted">{t.preChatBody}</p>

                  <form onSubmit={handlePreChatSubmit} className="mt-6 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-payso-dark">
                          {t.fieldName} <span className="text-payso-blue">({t.requiredLabel})</span>
                        </span>
                        <input
                          value={preChatForm.name}
                          onChange={(event) =>
                            setPreChatForm((current) => ({ ...current, name: event.target.value }))
                          }
                          className="w-full rounded-[18px] border border-payso-blue/12 bg-white px-4 py-3 text-sm text-payso-ink outline-none placeholder:text-payso-muted"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-payso-dark">
                          {t.fieldPhone} <span className="text-payso-blue">({t.requiredLabel})</span>
                        </span>
                        <input
                          value={preChatForm.phone}
                          onChange={(event) =>
                            setPreChatForm((current) => ({ ...current, phone: event.target.value }))
                          }
                          className="w-full rounded-[18px] border border-payso-blue/12 bg-white px-4 py-3 text-sm text-payso-ink outline-none placeholder:text-payso-muted"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-payso-dark">
                          {t.fieldEmail} <span className="text-payso-muted">({t.optionalLabel})</span>
                        </span>
                        <input
                          type="email"
                          value={preChatForm.email}
                          onChange={(event) =>
                            setPreChatForm((current) => ({ ...current, email: event.target.value }))
                          }
                          className="w-full rounded-[18px] border border-payso-blue/12 bg-white px-4 py-3 text-sm text-payso-ink outline-none placeholder:text-payso-muted"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-payso-dark">
                          {t.fieldCompany} <span className="text-payso-muted">({t.optionalLabel})</span>
                        </span>
                        <input
                          value={preChatForm.company}
                          onChange={(event) =>
                            setPreChatForm((current) => ({ ...current, company: event.target.value }))
                          }
                          className="w-full rounded-[18px] border border-payso-blue/12 bg-white px-4 py-3 text-sm text-payso-ink outline-none placeholder:text-payso-muted"
                        />
                      </label>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="rounded-[18px] bg-payso-blue px-6 py-3 text-sm font-semibold text-white transition hover:bg-payso-dark"
                      >
                        {t.startChat}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : (
            <div className="chat-panel mt-8">
              <div
                ref={scrollRef}
                onScroll={handleChatScroll}
                className="chat-scroll"
              >
                {messages.length === 0 && !isLoading ? (
                  <div className="chat-empty-state">
                    <p>{language === "th" ? "เริ่มพิมพ์คำถามหรือเลือกคำถามตัวอย่างเพื่อเริ่มสนทนา" : "Start by typing a question or choose a suggested prompt."}</p>
                  </div>
                ) : null}

                {dedupeConsecutiveAssistantMessages(messages).map((message) => {
                  const isAssistant = message.role === "assistant" || message.role === "admin";
                  const isAdmin = message.role === "admin";
                  const displayInitial = (userProfile?.name?.trim()?.[0] || "U").toUpperCase();
                  const userDisplayName = userProfile?.name?.trim()
                    ? `${t.user} ${userProfile.name.trim()}`
                    : t.user;
                  const parsedContent = isAssistant
                    ? parseAssistantMessageContent(message.content)
                    : { body: message.content, links: [], relatedQuestions: [] };
                  const suggestionQuestions =
                    message.meta?.suggestions?.length
                      ? message.meta.suggestions
                      : parsedContent.relatedQuestions;
                  const referenceLinks = [
                    ...parsedContent.links,
                    ...(message.meta?.sources ?? []).map((source) => ({
                      label: source.title || "Payso",
                      url: source.url,
                    })),
                  ].filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index);

                  return (
                    <div
                      key={message.id}
                      className={`chat-message-row ${
                        isAssistant ? "chat-message-row-assistant" : "chat-message-row-user"
                      }`}
                    >
                      {isAssistant ? (
                        isAdmin ? (
                          <div className="chat-avatar chat-avatar-admin">A</div>
                        ) : (
                          <PaysoAssistantAvatar />
                        )
                      ) : null}
                      <div
                        className={`chat-message-stack ${
                          isAssistant ? "chat-message-stack-assistant" : "chat-message-stack-user"
                        }`}
                      >
                        <div
                          className={`chat-bubble ${
                            isAssistant ? "chat-bubble-assistant" : "chat-bubble-user"
                          }`}
                        >
                          <p className={`chat-message-author ${isAssistant ? "text-payso-blue" : "text-white/75"}`}>
                            {isAdmin ? t.admin : isAssistant ? t.assistant : userDisplayName}
                          </p>
                          <ChatMarkdown content={parsedContent.body} />

                          {isAssistant && referenceLinks.length ? (
                            <div className="chat-link-list">
                              {referenceLinks.map((link) => (
                                <a
                                  key={`${message.id}-${link.url}`}
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="chat-resource-link"
                                >
                                  <span>{link.label}</span>
                                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
                                    <path
                                      d="M4.5 11.5 11.5 4.5M7 4.5h4.5V9"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        {isAssistant && suggestionQuestions.length ? (
                          <div className="chat-suggestion-block">
                            <div className="chat-suggestion-row">
                              {suggestionQuestions.slice(0, 3).map((question) => (
                                <button
                                  key={`${message.id}-${question}`}
                                  type="button"
                                  onClick={() => void sendQuestion(question)}
                                  disabled={isLoading}
                                  className="chat-suggestion-chip"
                                >
                                  {question}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {!isAssistant ? (
                        <div className="chat-avatar chat-avatar-user">{displayInitial}</div>
                      ) : null}
                    </div>
                  );
                })}

                {isLoading ? <TypingIndicator /> : null}
              </div>

              <form onSubmit={handleSubmit} className="chat-composer-wrap">
                <div className="chat-composer">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="chat-icon-button"
                    aria-label={t.addFile}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
                      <path
                        d="M12 5v14M5 12h14"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>

                  <div className="chat-composer-field">
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={handleInputKeyDown}
                      placeholder={t.inputPlaceholder}
                      rows={1}
                      className="chat-textarea"
                    />

                    {selectedFiles.length > 0 ? (
                      <div className="chat-file-row">
                        {selectedFiles.map((file) => (
                          <button
                            key={`${file.name}-${file.size}-${file.lastModified}`}
                            type="button"
                            onClick={() => removeSelectedFile(file)}
                            className="chat-file-chip"
                          >
                            <span className="max-w-[180px] truncate">{file.name}</span>
                            <span className="text-payso-muted">x</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="chat-composer-actions">
                    <button
                      type="button"
                      onClick={handleMicToggle}
                      className={`chat-icon-button ${
                        isListening
                          ? "bg-payso-soft text-payso-blue"
                          : "bg-white text-payso-dark hover:bg-payso-soft"
                      }`}
                      aria-label={t.voiceTyping}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
                        <path
                          d="M12 4a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Zm-6 7a6 6 0 0 0 12 0m-6 6v3m-4 0h8"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={handleVoiceReplyToggle}
                      className={`chat-icon-button ${
                        isSpeaking
                          ? "bg-payso-blue text-white"
                          : "bg-white text-payso-dark hover:bg-payso-soft"
                      }`}
                      aria-label={t.voiceReply}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
                        {isSpeaking ? (
                          <path
                            d="M9 9.25A1.25 1.25 0 0 1 10.25 8h3.5A1.25 1.25 0 0 1 15 9.25v5.5A1.25 1.25 0 0 1 13.75 16h-3.5A1.25 1.25 0 0 1 9 14.75v-5.5Z"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ) : (
                          <>
                            <path
                              d="M5 14h2.4l3.6 3V7L7.4 10H5v4Z"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M15 10.5a3.5 3.5 0 0 1 0 3"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                            />
                            <path
                              d="M17.5 8a7 7 0 0 1 0 8"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                            />
                          </>
                        )}
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={handleClearChat}
                      disabled={isLoading || messages.length === 0}
                      className="chat-icon-button"
                      aria-label={t.clearChat}
                      title={t.clearChat}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                        <path
                          d="M6.5 8h11M10 11v5M14 11v5M8 8l.6 10.2A2 2 0 0 0 10.6 20h2.8a2 2 0 0 0 2-1.8L16 8M10 8V6.7A1.7 1.7 0 0 1 11.7 5h.6A1.7 1.7 0 0 1 14 6.7V8"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading}
                      className="chat-send-button"
                      aria-label={isLoading ? t.sending : t.send}
                    >
                      {isLoading ? (
                        <span className="chat-send-spinner" />
                      ) : (
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                          <path
                            d="M5 12h13M13 6l6 6-6 6"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {(isListening || voiceUnsupportedMessage || isLoading) ? (
                  <div className="chat-status-line">
                    {isListening
                      ? t.listening
                      : isLoading
                        ? language === "th"
                          ? "Payso Assistant กำลังพิมพ์..."
                          : "Payso Assistant is typing..."
                        : voiceUnsupportedMessage ?? ""}
                  </div>
                ) : null}
              </form>
            </div>
            )}
          </div>
        </section>

        <footer className="px-2 pt-8 text-center text-sm leading-7 text-payso-muted">
          {t.footer}
        </footer>
      </div>
    </main>
  );
}
