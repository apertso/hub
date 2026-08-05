import * as cheerio from "cheerio";
import { JobParserError, type ParsedJobFields } from "../types.js";
import {
  decodeHtmlEntities,
  extractCompanyFromText,
  extractCompanyRoleFromHtml,
  extractLocationFromText,
  extractSalaryFromText,
  extractTitleFromText,
  isVacancyTextTooShort,
  normalizeWhitespace,
} from "../utils/text.js";
import { isTeamtailorUrl } from "../utils/url.js";

const FETCH_TIMEOUT_MS = 15_000;

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function htmlFragmentToText(html: string): string {
  let decoded = decodeHtmlEntities(html);
  // Teamtailor JSON-LD often double-encodes markup (&lt;p&gt;...).
  if (/&lt;|&gt;|&amp;|&quot;|&#39;/i.test(decoded)) {
    decoded = decodeHtmlEntities(decoded);
  }

  const text = decoded
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

function collectJobPostingNodes(value: unknown, target: Record<string, unknown>[]): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectJobPostingNodes(item, target);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const typeValue = record["@type"];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  const isJobPosting = types.some((entry) => typeof entry === "string" && entry.toLowerCase() === "jobposting");
  if (isJobPosting) {
    target.push(record);
  }

  for (const nested of Object.values(record)) {
    collectJobPostingNodes(nested, target);
  }
}

function readJobPosting(html: string): Record<string, unknown> | null {
  const $ = cheerio.load(html);
  const postings: Record<string, unknown>[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const payload = $(element).contents().text().trim();
    if (!payload) {
      return;
    }

    try {
      collectJobPostingNodes(JSON.parse(payload), postings);
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  });

  if (postings.length === 0) {
    return null;
  }

  return postings.sort((a, b) => {
    const aLength = typeof a.description === "string" ? a.description.length : 0;
    const bLength = typeof b.description === "string" ? b.description.length : 0;
    return bLength - aLength;
  })[0] ?? null;
}

function readScalar(value: unknown): string {
  return typeof value === "string" ? normalizeWhitespace(value) : "";
}

function readOrganizationName(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const name = readOrganizationName(item);
      if (name) {
        return name;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return readScalar(record.name);
  }

  return "";
}

function readLocationParts(value: unknown): string[] {
  if (typeof value === "string") {
    const text = normalizeWhitespace(value);
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => readLocationParts(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const named = readScalar(record.name);
  if (named) {
    return [named];
  }

  const address = typeof record.address === "object" && record.address
    ? record.address as Record<string, unknown>
    : record;
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => normalizeWhitespace(part));

  const joined = [...new Set(parts)].join(", ");
  return joined ? [joined] : [];
}

function readJobLocation(value: unknown): string {
  return [...new Set(readLocationParts(value))].join(" / ");
}

function readSalary(payload: Record<string, unknown>): string {
  for (const key of ["baseSalary", "estimatedSalary", "salary"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return normalizeWhitespace(value);
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const currency = readScalar(record.currency);
      const nested = typeof record.value === "object" && record.value
        ? record.value as Record<string, unknown>
        : record;
      const unit = readScalar(nested.unitText);
      const min = readScalar(nested.minValue);
      const max = readScalar(nested.maxValue);
      const exact = readScalar(nested.value);
      const amount = min && max ? `${min} - ${max}` : exact || min || max;
      if (amount) {
        return normalizeWhitespace(`${currency ? `${currency} ` : ""}${amount}${unit ? ` / ${unit}` : ""}`);
      }
    }
  }

  return "";
}

function readDomDescription($: cheerio.CheerioAPI): string {
  const candidates = [
    "[data-controller='careersite--responsive-video'].prose",
    "main .prose.font-company-body",
    "main .prose",
    ".job-body",
    "[data-test='job-body']",
  ];

  for (const selector of candidates) {
    const element = $(selector).first();
    if (element.length === 0) {
      continue;
    }

    const text = htmlFragmentToText(element.html() ?? element.text());
    if (!isVacancyTextTooShort(text)) {
      return text;
    }
  }

  return "";
}

function readDomLocations($: cheerio.CheerioAPI): string {
  const locationsDt = $("dt")
    .filter((_, element) => /^locations?$/i.test(normalizeWhitespace($(element).text())))
    .first();
  if (locationsDt.length > 0) {
    const dd = locationsDt.next("dd");
    const links = dd.find("a")
      .map((_, element) => normalizeWhitespace($(element).text()))
      .get()
      .filter(Boolean);
    if (links.length > 0) {
      return [...new Set(links)].join(" / ");
    }

    const text = normalizeWhitespace(dd.text());
    if (text) {
      return text;
    }
  }

  return "";
}

function companyFromHostname(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9-]+)\.teamtailor\.com$/i);
    const slug = match?.[1];
    if (!slug || slug === "www" || slug === "career") {
      return "";
    }

    return slug
      .split("-")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  } catch {
    return "";
  }
}

export async function fetchTeamtailorJob(url: string): Promise<ParsedJobFields> {
  if (!isTeamtailorUrl(url)) {
    throw new JobParserError("TEAMTAILOR_TARGET_NOT_FOUND", "Teamtailor job URL was not recognized.");
  }

  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new JobParserError("TEAMTAILOR_HTTP_ERROR", `Teamtailor fetch returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  const posting = readJobPosting(html);
  const metadata = extractCompanyRoleFromHtml(html);
  const $ = cheerio.load(html);

  const descriptionFromJsonLd = typeof posting?.description === "string"
    ? htmlFragmentToText(posting.description)
    : "";
  const jobDescription = !isVacancyTextTooShort(descriptionFromJsonLd)
    ? descriptionFromJsonLd
    : readDomDescription($);

  if (isVacancyTextTooShort(jobDescription)) {
    throw new JobParserError(
      "TEAMTAILOR_DESCRIPTION_MISSING",
      "Teamtailor job description is missing or too short.",
    );
  }

  const companyName = readOrganizationName(posting?.hiringOrganization)
    || metadata.companyName
    || companyFromHostname(url)
    || extractCompanyFromText(jobDescription);

  const positionTitle = readScalar(posting?.title)
    || metadata.positionTitle
    || normalizeWhitespace($("main h1").first().text())
    || extractTitleFromText(jobDescription);

  const location = readDomLocations($)
    || readJobLocation(posting?.jobLocation ?? posting?.applicantLocationRequirements)
    || metadata.location
    || extractLocationFromText(jobDescription);

  const salary = (posting ? readSalary(posting) : "")
    || metadata.salary
    || extractSalaryFromText(jobDescription);

  return {
    companyName,
    positionTitle,
    salary,
    location,
    jobDescription,
    warnings: [],
  };
}
