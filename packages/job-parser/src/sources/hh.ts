import * as cheerio from "cheerio";
import { JobParserError, type ParsedJobFields } from "../types.js";
import { decodeHtmlEntities, isVacancyTextTooShort, normalizeWhitespace } from "../utils/text.js";

const FETCH_TIMEOUT_MS = 15_000;

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
};

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function htmlFragmentToText(html: string): string {
  const text = decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|li|section|article|main|h1|h2|h3|h4|h5|h6|ul|ol|tr|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return text
    .split(/\r?\n+/g)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readSelectorText($: cheerio.CheerioAPI, selector: string): string {
  return normalizeWhitespace(decodeHtmlEntities($(selector).first().text()));
}

function readDescription($: cheerio.CheerioAPI): string {
  const description = $('[data-qa="vacancy-description"]').first();
  if (description.length === 0) {
    return "";
  }

  return htmlFragmentToText(description.html() ?? description.text());
}

export async function fetchHhJob(url: string): Promise<ParsedJobFields> {
  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new JobParserError("HH_HTTP_ERROR", `HH fetch returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const jobDescription = readDescription($);
  if (isVacancyTextTooShort(jobDescription)) {
    throw new JobParserError("HH_DESCRIPTION_MISSING", "HH job description is missing or too short.");
  }

  return {
    companyName: readSelectorText($, '[data-qa="vacancy-company-name"]'),
    positionTitle: readSelectorText($, '[data-qa="vacancy-title"]'),
    jobDescription,
    warnings: [],
  };
}
