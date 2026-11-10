import { requestSignal } from "../utils/abort.js";
import { JobParserError } from "../types.js";
import {
  extractVacancyTextFromHtml,
  fallbackVacancyTextFromHtml,
  isVacancyTextTooShort,
} from "../utils/text.js";

const FETCH_TIMEOUT_MS = 15_000;

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export async function fetchDirectText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: requestSignal(FETCH_TIMEOUT_MS, signal),
  });

  if (!response.ok) {
    throw new JobParserError("DIRECT_HTTP_ERROR", `Direct fetch returned HTTP ${response.status}.`, response.status);
  }
  if (response.headers.get("cf-mitigated") === "challenge") {
    throw new JobParserError("DIRECT_SOURCE_BLOCKED", "Direct fetch returned a browser challenge.");
  }

  const html = await response.text();
  const text = extractVacancyTextFromHtml(html) || fallbackVacancyTextFromHtml(html);
  if (isVacancyTextTooShort(text)) {
    throw new JobParserError("DIRECT_TEXT_TOO_SHORT", "Direct fetch result is missing useful vacancy text.");
  }

  return text;
}
