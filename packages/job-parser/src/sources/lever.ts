import { JobParserError, type ParsedJobFields } from "../types.js";
import {
  extractCompanyFromText,
  extractLocationFromText,
  extractSalaryFromText,
  extractVacancyTextFromHtml,
  fallbackVacancyTextFromHtml,
  normalizeWhitespace,
  isVacancyTextTooShort,
} from "../utils/text.js";
import { parseLeverJobTarget } from "../utils/url.js";

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

function companyNameFromSiteSlug(site: string): string {
  return site
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function readLocation(payload: Record<string, unknown>): string {
  const categories = payload.categories;
  let location = "";

  if (categories && typeof categories === "object") {
    const record = categories as Record<string, unknown>;
    const allLocations = record.allLocations;
    if (Array.isArray(allLocations)) {
      const locations = allLocations
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
      if (locations.length > 0) {
        location = locations.join(" / ");
      }
    }

    if (!location) {
      location = readString(record, "location");
    }
  }

  const workplaceType = readString(payload, "workplaceType");
  if (workplaceType.toLowerCase() === "remote" && location && !/\bremote\b/i.test(location)) {
    return `${location} / Remote`;
  }

  if (workplaceType.toLowerCase() === "remote" && !location) {
    return "Remote";
  }

  return location;
}

function readSalary(payload: Record<string, unknown>): string {
  for (const key of ["salaryRange", "salaryDescription", "salary", "compensation"]) {
    const value = readString(payload, key);
    if (value) {
      return value;
    }
  }

  return "";
}

function readListContent(listItem: Record<string, unknown>): string {
  const contentPlain = readString(listItem, "contentPlain");
  if (contentPlain) {
    return contentPlain;
  }

  const contentHtml = readString(listItem, "content");
  if (!contentHtml) {
    return "";
  }

  return extractVacancyTextFromHtml(contentHtml) || fallbackVacancyTextFromHtml(contentHtml);
}

function buildLeverDescription(payload: Record<string, unknown>): string {
  const sections: string[] = [];

  const openingPlain = readString(payload, "openingPlain");
  const descriptionPlain = readString(payload, "descriptionPlain");
  const mainDescription = openingPlain || descriptionPlain;
  if (mainDescription) {
    sections.push(mainDescription);
  }

  const descriptionBodyPlain = readString(payload, "descriptionBodyPlain");
  if (descriptionBodyPlain && descriptionBodyPlain !== mainDescription) {
    sections.push(descriptionBodyPlain);
  }

  const lists = payload.lists;
  if (Array.isArray(lists)) {
    for (const item of lists) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const listItem = item as Record<string, unknown>;
      const heading = readString(listItem, "text");
      const content = readListContent(listItem);

      if (heading && content) {
        sections.push(`${heading}\n${content}`);
      } else if (heading) {
        sections.push(heading);
      } else if (content) {
        sections.push(content);
      }
    }
  }

  const additionalPlain = readString(payload, "additionalPlain");
  if (additionalPlain) {
    sections.push(additionalPlain);
  }

  return normalizeWhitespace(sections.join("\n\n"));
}

export async function fetchLeverJob(url: string): Promise<ParsedJobFields> {
  const target = parseLeverJobTarget(url);
  if (!target) {
    throw new JobParserError("LEVER_TARGET_NOT_FOUND", "Lever site slug or posting id was not found.");
  }

  const apiUrl = `${target.apiBase}/v0/postings/${encodeURIComponent(target.site)}/${encodeURIComponent(target.postingId)}?mode=json`;
  const response = await fetch(apiUrl, {
    headers: {
      Accept: "application/json",
    },
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new JobParserError("LEVER_HTTP_ERROR", `Lever API returned HTTP ${response.status}.`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const text = buildLeverDescription(payload);
  if (isVacancyTextTooShort(text)) {
    throw new JobParserError("LEVER_DESCRIPTION_MISSING", "Lever job description is missing or too short.");
  }

  const companyName = companyNameFromSiteSlug(target.site) || extractCompanyFromText(text);

  return {
    companyName,
    positionTitle: readString(payload, "text"),
    salary: readSalary(payload) || extractSalaryFromText(text),
    location: readLocation(payload) || extractLocationFromText(text),
    jobDescription: text,
    warnings: [],
  };
}
