import { JobParserError, type ParsedJobFields } from "../types.js";
import {
  extractCompanyFromText,
  extractCompanyRoleFromHtml,
  extractTitleFromText,
  extractVacancyTextFromHtml,
  fallbackVacancyTextFromHtml,
  isVacancyTextTooShort,
} from "../utils/text.js";
import { extractLinkedInJobId } from "../utils/url.js";

const LINKEDIN_GUEST_TIMEOUT_MS = 12_000;

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

export async function fetchLinkedInJob(url: string): Promise<ParsedJobFields> {
  const jobId = extractLinkedInJobId(url);
  if (!jobId) {
    throw new JobParserError("LINKEDIN_JOB_ID_NOT_FOUND", "LinkedIn job id was not found in the URL.");
  }

  const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
  const response = await fetch(guestUrl, {
    headers: FETCH_HEADERS,
    signal: timeoutSignal(LINKEDIN_GUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new JobParserError("LINKEDIN_HTTP_ERROR", `LinkedIn guest endpoint returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  const metadata = extractCompanyRoleFromHtml(html);
  const text = extractVacancyTextFromHtml(html) || fallbackVacancyTextFromHtml(html);
  if (isVacancyTextTooShort(text)) {
    throw new JobParserError("LINKEDIN_DESCRIPTION_MISSING", "LinkedIn job description is missing or too short.");
  }

  return {
    companyName: metadata.companyName || extractCompanyFromText(text),
    positionTitle: metadata.positionTitle || extractTitleFromText(text),
    jobDescription: text,
    warnings: [],
  };
}
