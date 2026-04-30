import { JobParserError, type ParsedJobFields } from "../types.js";
import {
  decodeHtmlEntities,
  extractCompanyFromText,
  extractTitleFromText,
  extractVacancyTextFromHtml,
  fallbackVacancyTextFromHtml,
  isVacancyTextTooShort,
} from "../utils/text.js";
import { parseGreenhouseJobTarget } from "../utils/url.js";

const FETCH_TIMEOUT_MS = 15_000;

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function fetchGreenhouseJob(url: string): Promise<ParsedJobFields> {
  const target = parseGreenhouseJobTarget(url);
  if (!target) {
    throw new JobParserError("GREENHOUSE_TARGET_NOT_FOUND", "Greenhouse board token or job id was not found.");
  }

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.boardToken)}/jobs/${encodeURIComponent(target.jobId)}`;
  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json",
    },
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new JobParserError("GREENHOUSE_HTTP_ERROR", `Greenhouse API returned HTTP ${response.status}.`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const content = decodeHtmlEntities(readString(payload, "content"));
  const text = extractVacancyTextFromHtml(content) || fallbackVacancyTextFromHtml(content);
  if (isVacancyTextTooShort(text)) {
    throw new JobParserError("GREENHOUSE_DESCRIPTION_MISSING", "Greenhouse job description is missing or too short.");
  }

  return {
    companyName: readString(payload, "company_name") || extractCompanyFromText(text),
    positionTitle: readString(payload, "title") || extractTitleFromText(text),
    jobDescription: text,
    warnings: [],
  };
}
