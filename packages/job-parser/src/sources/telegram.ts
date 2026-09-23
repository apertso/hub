import * as cheerio from "cheerio";

import { JobParserError, type ParsedJobFields } from "../types.js";
import { isVacancyTextTooShort, normalizeWhitespace } from "../utils/text.js";
import { parseTelegramMessageTarget, telegramEmbedUrl } from "../utils/url.js";

const FETCH_TIMEOUT_MS = 15_000;

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

const TITLE_LABELS = [
  "looking for",
  "position",
  "job title",
  "role",
  "title",
  "вакансия",
  "должность",
  "позиция",
  "ищем",
];

const COMPANY_LABELS = [
  "company",
  "hiring company",
  "employer",
  "компания",
  "организация",
  "заказчик",
];

const SALARY_LABELS = ["salary", "compensation", "зарплата", "оклад", "compensation range"];
const LOCATION_LABELS = ["location", "job location", "локация", "город", "location / remote"];

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`^${escapeRegExp(label)}\\s*:\\s*(.+)$`, "im"));
    const value = normalizeWhitespace(match?.[1] ?? "");
    if (value) {
      return value;
    }
  }
  return "";
}

export function extractTelegramMessageText(html: string): string {
  const $ = cheerio.load(html);
  const message = $(".tgme_widget_message_text").first();
  const rawHtml = message.html() ?? "";
  if (!rawHtml.trim()) {
    return "";
  }

  const withBreaks = rawHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  const text = cheerio.load(`<div>${withBreaks}</div>`)("div").text();
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchTelegramJob(url: string): Promise<ParsedJobFields> {
  const target = parseTelegramMessageTarget(url);
  if (!target) {
    throw new JobParserError("TELEGRAM_URL_INVALID", "Telegram URL does not point at a message.");
  }

  const response = await fetch(telegramEmbedUrl(target), {
    headers: FETCH_HEADERS,
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new JobParserError("TELEGRAM_HTTP_ERROR", `Telegram returned HTTP ${response.status}.`);
  }

  const jobDescription = extractTelegramMessageText(await response.text());
  if (isVacancyTextTooShort(jobDescription)) {
    throw new JobParserError("TELEGRAM_TEXT_TOO_SHORT", "Telegram post is missing useful vacancy text.");
  }

  return {
    companyName: labeledValue(jobDescription, COMPANY_LABELS),
    positionTitle: labeledValue(jobDescription, TITLE_LABELS),
    salary: labeledValue(jobDescription, SALARY_LABELS),
    location: labeledValue(jobDescription, LOCATION_LABELS),
    jobDescription,
    warnings: [],
  };
}
