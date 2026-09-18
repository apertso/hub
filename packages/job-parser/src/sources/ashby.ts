import { JobParserError, type ParsedJobFields } from "../types.js";
import {
  extractCompanyFromText,
  extractLocationFromText,
  extractSalaryFromText,
  extractTitleFromText,
  extractVacancyTextFromHtml,
  fallbackVacancyTextFromHtml,
  isVacancyTextTooShort,
  normalizeWhitespace,
} from "../utils/text.js";
import { parseAshbyJobTarget } from "../utils/url.js";

const FETCH_TIMEOUT_MS = 15_000;
const ASHBY_GRAPHQL_URL = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting";
const ASHBY_GRAPHQL_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    title
    locationName
    workplaceType
    employmentType
    compensationTierSummary
    descriptionHtml
  }
}`;

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

function companyNameFromBoardSlug(boardToken: string): string {
  return boardToken
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function descriptionFromHtmlOrPlain(html: string, plain: string): string {
  const normalizedPlain = normalizeWhitespace(plain);
  if (!isVacancyTextTooShort(normalizedPlain)) {
    return normalizedPlain;
  }
  if (html) {
    const fromHtml = extractVacancyTextFromHtml(html) || fallbackVacancyTextFromHtml(html);
    if (!isVacancyTextTooShort(fromHtml)) {
      return fromHtml;
    }
  }
  return normalizedPlain;
}

function locationFromFields(location: string, workplaceType: string): string {
  const workplace = workplaceType.trim();
  if (workplace.toLowerCase() === "remote" && location && !/\bremote\b/i.test(location)) {
    return `${location} / Remote`;
  }
  if (workplace.toLowerCase() === "remote" && !location) {
    return "Remote";
  }
  return location;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function fetchAshbyGraphqlJob(boardToken: string, jobId: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(ASHBY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    signal: timeoutSignal(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      operationName: "ApiJobPosting",
      variables: {
        organizationHostedJobsPageName: boardToken,
        jobPostingId: jobId,
      },
      query: ASHBY_GRAPHQL_QUERY,
    }),
  });

  if (!response.ok) {
    throw new JobParserError("ASHBY_HTTP_ERROR", `Ashby GraphQL returned HTTP ${response.status}.`);
  }

  const payload = asRecord(await response.json());
  const data = asRecord(payload?.data);
  return asRecord(data?.jobPosting);
}

async function fetchAshbyBoardJob(boardToken: string, jobId: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardToken)}`,
    {
      headers: {
        Accept: "application/json",
      },
      signal: timeoutSignal(FETCH_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new JobParserError("ASHBY_HTTP_ERROR", `Ashby job board API returned HTTP ${response.status}.`);
  }

  const payload = asRecord(await response.json());
  const jobs = payload?.jobs;
  if (!Array.isArray(jobs)) {
    return null;
  }

  for (const item of jobs) {
    const job = asRecord(item);
    if (job && readString(job, "id") === jobId) {
      return job;
    }
  }

  return null;
}

export async function fetchAshbyJob(url: string): Promise<ParsedJobFields> {
  const target = parseAshbyJobTarget(url);
  if (!target) {
    throw new JobParserError("ASHBY_TARGET_NOT_FOUND", "Ashby board token or job id was not found.");
  }

  let graphqlPosting: Record<string, unknown> | null = null;
  let boardPosting: Record<string, unknown> | null = null;
  try {
    graphqlPosting = await fetchAshbyGraphqlJob(target.boardToken, target.jobId);
  } catch {
    graphqlPosting = null;
  }
  try {
    boardPosting = await fetchAshbyBoardJob(target.boardToken, target.jobId);
  } catch {
    boardPosting = null;
  }
  const posting = graphqlPosting ?? boardPosting;
  if (!posting) {
    throw new JobParserError("ASHBY_JOB_NOT_FOUND", "Ashby job posting was not found.");
  }

  const html = readString(graphqlPosting ?? {}, "descriptionHtml") || readString(boardPosting ?? {}, "descriptionHtml");
  const plain = readString(boardPosting ?? {}, "descriptionPlain");
  const text = descriptionFromHtmlOrPlain(html, plain);
  if (isVacancyTextTooShort(text)) {
    throw new JobParserError("ASHBY_DESCRIPTION_MISSING", "Ashby job description is missing or too short.");
  }

  const location = locationFromFields(
    readString(posting, "locationName") || readString(posting, "location"),
    readString(posting, "workplaceType"),
  );
  const companyName = companyNameFromBoardSlug(target.boardToken) || extractCompanyFromText(text);

  return {
    companyName,
    positionTitle: readString(posting, "title") || extractTitleFromText(text),
    salary: readString(posting, "compensationTierSummary") || extractSalaryFromText(text),
    location: location || extractLocationFromText(text),
    jobDescription: text,
    warnings: [],
  };
}
