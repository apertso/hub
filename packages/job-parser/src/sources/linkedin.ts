import { setTimeout as sleep } from "node:timers/promises";
import { requestSignal } from "../utils/abort.js";
import { JobParserError, type ParsedJobFields } from "../types.js";
import {
  extractCompanyFromText,
  extractCompanyRoleFromHtml,
  extractLocationFromText,
  extractSalaryFromText,
  extractTitleFromText,
  extractVacancyTextFromHtml,
  fallbackVacancyTextFromHtml,
  isVacancyTextTooShort,
} from "../utils/text.js";
import { extractLinkedInJobId } from "../utils/url.js";

const LINKEDIN_GUEST_TIMEOUT_MS = 12_000;
// The guest endpoint rate-limits datacenter IPs per request rather than per
// burst: a 429 is usually followed by a 200. Later sources only see LinkedIn's
// public page shell, which lacks the title and description, so retry here.
const LINKEDIN_RETRY_BACKOFF_MS = [300, 800, 1_500];

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export async function fetchLinkedInJob(url: string, signal?: AbortSignal): Promise<ParsedJobFields> {
  const jobId = extractLinkedInJobId(url);
  if (!jobId) {
    throw new JobParserError("LINKEDIN_JOB_ID_NOT_FOUND", "LinkedIn job id was not found in the URL.");
  }

  const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  const response = await fetchGuestPosting(guestUrl, signal);

  const html = await response.text();
  const metadata = extractCompanyRoleFromHtml(html);
  const text = extractVacancyTextFromHtml(html) || fallbackVacancyTextFromHtml(html);
  if (isVacancyTextTooShort(text)) {
    throw new JobParserError("LINKEDIN_DESCRIPTION_MISSING", "LinkedIn job description is missing or too short.");
  }

  return {
    companyName: metadata.companyName || extractCompanyFromText(text),
    positionTitle: metadata.positionTitle || extractTitleFromText(text),
    salary: metadata.salary || extractSalaryFromText(text),
    location: metadata.location || extractLocationFromText(text),
    jobDescription: text,
    warnings: [],
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchGuestPosting(guestUrl: string, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(guestUrl, {
      headers: FETCH_HEADERS,
      signal: requestSignal(LINKEDIN_GUEST_TIMEOUT_MS, signal),
    });
    if (response.ok) {
      return response;
    }
    const backoff = LINKEDIN_RETRY_BACKOFF_MS[attempt];
    if (!isRetryableStatus(response.status) || backoff === undefined) {
      throw new JobParserError(
        "LINKEDIN_HTTP_ERROR",
        `LinkedIn guest endpoint returned HTTP ${response.status} after ${attempt + 1} attempt(s).`,
        response.status,
      );
    }
    await response.body?.cancel();
    await sleep(backoff, undefined, { signal });
  }
}
