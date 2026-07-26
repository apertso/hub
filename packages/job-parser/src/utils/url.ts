import { JobParserError, type JobParseSource } from "../types.js";

export type GreenhouseJobTarget = {
  boardToken: string;
  jobId: string;
};

export type LeverJobTarget = {
  site: string;
  postingId: string;
  apiBase: string;
};

function isLinkedInHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "linkedin.com" || normalized.endsWith(".linkedin.com");
}

function isGreenhouseHost(hostname: string): boolean {
  return [
    "boards.greenhouse.io",
    "boards.eu.greenhouse.io",
    "job-boards.greenhouse.io",
    "job-boards.eu.greenhouse.io",
  ].includes(hostname.toLowerCase());
}

function isLeverHost(hostname: string): boolean {
  return ["jobs.lever.co", "jobs.eu.lever.co"].includes(hostname.toLowerCase());
}

const LEVER_POSTING_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isHhHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "hh.ru" || normalized.endsWith(".hh.ru");
}

export function isLinkedInUrl(url: string): boolean {
  try {
    return isLinkedInHost(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}

export function isHhUrl(url: string): boolean {
  try {
    return isHhHost(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}

export function extractLinkedInJobId(url: string): string | null {
  const directMatch = url.match(/\/jobs\/view\/(\d+)/i);
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  try {
    const parsed = new URL(url);

    const currentJobId = parsed.searchParams.get("currentJobId");
    if (currentJobId && /^\d+$/.test(currentJobId)) {
      return currentJobId;
    }

    const slugMatch = parsed.pathname.match(/\/jobs\/view\/[^/?#]*?-(\d{7,})(?:[/?#]|$)/i);
    if (slugMatch?.[1]) {
      return slugMatch[1];
    }

    const sessionRedirect = parsed.searchParams.get("session_redirect");
    if (sessionRedirect) {
      const decoded = decodeURIComponent(sessionRedirect);

      const nestedMatch = decoded.match(/\/jobs\/view\/(\d+)/i);
      if (nestedMatch?.[1]) {
        return nestedMatch[1];
      }

      const nestedCurrentJobId = decoded.match(/[?&]currentJobId=(\d+)/i);
      if (nestedCurrentJobId?.[1]) {
        return nestedCurrentJobId[1];
      }

      const nestedSlugMatch = decoded.match(/\/jobs\/view\/[^\s?#]*?-(\d{7,})(?:[/?#]|$)/i);
      if (nestedSlugMatch?.[1]) {
        return nestedSlugMatch[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function isLeverUrl(url: string): boolean {
  try {
    return isLeverHost(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}

export function parseLeverJobTarget(url: string): LeverJobTarget | null {
  try {
    const parsed = new URL(url);
    if (!isLeverHost(parsed.hostname)) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    const site = parts[0]?.trim();
    let postingId = parts[1]?.trim();
    if (!site || !postingId) {
      return null;
    }

    if (parts[2]?.toLowerCase() === "apply") {
      postingId = parts[1]?.trim() ?? "";
    }

    if (!LEVER_POSTING_ID_PATTERN.test(postingId)) {
      return null;
    }

    const apiBase = parsed.hostname.toLowerCase() === "jobs.eu.lever.co"
      ? "https://api.eu.lever.co"
      : "https://api.lever.co";

    return { site, postingId, apiBase };
  } catch {
    return null;
  }
}

export function parseGreenhouseJobTarget(url: string): GreenhouseJobTarget | null {
  try {
    const parsed = new URL(url);
    if (!isGreenhouseHost(parsed.hostname)) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const jobsIndex = parts.findIndex((part) => part.toLowerCase() === "jobs");
    if (jobsIndex > 0 && parts[jobsIndex + 1]) {
      return {
        boardToken: parts[jobsIndex - 1],
        jobId: parts[jobsIndex + 1],
      };
    }

    if (parts[0]?.toLowerCase() === "embed" && parts[1]?.toLowerCase() === "job_app") {
      const boardToken = parsed.searchParams.get("for")?.trim();
      const jobId = parsed.searchParams.get("token")?.trim();
      if (boardToken && jobId) {
        return { boardToken, jobId };
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function detectSpecificSource(url: string): Exclude<JobParseSource, "jina" | "direct"> | null {
  if (isLinkedInUrl(url)) {
    return "linkedin";
  }

  if (isHhUrl(url)) {
    return "hh";
  }

  if (parseGreenhouseJobTarget(url)) {
    return "greenhouse";
  }

  if (parseLeverJobTarget(url)) {
    return "lever";
  }

  return null;
}

export function normalizeJobUrl(rawUrl: string): string {
  if (typeof rawUrl !== "string") {
    throw new JobParserError("INVALID_URL", "Job URL must be a string.");
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new JobParserError("INVALID_URL", "Job URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new JobParserError("INVALID_URL", "Please paste a valid job URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new JobParserError("INVALID_URL", "Please paste an http(s) job URL.");
  }

  if (isLinkedInHost(parsed.hostname)) {
    const jobId = extractLinkedInJobId(trimmed);
    if (!jobId) {
      throw new JobParserError(
        "LINKEDIN_JOB_ID_NOT_FOUND",
        "Please paste a LinkedIn job URL in this format: https://www.linkedin.com/jobs/view/<jobId>.",
      );
    }
    return `https://www.linkedin.com/jobs/view/${jobId}`;
  }

  parsed.hash = "";
  return parsed.toString();
}
