import { JobParserError, type ParsedJobFields } from "../types.js";
import {
  decodeHtmlEntities,
  extractCompanyFromText,
  extractLocationFromText,
  extractSalaryFromText,
  extractTitleFromText,
  extractVacancyTextFromHtml,
  fallbackVacancyTextFromHtml,
  normalizeWhitespace,
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

function stringifyMetadataValue(value: unknown): string {
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyMetadataValue(item))
      .filter(Boolean)
      .join(", ");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["label", "name", "value"]) {
      const nested = stringifyMetadataValue(record[key]);
      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

function readLocation(payload: Record<string, unknown>): string {
  return stringifyMetadataValue(payload.location);
}

function readSalary(payload: Record<string, unknown>): string {
  for (const key of ["salary", "salary_range", "pay_range", "compensation"]) {
    const value = stringifyMetadataValue(payload[key]);
    if (value) {
      return value;
    }
  }

  const metadata = payload.metadata;
  if (!Array.isArray(metadata)) {
    return "";
  }

  for (const item of metadata) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const name = stringifyMetadataValue(record.name).toLowerCase();
    if (!/\b(salary|compensation|pay)\b/.test(name)) {
      continue;
    }

    const value = stringifyMetadataValue(record.value);
    if (value) {
      return value;
    }
  }

  return "";
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
    salary: readSalary(payload) || extractSalaryFromText(text),
    location: readLocation(payload) || extractLocationFromText(text),
    jobDescription: text,
    warnings: [],
  };
}
