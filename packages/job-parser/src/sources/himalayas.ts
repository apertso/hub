import { requestSignal } from "../utils/abort.js";
import { JobParserError, type ParsedJobFields } from "../types.js";
import {
  extractCompanyFromText,
  extractSalaryFromText,
  extractTitleFromText,
  htmlFragmentToText,
  isVacancyTextTooShort,
  normalizeWhitespace,
} from "../utils/text.js";
import { parseHimalayasJobTarget, type HimalayasJobTarget } from "../utils/url.js";

const FETCH_TIMEOUT_MS = 15_000;
// Job pages sit behind a Cloudflare challenge, but the documented public API does not.
const HIMALAYAS_SEARCH_URL = "https://himalayas.app/jobs/api/search";
// Company-only listing pages to scan when the keyword search misses the job.
const MAX_COMPANY_PAGES = 5;

type HimalayasJob = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? normalizeWhitespace(value) : "";
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readStringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item): item is string => typeof item === "string").map(normalizeWhitespace).filter(Boolean))];
}

function jobPath(target: HimalayasJobTarget): string {
  return `/companies/${target.companySlug}/jobs/${target.jobSlug}`.toLowerCase();
}

function urlPath(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function matchesTarget(job: HimalayasJob, target: HimalayasJobTarget): boolean {
  const expected = jobPath(target);
  return [readString(job, "guid"), readString(job, "applicationLink")].some((link) => urlPath(link) === expected);
}

async function searchJobs(params: Record<string, string>, signal?: AbortSignal): Promise<HimalayasJob[]> {
  const url = new URL(HIMALAYAS_SEARCH_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: requestSignal(FETCH_TIMEOUT_MS, signal),
  });
  if (!response.ok) {
    throw new JobParserError(
      "HIMALAYAS_HTTP_ERROR",
      `Himalayas search API returned HTTP ${response.status}.`,
      response.status,
    );
  }

  const payload = asRecord(await response.json());
  const jobs = payload?.jobs;
  return Array.isArray(jobs) ? jobs.map(asRecord).filter((job): job is HimalayasJob => job !== null) : [];
}

async function findJob(target: HimalayasJobTarget, signal?: AbortSignal): Promise<HimalayasJob | null> {
  // The job slug is derived from the title, so its words make a precise query
  // in any language; the exact match is always decided by the job URL.
  const query = target.jobSlug.replace(/[-_]+/g, " ").trim();
  if (query) {
    const found = (await searchJobs({ q: query, company: target.companySlug }, signal))
      .find((job) => matchesTarget(job, target));
    if (found) {
      return found;
    }
  }

  for (let page = 1; page <= MAX_COMPANY_PAGES; page += 1) {
    const jobs = await searchJobs({ company: target.companySlug, page: String(page) }, signal);
    const found = jobs.find((job) => matchesTarget(job, target));
    if (found) {
      return found;
    }
    if (jobs.length === 0) {
      break;
    }
  }

  return null;
}

function formatAmount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function salaryFromJob(job: HimalayasJob): string {
  const min = readNumber(job, "minSalary");
  const max = readNumber(job, "maxSalary");
  if (min === null && max === null) {
    return "";
  }

  const amount = min !== null && max !== null && min !== max
    ? `${formatAmount(min)} - ${formatAmount(max)}`
    : formatAmount((min ?? max) as number);
  const currency = readString(job, "currency");
  const period = readString(job, "salaryPeriod");
  return normalizeWhitespace(`${currency ? `${currency} ` : ""}${amount}${period ? ` / ${period}` : ""}`);
}

function locationFromJob(job: HimalayasJob): string {
  // Himalayas lists remote jobs only; restrictions name the countries hiring is open to.
  const restrictions = readStringList(job, "locationRestrictions");
  return restrictions.length > 0 ? `Remote (${restrictions.join(", ")})` : "Remote";
}

function companyFromSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function fetchHimalayasJob(url: string, signal?: AbortSignal): Promise<ParsedJobFields> {
  const target = parseHimalayasJobTarget(url);
  if (!target) {
    throw new JobParserError("HIMALAYAS_TARGET_NOT_FOUND", "Himalayas company or job slug was not found.");
  }

  const job = await findJob(target, signal);
  if (!job) {
    throw new JobParserError(
      "HIMALAYAS_JOB_NOT_FOUND",
      "Himalayas job was not found in the public API; it may have expired.",
    );
  }

  const description = htmlFragmentToText(typeof job.description === "string" ? job.description : "")
    || readString(job, "excerpt");
  if (isVacancyTextTooShort(description)) {
    throw new JobParserError("HIMALAYAS_DESCRIPTION_MISSING", "Himalayas job description is missing or too short.");
  }

  return {
    companyName: readString(job, "companyName") || companyFromSlug(target.companySlug) || extractCompanyFromText(description),
    positionTitle: readString(job, "title") || extractTitleFromText(description),
    salary: salaryFromJob(job) || extractSalaryFromText(description),
    location: locationFromJob(job),
    jobDescription: description,
    warnings: [],
  };
}
